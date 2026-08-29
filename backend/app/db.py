"""SQLAlchemy engine/session wiring.

Works against both the local SQLite default and Supabase Postgres — the models
deliberately avoid Postgres-only column types so the same schema runs on either.
"""

import logging

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from . import config

logger = logging.getLogger("oink.db")

engine_kwargs = {"pool_pre_ping": True}
if config.USING_SQLITE:
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(config.DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create tables if they don't exist (spec §11 — no migration tool at v1)."""
    from . import models  # noqa: F401  (registers models on Base.metadata)

    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
    _backfill_defaults()
    _seed_the_og_sty()
    _ensure_unique_place_ids()


def _ensure_unique_place_ids() -> None:
    """One row per Google listing, enforced by the database.

    The API already refuses a place without an id and hands back the existing
    entry when it recognises one, but that's a check two concurrent requests can
    both pass. The index is what actually makes it true. Existing rows predate
    the rule and have no id; both SQLite and Postgres allow repeated NULLs in a
    unique index, so they're unaffected.
    """
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_google_place_id "
                    "ON restaurants (google_place_id)"
                )
            )
    except Exception:  # noqa: BLE001 — a duplicate already in the data, say
        logger.warning(
            "Couldn't add the unique index on google_place_id — "
            "there may already be duplicate places to merge.",
            exc_info=True,
        )


def _add_missing_columns() -> None:
    """Add columns that exist on the models but not yet in the database.

    `create_all` only creates missing *tables*, so adding a field to a model
    would otherwise mean wiping the database. Both SQLite and Postgres support
    `ALTER TABLE ... ADD COLUMN`, which covers every schema change made so far.
    Anything more involved (renames, type changes, constraints) needs a real
    migration tool — see spec §11.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in present:
                    continue
                if not column.nullable and column.default is None:
                    # Can't back-fill a NOT NULL column for existing rows.
                    logger.warning(
                        "Column %s.%s needs a manual migration — skipping.",
                        table.name, column.name,
                    )
                    continue
                ddl = column.type.compile(dialect=engine.dialect)
                conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl}'))
                logger.info("Added column %s.%s", table.name, column.name)


def _backfill_defaults() -> None:
    """Give newly added columns a value on rows that predate them.

    `ALTER TABLE ... ADD COLUMN` leaves existing rows NULL even where the model
    declares a default, because the default is applied by the ORM on insert.
    `session_version` is read on every single request, so it wants a real value
    rather than a NULL that every caller has to remember to coalesce.
    """
    try:
        with engine.begin() as conn:
            conn.execute(text("UPDATE users SET session_version = 1 WHERE session_version IS NULL"))
    except Exception:  # noqa: BLE001 — column not there yet on a fresh create
        logger.debug("session_version backfill skipped", exc_info=True)


# Whoever founded the place. These are real accounts on the deployed app; on a
# fresh checkout they simply aren't there, and the migration copes rather than
# inventing them — conjuring an account to satisfy a migration would put a
# stranger in the sty.
OG_STY_NAME = "The OG Sty"
OG_STY_ADMINS = ("Princess CEO Piggy", "Glorious Chairman Oink", "Sir Piggiam")


def _seed_the_og_sty() -> None:
    """Put everyone who already exists into one sty, once.

    Runs on every boot and does nothing once the sty exists. Afterwards The OG
    Sty is an ordinary sty in every respect — renameable, restyleable, and its
    members can leave.
    """
    from sqlalchemy.orm import Session

    from .models import Sty, StyMember, User

    with Session(engine) as db:
        if db.query(Sty).filter(Sty.name == OG_STY_NAME).first():
            return
        users = db.query(User).order_by(User.created_at).all()
        if not users:
            return

        sty = Sty(name=OG_STY_NAME, hut="meadow", ground="meadow", created_by=users[0].id)
        db.add(sty)
        db.flush()

        wanted = {name.lower() for name in OG_STY_ADMINS}
        admins = {
            u.id for u in users
            if u.display_name.lower() in wanted or u.username.lower() in wanted
        }
        # A sty must never be left without an admin, or nobody can ever approve
        # anyone again. If none of the founders are on this instance, the
        # earliest account holds the keys.
        if not admins:
            admins = {users[0].id}

        for user in users:
            db.add(StyMember(
                sty_id=sty.id, user_id=user.id,
                role="admin" if user.id in admins else "pig",
            ))
        db.commit()

"""Oink API — FastAPI app, local-only in v1 (spec §0)."""

import logging
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from sqlalchemy import text

from . import config
# Aliased: `routers.places` below would otherwise shadow the lookup module.
from . import places as place_lookup
from .db import engine, init_db
from .routers import auth, feed, places, restaurants, safety, social, sties, users

logger = logging.getLogger("oink")

app = FastAPI(
    title="Oink API",
    version="1.0.0",
    description="Restaurant / bar / cafe recommendations between friends.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,  # required for the session cookie
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"
for router in (
    auth.router,
    users.router,
    restaurants.router,
    social.router,
    feed.router,
    places.router,
    sties.router,
    safety.router,
):
    app.include_router(router, prefix=API_PREFIX)


def _ensure_upload_dir() -> bool:
    """Create the local upload directory, reporting whether it's usable.

    Serverless hosts (Vercel) mount a read-only filesystem, so this fails there.
    That's fine — those deploys use Supabase Storage — but it must not take the
    whole app down on import.
    """
    try:
        config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        return True
    except OSError:
        return False


# Set when schema setup fails, so /health can report *why* instead of the app
# refusing to boot. A failed startup event takes down every route in the ASGI
# app — including the health check you'd use to diagnose it — so this must not
# be allowed to raise on a serverless host.
DB_INIT_ERROR: Optional[str] = None


@app.on_event("startup")
def on_startup() -> None:
    global DB_INIT_ERROR
    try:
        init_db()
    except Exception as exc:  # noqa: BLE001 — any failure here must stay non-fatal
        DB_INIT_ERROR = f"{type(exc).__name__}: {exc}"
        logger.exception("Database initialisation failed — the API will start but DB routes will 503.")
    _ensure_upload_dir()

    if config.JWT_SECRET == "dev-only-insecure-secret-change-me":
        logger.warning("JWT_SECRET is the built-in dev default — set a real one before any deploy.")
    logger.info("Database: %s", "local SQLite" if config.USING_SQLITE else "Postgres/Supabase")
    logger.info(
        "Image storage: %s",
        "Supabase Storage" if config.USING_SUPABASE_STORAGE else "local ./uploads",
    )
    logger.info(
        "Place lookup: %s",
        "Google Places API" if config.GOOGLE_MAPS_API_KEY else "OpenStreetMap (no key)",
    )


# Locally-stored uploads are served straight off disk. With Supabase Storage
# configured, image URLs point at Supabase instead and this mount goes unused —
# which is also the case on a read-only serverless filesystem, where the mount
# can't be created at all.
if _ensure_upload_dir():
    app.mount("/uploads", StaticFiles(directory=str(config.UPLOAD_DIR)), name="uploads")
else:
    logger.warning("Upload directory isn't writable — /uploads not mounted (expected on serverless).")


@app.get("/api/v1/health", tags=["health"])
def health():
    """Reports configuration *and* whether the database actually answers.

    This deliberately reports a failure rather than raising: a health check that
    500s when the database is down tells you nothing you didn't already know.
    """
    db_connected = False
    db_error: Optional[str] = DB_INIT_ERROR
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_connected = True
    except Exception as exc:  # noqa: BLE001 — reporting the fault is the point
        db_error = f"{type(exc).__name__}: {exc}"

    return {
        "status": "ok" if db_connected else "degraded",
        "database": "sqlite" if config.USING_SQLITE else "postgres",
        "database_connected": db_connected,
        # Present only when something is wrong. Names the host but never the
        # password — SQLAlchemy masks credentials in its connection errors.
        "database_error": db_error,
        "storage": "supabase" if config.USING_SUPABASE_STORAGE else "local",
        "google_maps_key": bool(config.GOOGLE_MAPS_API_KEY),
        # Non-null when a key is set but Google rejected the last search — the
        # difference between "no key" and "key that doesn't work".
        "google_maps_error": place_lookup.LAST_GOOGLE_ERROR,
    }

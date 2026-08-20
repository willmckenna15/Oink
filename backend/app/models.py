"""ORM models — spec §4.

Two deliberate deviations from the SQL in the spec, both so one schema runs on
SQLite (local default) and Postgres (Supabase) alike:

* uuid primary keys are stored as 36-char strings rather than a native uuid type.
* `text[]` columns (`category`, `recommended_dishes`) are stored as JSON arrays.

Also added: `recommendations.updated_at`. Recommendations upsert on re-submit
(spec §8) and the feed orders by recency — without this, editing a review would
leave it stranded at its original spot in the feed.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

KINDS = ("restaurant", "bar", "cafe")
BUDGETS = ("$", "$$", "$$$", "$$$$")
REACTION_TYPES = ("oink", "shame")


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    # {color, hat, accessory, background} — see spec §9.1
    pig_avatar_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class Restaurant(Base):
    """A logged place. Covers restaurants, bars and cafes — see spec §1 naming note."""

    __tablename__ = "restaurants"
    __table_args__ = (
        CheckConstraint(f"kind in {KINDS}", name="ck_restaurant_kind"),
        CheckConstraint(f"budget in {BUDGETS}", name="ck_restaurant_budget"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Cuisine tags for restaurants/cafes; drinking-institution type for bars (spec §6.3)
    category: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    budget: Mapped[str] = mapped_column(String(4), nullable=False)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    area: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    postcode: Mapped[Optional[str]] = mapped_column(String(24), nullable=True)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    # Optional: a place can be added by dropping a pin or searching by name.
    google_maps_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Google's own id. Photo names can't be stored (they expire, and caching
    # them breaks Maps ToS 3.2.3(b)) but place ids can, so photos are resolved
    # from this each time they're needed.
    google_place_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    cover_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Auto-sourced fallback image (spec §15). An uploaded photo always wins;
    # this only fills the gap so a new place isn't a blank placeholder.
    photo_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)

    images = relationship("RestaurantImage", back_populates="restaurant", cascade="all, delete-orphan")
    recommendations = relationship("Recommendation", back_populates="restaurant", cascade="all, delete-orphan")
    reactions = relationship("Reaction", back_populates="restaurant", cascade="all, delete-orphan")


class RestaurantImage(Base):
    __tablename__ = "restaurant_images"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("restaurants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)

    restaurant = relationship("Restaurant", back_populates="images")


class Recommendation(Base):
    """Review text + recommended dishes. No rating — spec §8."""

    __tablename__ = "recommendations"
    __table_args__ = (UniqueConstraint("restaurant_id", "user_id", name="uq_recommendation_user_place"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("restaurants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    review_text: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_dishes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now, onupdate=_now)

    restaurant = relationship("Restaurant", back_populates="recommendations")


class Reply(Base):
    """A reply to somebody's review — spec §6.4.

    Replies hang off a *recommendation*, not a place: an oink carries no text to
    reply to, and letting every row start a thread turns the feed into a chat.
    Flat, with no parent_id — twenty-odd friends arguing about a restaurant don't
    need a tree, and threading doubles the layout work for nothing.
    """

    __tablename__ = "replies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    recommendation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("recommendations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


class Reaction(Base):
    """One 'oink' or 'shame' per user per place — spec §8."""

    __tablename__ = "reactions"
    __table_args__ = (
        UniqueConstraint("restaurant_id", "user_id", name="uq_reaction_user_place"),
        CheckConstraint(f"type in {REACTION_TYPES}", name="ck_reaction_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    restaurant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("restaurants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(10), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)

    restaurant = relationship("Restaurant", back_populates="reactions")


class WishlistItem(Base):
    __tablename__ = "wishlist"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    restaurant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("restaurants.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)


# --- The farm: sties, their pigs, and the queue at the door (spec §6.6) ------

STY_ROLES = ("admin", "pig")
JOIN_STATES = ("pending", "approved", "declined")

# What a sty looks like from the farm, and what its pigs stand on inside it.
# Two separate choices, so an igloo can sit on a beach if somebody wants that.
STY_HUTS = ("meadow", "beach", "snow", "lava", "desert", "club")
STY_GROUNDS = ("meadow", "beach", "snow", "lava", "desert", "club")


class Sty(Base):
    """A group of pigs. A sty is a *lens*, never a wall — it scopes what you're
    shown, and never hides a place, a review or a count from anyone."""

    __tablename__ = "sties"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(60), nullable=False, unique=True)
    hut: Mapped[str] = mapped_column(String(16), nullable=False, default="meadow")
    ground: Mapped[str] = mapped_column(String(16), nullable=False, default="meadow")
    created_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)

    members = relationship("StyMember", back_populates="sty", cascade="all, delete-orphan")


class StyMember(Base):
    """Role lives on the membership, not the user — being an admin of one sty
    says nothing about any other."""

    __tablename__ = "sty_members"
    __table_args__ = (CheckConstraint(f"role in {STY_ROLES}", name="ck_sty_member_role"),)

    sty_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sties.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(10), nullable=False, default="pig")
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)

    sty = relationship("Sty", back_populates="members")


class StyJoinRequest(Base):
    """Knocking on the door. Only one may be pending per person per sty, which
    is enforced here rather than by the button — mashing it can't queue five."""

    __tablename__ = "sty_join_requests"
    __table_args__ = (CheckConstraint(f"state in {JOIN_STATES}", name="ck_join_state"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    sty_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sties.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=_now)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    decided_by: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

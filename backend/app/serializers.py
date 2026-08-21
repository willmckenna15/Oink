"""Turning ORM rows into the API response shapes.

The "who recommends this place" set is derived, not stored (spec §4): every user
with a recommendation OR an `oink` reaction. `shame` never counts toward it.
These helpers batch their lookups so the map endpoint doesn't N+1 across pins.
"""

from datetime import datetime
from urllib.parse import quote
from typing import Dict, List, NamedTuple, Optional, Sequence, Set, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Reaction, Recommendation, Reply, Restaurant, RestaurantImage, User, WishlistItem
from .schemas import (
    ImageOut,
    RecommendationOut,
    ReplyOut,
    RestaurantDetail,
    RestaurantSummary,
    UserPublic,
)


def naive_dt(value: datetime) -> datetime:
    """Drop tzinfo so timestamps stay comparable.

    Values are written timezone-aware but stored in a naive DateTime column, so
    what comes back depends on the driver. Sorting a mix of the two raises.
    """
    return value.replace(tzinfo=None) if value.tzinfo else value


class UserActivity(NamedTuple):
    """What a user's pig is derived from: how much they've logged, and how recently."""

    places_logged: int
    last_logged_at: Optional[datetime]


_ACTIVITY_CACHE_KEY = "oink_user_activity"


def user_activity(db: Session, user_ids: Sequence[str]) -> Dict[str, UserActivity]:
    """Places logged and last-logged time per user.

    Both facts come from the same two tables — a recommendation or an oink; a
    shame is neither a visit nor a meal — so they're gathered in one union
    rather than four separate scans.

    Results are memoised on the Session, which lives for exactly one request.
    Endpoints ask for the same people more than once (the map's recommenders and
    the feed's actors overlap heavily), and every repeat was another round trip
    to a database that may be a long way away.
    """
    ids = {uid for uid in user_ids if uid}
    if not ids:
        return {}

    cache: Dict[str, UserActivity] = db.info.setdefault(_ACTIVITY_CACHE_KEY, {})
    missing = [uid for uid in ids if uid not in cache]

    if missing:
        logged = select(
            Recommendation.user_id, Recommendation.restaurant_id, Recommendation.created_at
        ).where(Recommendation.user_id.in_(missing))
        oinked = select(Reaction.user_id, Reaction.restaurant_id, Reaction.created_at).where(
            Reaction.user_id.in_(missing), Reaction.type == "oink"
        )

        places: Dict[str, Set[str]] = {}
        latest: Dict[str, datetime] = {}
        for uid, restaurant_id, at in db.execute(logged.union_all(oinked)).all():
            places.setdefault(uid, set()).add(restaurant_id)
            current = latest.get(uid)
            if current is None or naive_dt(at) > naive_dt(current):
                latest[uid] = at

        for uid in missing:
            cache[uid] = UserActivity(len(places.get(uid, ())), latest.get(uid))

    return {uid: cache[uid] for uid in ids}


def og_oink_counts(db: Session, user_ids: Sequence[str]) -> Dict[str, int]:
    """Places each user was first to put on the map (spec §6.5)."""
    if not user_ids:
        return {}
    rows = db.execute(
        select(Restaurant.created_by, func.count(Restaurant.id))
        .where(Restaurant.created_by.in_(list(user_ids)))
        .group_by(Restaurant.created_by)
    ).all()
    counts = {uid: 0 for uid in user_ids}
    counts.update({uid: n for uid, n in rows if uid})
    return counts


def og_reaction_counts(
    db: Session,
    user_ids: Sequence[str],
    from_ids: Optional[Sequence[str]] = None,
) -> Dict[str, tuple]:
    """Oinks and shames *other people* have left on the places each user put on
    the map first.

    This is the verdict of the group on someone's taste, which is a different
    thing from how much they've logged: finding one place everyone loves counts
    for more here than adding thirty nobody goes back to. The creator's own
    reaction is excluded — adding a place auto-oinks it, so counting it would
    hand everyone a free vote for themselves.

    `from_ids` narrows *who is voting*. Inside a sty the verdict has to be that
    sty's, counted from its own members only: a throne decided by the whole farm
    would just install the farm's favourite in every sty at once, and the point
    of splitting the farm up was that each group gets to make up its own mind.
    Omit it for the farm-wide number.
    """
    if not user_ids:
        return {}
    ids = list(user_ids)
    where = [
        Restaurant.created_by.in_(ids),
        Reaction.user_id != Restaurant.created_by,
    ]
    if from_ids is not None:
        voters = list(dict.fromkeys(from_ids))
        if not voters:
            return {uid: (0, 0) for uid in ids}
        where.append(Reaction.user_id.in_(voters))
    rows = db.execute(
        select(Restaurant.created_by, Reaction.type, func.count())
        .join(Reaction, Reaction.restaurant_id == Restaurant.id)
        .where(*where)
        .group_by(Restaurant.created_by, Reaction.type)
    ).all()

    counts: Dict[str, tuple] = {uid: (0, 0) for uid in ids}
    for uid, kind, n in rows:
        if not uid:
            continue
        oinks, shames = counts.get(uid, (0, 0))
        counts[uid] = (oinks + n, shames) if kind == "oink" else (oinks, shames + n)
    return counts


def places_logged_counts(db: Session, user_ids: Sequence[str]) -> Dict[str, int]:
    """Distinct places each user has logged — drives the pig fatness tier (spec §9.1)."""
    return {uid: a.places_logged for uid, a in user_activity(db, user_ids).items()}


def last_logged_map(db: Session, user_ids: Sequence[str]) -> Dict[str, datetime]:
    """When each user last logged a place — drives pig decay (spec §9.1)."""
    return {
        uid: a.last_logged_at
        for uid, a in user_activity(db, user_ids).items()
        if a.last_logged_at is not None
    }


def user_public(
    user: User,
    places_logged: int = 0,
    last_logged_at: Optional[datetime] = None,
    og_oinks: int = 0,
    og_reactions: tuple = (0, 0),
) -> UserPublic:
    return UserPublic(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        pig_avatar_config=user.pig_avatar_config or {},
        places_logged=places_logged,
        og_oinks=og_oinks,
        og_oinks_received=og_reactions[0],
        og_shames_received=og_reactions[1],
        last_logged_at=last_logged_at,
        joined_at=user.created_at,
    )


def _image_out(img: RestaurantImage) -> ImageOut:
    return ImageOut(id=img.id, url=img.url, uploaded_by=img.uploaded_by, created_at=img.created_at)


class RestaurantContext:
    """Pre-loaded per-restaurant signal, so summaries build without N+1."""

    def __init__(self, db: Session, restaurant_ids: Sequence[str]):
        self.ids = list(restaurant_ids)
        self.recommender_ids: Dict[str, List[str]] = {rid: [] for rid in self.ids}
        self.shame_ids: Dict[str, List[str]] = {rid: [] for rid in self.ids}
        self.oink_ids: Dict[str, List[str]] = {rid: [] for rid in self.ids}
        self.users: Dict[str, User] = {}
        self.logged_counts: Dict[str, int] = {}
        self.last_logged: Dict[str, datetime] = {}
        self.creators: Dict[str, Optional[str]] = {}

        if not self.ids:
            return

        rec_rows = db.execute(
            select(
                Recommendation.restaurant_id, Recommendation.user_id, Recommendation.created_at
            ).where(Recommendation.restaurant_id.in_(self.ids))
        ).all()
        reaction_rows = db.execute(
            select(
                Reaction.restaurant_id, Reaction.user_id, Reaction.type, Reaction.created_at
            ).where(Reaction.restaurant_id.in_(self.ids))
        ).all()
        creators = dict(
            db.execute(
                select(Restaurant.id, Restaurant.created_by).where(Restaurant.id.in_(self.ids))
            ).all()
        )
        self.creators = creators

        # When each person first endorsed each place, so the order below is
        # "who backed this first" rather than whatever order the rows came back in.
        first_endorsed: Dict[Tuple[str, str], datetime] = {}

        def note(rid: str, uid: str, at: datetime) -> None:
            key = (rid, uid)
            existing = first_endorsed.get(key)
            if existing is None or naive_dt(at) < naive_dt(existing):
                first_endorsed[key] = at

        for rid, uid, created_at in rec_rows:
            note(rid, uid, created_at)

        for rid, uid, rtype, created_at in reaction_rows:
            if rtype == "oink":
                self.oink_ids.setdefault(rid, []).append(uid)
                note(rid, uid, created_at)
            else:
                self.shame_ids.setdefault(rid, []).append(uid)

        # Whoever added the place leads, then everyone else oldest-first. Adding a
        # place auto-oinks it, so the creator is normally the earliest anyway —
        # but pinning them explicitly keeps them in front even if they later
        # cleared and re-added their oink, which would reset that timestamp.
        by_place: Dict[str, List[Tuple[str, datetime]]] = {}
        for (rid, uid), at in first_endorsed.items():
            by_place.setdefault(rid, []).append((uid, at))

        for rid, entries in by_place.items():
            entries.sort(key=lambda e: (e[0] != creators.get(rid), naive_dt(e[1]), e[0]))
            self.recommender_ids[rid] = [uid for uid, _ in entries]


        needed = {uid for uids in self.recommender_ids.values() for uid in uids}
        needed |= {uid for uids in self.shame_ids.values() for uid in uids}
        if needed:
            users = db.execute(select(User).where(User.id.in_(list(needed)))).scalars().all()
            self.users = {u.id: u for u in users}
            self.logged_counts = places_logged_counts(db, list(needed))
            self.last_logged = last_logged_map(db, list(needed))

    def _people(self, ids: Sequence[str]) -> List[UserPublic]:
        out = []
        for uid in ids:
            user = self.users.get(uid)
            if user:
                out.append(
                    user_public(user, self.logged_counts.get(uid, 0), self.last_logged.get(uid))
                )
        return out

    def recommenders(self, restaurant_id: str) -> List[UserPublic]:
        return self._people(self.recommender_ids.get(restaurant_id, []))

    def oinkers(self, restaurant_id: str) -> List[UserPublic]:
        return self._people(self.oink_ids.get(restaurant_id, []))

    def shamers(self, restaurant_id: str) -> List[UserPublic]:
        return self._people(self.shame_ids.get(restaurant_id, []))


def maps_url(restaurant: Restaurant) -> Optional[str]:
    """A Google Maps link for a place, derived rather than stored.

    Only a link someone actually pasted is kept on the row; everything else is
    worked out here from the place id or the coordinates. That way every place
    gets a link — including the ones added before any link was recorded — with
    no backfill to run and nothing to go stale if the place is renamed.
    """
    if restaurant.google_maps_url:
        return restaurant.google_maps_url
    place_id = getattr(restaurant, "google_place_id", None)
    if place_id:
        return (
            "https://www.google.com/maps/search/?api=1"
            f"&query={quote(restaurant.name or '')}&query_place_id={place_id}"
        )
    if restaurant.lat is not None and restaurant.lng is not None:
        return f"https://www.google.com/maps/search/?api=1&query={restaurant.lat},{restaurant.lng}"
    return None


def restaurant_summary(
    restaurant: Restaurant, ctx: RestaurantContext, viewer_id: Optional[str] = None
) -> RestaurantSummary:
    recommenders = ctx.recommenders(restaurant.id)
    shamers = ctx.shamers(restaurant.id)
    shame_count = len(ctx.shame_ids.get(restaurant.id, []))
    # Everything that counts as having been here: an oink, a write-up, a shame,
    # or having put the place on the map in the first place. `recommender_ids`
    # already folds oinks in with write-ups, so the three sets below are the
    # whole of it. Drives the map's "been / not been" filter.
    logged_by_me = bool(viewer_id) and (
        viewer_id in ctx.recommender_ids.get(restaurant.id, [])
        or viewer_id in ctx.shame_ids.get(restaurant.id, [])
        or ctx.creators.get(restaurant.id) == viewer_id
    )
    return RestaurantSummary(
        id=restaurant.id,
        name=restaurant.name,
        kind=restaurant.kind,
        category=restaurant.category or [],
        budget=restaurant.budget,
        city=restaurant.city,
        area=restaurant.area,
        postcode=restaurant.postcode,
        lat=restaurant.lat,
        lng=restaurant.lng,
        # Uploaded photo wins; the auto-sourced one is the fallback.
        cover_image_url=restaurant.cover_image_url or restaurant.photo_url,
        # `Restaurant.cover_image_url` is only ever written by an upload.
        uploaded_photo_url=restaurant.cover_image_url,
        google_maps_url=maps_url(restaurant),
        google_place_id=restaurant.google_place_id,
        recommenders=recommenders,
        recommender_count=len(recommenders),
        shamers=shamers,
        shame_count=shame_count,
        shamed_only=bool(shame_count) and not recommenders,
        logged_by_me=logged_by_me,
        added_by_me=bool(viewer_id) and ctx.creators.get(restaurant.id) == viewer_id,
    )


def restaurant_summaries(
    db: Session, restaurants: Sequence[Restaurant], viewer_id: Optional[str] = None
) -> List[RestaurantSummary]:
    ctx = RestaurantContext(db, [r.id for r in restaurants])
    return [restaurant_summary(r, ctx, viewer_id) for r in restaurants]


def restaurant_detail(db: Session, restaurant: Restaurant, viewer: Optional[User]) -> RestaurantDetail:
    ctx = RestaurantContext(db, [restaurant.id])
    summary = restaurant_summary(restaurant, ctx, viewer.id if viewer else None)

    images = (
        db.execute(
            select(RestaurantImage)
            .where(RestaurantImage.restaurant_id == restaurant.id)
            .order_by(RestaurantImage.created_at.asc())
        )
        .scalars()
        .all()
    )
    # Photos are attributed per uploader so each review card shows that
    # person's own shots (spec §6.4).
    images_by_user: Dict[str, List[ImageOut]] = {}
    for img in images:
        images_by_user.setdefault(img.uploaded_by, []).append(_image_out(img))

    recs = (
        db.execute(
            select(Recommendation)
            .where(Recommendation.restaurant_id == restaurant.id)
            .order_by(Recommendation.updated_at.desc())
        )
        .scalars()
        .all()
    )
    rec_user_ids = [r.user_id for r in recs]
    rec_users = {}
    if rec_user_ids:
        found = db.execute(select(User).where(User.id.in_(rec_user_ids))).scalars().all()
        rec_users = {u.id: u for u in found}
    rec_counts = places_logged_counts(db, rec_user_ids)
    rec_last = last_logged_map(db, rec_user_ids)

    # One query for every reply on this place's reviews, then grouped — the
    # alternative is a query per review.
    replies_by_rec: Dict[str, List[ReplyOut]] = {}
    rec_ids = [r.id for r in recs]
    if rec_ids:
        reply_rows = db.execute(
            select(Reply).where(Reply.recommendation_id.in_(rec_ids)).order_by(Reply.created_at)
        ).scalars().all()
        reply_user_ids = list({r.user_id for r in reply_rows})
        reply_users = {
            u.id: u
            for u in db.execute(select(User).where(User.id.in_(reply_user_ids))).scalars().all()
        } if reply_user_ids else {}
        reply_counts = places_logged_counts(db, reply_user_ids)
        reply_last = last_logged_map(db, reply_user_ids)
        for row in reply_rows:
            author = reply_users.get(row.user_id)
            if not author:
                continue
            replies_by_rec.setdefault(row.recommendation_id, []).append(
                ReplyOut(
                    id=row.id,
                    user=user_public(author, reply_counts.get(row.user_id, 0), reply_last.get(row.user_id)),
                    body=row.body,
                    created_at=row.created_at,
                )
            )

    recommendations: List[RecommendationOut] = []
    my_recommendation = None
    for r in recs:
        author = rec_users.get(r.user_id)
        if not author:
            continue
        item = RecommendationOut(
            id=r.id,
            user=user_public(author, rec_counts.get(r.user_id, 0), rec_last.get(r.user_id)),
            review_text=r.review_text,
            recommended_dishes=r.recommended_dishes or [],
            images=images_by_user.get(r.user_id, []),
            replies=replies_by_rec.get(r.id, []),
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        recommendations.append(item)
        if viewer and r.user_id == viewer.id:
            my_recommendation = item

    my_reaction = None
    in_wishlist = False
    if viewer:
        reaction = db.execute(
            select(Reaction).where(
                Reaction.restaurant_id == restaurant.id, Reaction.user_id == viewer.id
            )
        ).scalar_one_or_none()
        my_reaction = reaction.type if reaction else None
        in_wishlist = (
            db.execute(
                select(WishlistItem).where(
                    WishlistItem.restaurant_id == restaurant.id, WishlistItem.user_id == viewer.id
                )
            ).scalar_one_or_none()
            is not None
        )

    return RestaurantDetail(
        **summary.model_dump(),
        address=restaurant.address,
        images=[_image_out(i) for i in images],
        recommendations=recommendations,
        oink_count=len(ctx.oink_ids.get(restaurant.id, [])),
        oinked_by=ctx.oinkers(restaurant.id),
        shamed_by=ctx.shamers(restaurant.id),
        my_reaction=my_reaction,
        my_recommendation=my_recommendation,
        in_my_wishlist=in_wishlist,
    )

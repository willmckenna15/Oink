"""Home feed — spec §5 / §6.2.

The feed is your sties: everything logged by anyone who shares a sty with you,
newest first. Not the whole farm — a farm you can see all of would make joining
a sty pointless. Somebody in no sty at all still sees their own activity, so a
new account's feed is never blank for want of a group.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import Reaction, Recommendation, Reply, Restaurant, RestaurantImage, User
from ..schemas import FeedItem, ImageOut
from .sties import sty_member_ids
from ..serializers import (
    RestaurantContext,
    last_logged_map,
    naive_dt,
    places_logged_counts,
    restaurant_summary,
    user_public,
)

router = APIRouter(tags=["feed"])


@router.get("/feed", response_model=List[FeedItem])
def get_feed(
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    # Pull a window of each activity type, merge, then sort — cheaper than a
    # UNION across two differently-shaped tables and plenty at this scale.
    window = limit + offset

    # Your sties, not the farm. Scoping here rather than after the merge means
    # the window is filled with activity you can actually see — filtering a
    # mixed page afterwards would hand back a short one.
    circle = sty_member_ids(db, viewer.id)

    recs = (
        db.execute(
            select(Recommendation)
            .where(Recommendation.user_id.in_(circle))
            .order_by(Recommendation.updated_at.desc())
            .limit(window)
        )
        .scalars()
        .all()
    )
    reactions = (
        db.execute(
            select(Reaction)
            .where(Reaction.user_id.in_(circle))
            .order_by(Reaction.created_at.desc())
            .limit(window)
        )
        .scalars()
        .all()
    )

    entries = [(r.updated_at, "recommendation", r) for r in recs]
    entries += [(a.created_at, a.type, a) for a in reactions]

    # One card per person per place. Adding a place auto-oinks it, so writing a
    # review would otherwise post twice about the same visit. Each entry keeps
    # the newer of the timestamps it absorbs, so the card sits where that
    # person's latest activity belongs.
    #
    # Which activity survives:
    #
    #   shame beats everything. Writing a place up and then shaming it is one
    #   verdict and the verdict is the shame — the review is the reason for it,
    #   not an endorsement. Ranking the review first is what had the feed
    #   announcing that somebody recommended a place they'd just condemned.
    #
    #   review beats an oink, which is the auto-oink from adding the place: it
    #   says everything the oink does and more.
    #
    # `rec` travels alongside whatever wins, so a shame still carries the
    # write-up, the dishes and the photos. Losing those would be the other half
    # of the same bug — the app asks people to say why they shamed something,
    # and then the feed would drop the answer.
    best: dict = {}
    for timestamp, activity, row in entries:
        key = (row.user_id, row.restaurant_id)
        rec = row if activity == "recommendation" else None
        current = best.get(key)
        if current is None:
            best[key] = (timestamp, activity, row, rec)
            continue

        current_ts, current_activity, current_row, current_rec = current
        newest = max(naive_dt(timestamp), naive_dt(current_ts))
        rec = rec or current_rec

        if "shame" in (activity, current_activity):
            winner = current_row if current_activity == "shame" else row
            best[key] = (newest, "shame", winner, rec)
        elif current_activity == "recommendation":
            best[key] = (newest, current_activity, current_row, rec)
        elif activity == "recommendation":
            best[key] = (newest, activity, row, rec)
        else:
            # Two reactions on one place can't both exist — one per user per
            # place — but keep the newer if the data ever says otherwise.
            best[key] = (
                current
                if naive_dt(current_ts) >= naive_dt(timestamp)
                else (timestamp, activity, row, rec)
            )

    entries = sorted(best.values(), key=lambda e: naive_dt(e[0]), reverse=True)
    page = entries[offset : offset + limit]
    if not page:
        return []

    place_ids = {row.restaurant_id for _, _, row, _ in page}
    user_ids = {row.user_id for _, _, row, _ in page}

    places = {
        p.id: p for p in db.execute(select(Restaurant).where(Restaurant.id.in_(place_ids))).scalars().all()
    }
    users = {u.id: u for u in db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()}
    ctx = RestaurantContext(db, list(place_ids))
    logged_counts = places_logged_counts(db, list(user_ids))
    last_logged = last_logged_map(db, list(user_ids))

    images = (
        db.execute(select(RestaurantImage).where(RestaurantImage.restaurant_id.in_(place_ids)))
        .scalars()
        .all()
    )
    images_by_place_user = {}
    for img in images:
        images_by_place_user.setdefault((img.restaurant_id, img.uploaded_by), []).append(
            ImageOut(id=img.id, url=img.url, uploaded_by=img.uploaded_by, created_at=img.created_at)
        )

    # One query for the replies on this page's reviews, then grouped by review.
    rec_ids = [rec.id for _, _, _, rec in page if rec is not None]
    replies_by_rec: Dict[str, List[str]] = {}
    reply_users: Dict[str, User] = {}
    if rec_ids:
        reply_rows = (
            db.execute(
                select(Reply).where(Reply.recommendation_id.in_(rec_ids)).order_by(Reply.created_at)
            )
            .scalars()
            .all()
        )
        for r in reply_rows:
            replies_by_rec.setdefault(r.recommendation_id, []).append(r.user_id)
        extra = {uid for uid in {r.user_id for r in reply_rows} if uid not in users}
        if extra:
            reply_users = {
                u.id: u
                for u in db.execute(select(User).where(User.id.in_(list(extra)))).scalars().all()
            }
        reply_users.update({uid: u for uid, u in users.items()})
        missing = [uid for uid in reply_users if uid not in logged_counts]
        if missing:
            logged_counts.update(places_logged_counts(db, missing))
            last_logged.update(last_logged_map(db, missing))

    items: List[FeedItem] = []
    for timestamp, activity, row, rec in page:
        place = places.get(row.restaurant_id)
        actor = users.get(row.user_id)
        if not place or not actor:
            continue

        review_text: Optional[str] = None
        dishes: List[str] = []
        item_images: List[ImageOut] = []
        repliers: List[str] = []
        reply_count = 0
        if rec is not None:
            review_text = rec.review_text
            dishes = rec.recommended_dishes or []
            item_images = images_by_place_user.get((place.id, actor.id), [])
            thread = replies_by_rec.get(rec.id, [])
            reply_count = len(thread)
            # Distinct people, first-reply order — three faces is all the strip
            # shows, and the same person twice tells you nothing.
            seen: set = set()
            for uid in thread:
                if uid not in seen:
                    seen.add(uid)
                    repliers.append(uid)

        items.append(
            FeedItem(
                id=row.id,
                activity=activity,
                user=user_public(actor, logged_counts.get(actor.id, 0), last_logged.get(actor.id)),
                restaurant=restaurant_summary(place, ctx, viewer.id),
                review_text=review_text,
                recommended_dishes=dishes,
                images=item_images,
                repliers=[
                    user_public(reply_users[uid], logged_counts.get(uid, 0), last_logged.get(uid))
                    for uid in repliers
                    if uid in reply_users
                ],
                reply_count=reply_count,
                created_at=timestamp,
            )
        )
    return items

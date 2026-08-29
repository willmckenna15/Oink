"""Reporting, blocking, account deletion, and the queue an admin works from.

The three things a private app has to have before it can take a stranger's
money: a way to flag content, a way to stop seeing someone, and a way to leave
that actually removes you.

Who moderates: there is no global admin role — being an admin is a property of a
*membership* — so the moderators of a report are the admins of the sties the
reporter is in. That keeps moderation inside the group it belongs to rather than
inventing a platform-wide superuser.
"""

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from .. import security, storage
from ..db import get_db
from ..deps import get_current_user
from ..models import (
    AuthToken,
    Block,
    Reaction,
    Recommendation,
    Reply,
    Report,
    Restaurant,
    RestaurantImage,
    Sty,
    StyJoinRequest,
    StyMember,
    User,
    WishlistItem,
)
from ..schemas import (
    AccountOut,
    BlockOut,
    DeleteAccountRequest,
    ReportCreate,
    ReportOut,
    ReportResolve,
)
from ..serializers import last_logged_map, places_logged_counts, user_public

router = APIRouter(tags=["safety"])


def _as_public(db: Session, users: List[User]):
    ids = [u.id for u in users]
    counts = places_logged_counts(db, ids)
    last = last_logged_map(db, ids)
    return {u.id: user_public(u, counts.get(u.id, 0), last.get(u.id)) for u in users}


# --- Your own account -------------------------------------------------------


@router.get("/account", response_model=AccountOut)
def my_account(db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    return AccountOut(
        id=viewer.id,
        username=viewer.username,
        display_name=viewer.display_name,
        email=viewer.email,
        email_verified=viewer.email_verified_at is not None,
        is_sty_admin=_is_any_sty_admin(db, viewer.id),
    )


# --- Blocking ---------------------------------------------------------------


@router.get("/blocks", response_model=List[BlockOut])
def list_blocks(db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    rows = db.execute(select(Block).where(Block.blocker_id == viewer.id)).scalars().all()
    users = db.execute(select(User).where(User.id.in_([r.blocked_id for r in rows]))).scalars().all()
    public = _as_public(db, users)
    return [
        BlockOut(user=public[r.blocked_id], created_at=r.created_at)
        for r in rows if r.blocked_id in public
    ]


@router.put("/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def block_user(user_id: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    if user_id == viewer.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You can't block yourself")
    if not db.get(User, user_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such user")

    exists = db.get(Block, {"blocker_id": viewer.id, "blocked_id": user_id})
    if not exists:
        db.add(Block(blocker_id=viewer.id, blocked_id=user_id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def unblock_user(user_id: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    db.execute(delete(Block).where(Block.blocker_id == viewer.id, Block.blocked_id == user_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def blocked_ids(db: Session, viewer_id: str) -> set:
    """Everyone hidden from this viewer, in both directions.

    A block has to cut both ways. If it only hid the blocked person's content,
    the person you blocked could still read and reply to yours, which is the
    half of the problem that actually matters.
    """
    rows = db.execute(
        select(Block).where(or_(Block.blocker_id == viewer_id, Block.blocked_id == viewer_id))
    ).scalars().all()
    return {r.blocked_id if r.blocker_id == viewer_id else r.blocker_id for r in rows}


# --- Reporting --------------------------------------------------------------


@router.post("/reports", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
def create_report(
    payload: ReportCreate,
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    existing = db.execute(
        select(Report).where(
            Report.reporter_id == viewer.id,
            Report.target_type == payload.target_type,
            Report.target_id == payload.target_id,
        )
    ).scalar_one_or_none()
    if existing:
        # Reporting twice is a no-op rather than an error: from the reporter's
        # side the thing they wanted has already happened.
        report = existing
    else:
        report = Report(
            reporter_id=viewer.id,
            target_type=payload.target_type,
            target_id=payload.target_id,
            reason=payload.reason.strip(),
        )
        db.add(report)
        db.commit()
        db.refresh(report)

    public = _as_public(db, [viewer])
    return ReportOut(
        id=report.id, reporter=public[viewer.id], target_type=report.target_type,
        target_id=report.target_id, reason=report.reason, state=report.state,
        created_at=report.created_at, resolved_at=report.resolved_at,
        resolution_note=report.resolution_note,
    )


def _is_any_sty_admin(db: Session, user_id: str) -> bool:
    return db.execute(
        select(StyMember).where(StyMember.user_id == user_id, StyMember.role == "admin")
    ).first() is not None


@router.get("/reports", response_model=List[ReportOut])
def list_reports(
    state: str = "open",
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """The moderation queue. Admin of at least one sty required."""
    if not _is_any_sty_admin(db, viewer.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only")

    rows = db.execute(
        select(Report).where(Report.state == state).order_by(Report.created_at.desc())
    ).scalars().all()
    reporters = db.execute(
        select(User).where(User.id.in_([r.reporter_id for r in rows]))
    ).scalars().all()
    public = _as_public(db, reporters)
    return [
        ReportOut(
            id=r.id, reporter=public[r.reporter_id], target_type=r.target_type,
            target_id=r.target_id, reason=r.reason, state=r.state,
            created_at=r.created_at, resolved_at=r.resolved_at,
            resolution_note=r.resolution_note,
        )
        for r in rows if r.reporter_id in public
    ]


@router.post("/reports/{report_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
def resolve_report(
    report_id: str,
    payload: ReportResolve,
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Close a report, and on 'actioned' remove the thing it was about."""
    if not _is_any_sty_admin(db, viewer.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only")

    report = db.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such report")

    if payload.state == "actioned":
        _remove_target(db, report.target_type, report.target_id)

    report.state = payload.state
    report.resolved_at = datetime.now(timezone.utc)
    report.resolved_by = viewer.id
    report.resolution_note = (payload.note or "").strip() or None
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _remove_target(db: Session, target_type: str, target_id: str) -> None:
    """Take down reported content. A reported *user* is not deleted — that is a
    decision with consequences an admin shouldn't make from a queue — so their
    reviews and replies come down and the account stays."""
    if target_type == "recommendation":
        db.execute(delete(Reply).where(Reply.recommendation_id == target_id))
        db.execute(delete(Recommendation).where(Recommendation.id == target_id))
    elif target_type == "reply":
        db.execute(delete(Reply).where(Reply.id == target_id))
    elif target_type == "restaurant":
        _delete_place_images(db, [target_id])
        db.execute(delete(Restaurant).where(Restaurant.id == target_id))
    elif target_type == "user":
        recs = db.execute(
            select(Recommendation.id).where(Recommendation.user_id == target_id)
        ).scalars().all()
        if recs:
            db.execute(delete(Reply).where(Reply.recommendation_id.in_(recs)))
        db.execute(delete(Recommendation).where(Recommendation.user_id == target_id))
        db.execute(delete(Reply).where(Reply.user_id == target_id))


def _delete_place_images(db: Session, restaurant_ids: List[str]) -> None:
    rows = db.execute(
        select(RestaurantImage).where(RestaurantImage.restaurant_id.in_(restaurant_ids))
    ).scalars().all()
    for row in rows:
        storage.delete_local_image(row.url)


# --- Leaving for good -------------------------------------------------------


@router.post("/account/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    payload: DeleteAccountRequest,
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Erase the account and everything personal in it.

    Places stay. A restaurant somebody added is a fact about the world that the
    rest of the sty is still using, and deleting it would take other people's
    reviews down with it — so the place survives with its `created_by` cleared.
    Everything that is *this person* — their reviews, replies, reactions,
    wishlist, memberships, uploaded photos, tokens — goes.
    """
    if not security.verify_password(payload.password, viewer.password_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Wrong password")

    uid = viewer.id

    # Their own uploads, off the disk as well as out of the table.
    images = db.execute(
        select(RestaurantImage).where(RestaurantImage.uploaded_by == uid)
    ).scalars().all()
    for image in images:
        storage.delete_local_image(image.url)
    db.execute(delete(RestaurantImage).where(RestaurantImage.uploaded_by == uid))

    recs = db.execute(select(Recommendation.id).where(Recommendation.user_id == uid)).scalars().all()
    if recs:
        db.execute(delete(Reply).where(Reply.recommendation_id.in_(recs)))
    db.execute(delete(Recommendation).where(Recommendation.user_id == uid))
    db.execute(delete(Reply).where(Reply.user_id == uid))
    db.execute(delete(Reaction).where(Reaction.user_id == uid))
    db.execute(delete(WishlistItem).where(WishlistItem.user_id == uid))
    db.execute(delete(StyMember).where(StyMember.user_id == uid))
    db.execute(delete(StyJoinRequest).where(StyJoinRequest.user_id == uid))
    db.execute(delete(AuthToken).where(AuthToken.user_id == uid))
    db.execute(delete(Block).where(or_(Block.blocker_id == uid, Block.blocked_id == uid)))
    db.execute(delete(Report).where(Report.reporter_id == uid))

    # Rows that only *refer* to them keep their shape and lose the name.
    db.execute(update(Restaurant).where(Restaurant.created_by == uid).values(created_by=None))
    db.execute(update(Sty).where(Sty.created_by == uid).values(created_by=None))
    db.execute(update(StyJoinRequest).where(StyJoinRequest.decided_by == uid).values(decided_by=None))
    db.execute(update(Report).where(Report.resolved_by == uid).values(resolved_by=None))

    db.execute(delete(User).where(User.id == uid))
    db.commit()

    from .. import config
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        config.COOKIE_NAME, path="/", httponly=True,
        samesite="lax", secure=config.COOKIE_SECURE,
    )
    return response

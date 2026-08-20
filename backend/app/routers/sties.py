"""The farm — sties, their pigs, and the queue at the door (spec §6.6).

A sty is a **lens**, not a wall. Membership scopes what somebody is shown; it
never hides a place, a review or a count. Every read here is therefore
unauthenticated beyond being signed in: you can look at any sty on the farm and
see who's in it. What you can't do is *join* one without being let in.
"""

from datetime import datetime
from typing import Dict, List, Optional, Sequence

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import STY_GROUNDS, STY_HUTS, Sty, StyJoinRequest, StyMember, User
from ..schemas import CreateStyRequest, StyDetail, StySummary, UpdateStyRequest, UserPublic
from ..serializers import last_logged_map, og_oink_counts, places_logged_counts, user_public

router = APIRouter(prefix="/sties", tags=["sties"])

# Faces on a hut's plaque. Three is what fits before the name is squeezed.
PLAQUE_FACES = 3


def _sty_or_404(db: Session, sty_id: str) -> Sty:
    sty = db.get(Sty, sty_id)
    if not sty:
        raise HTTPException(status_code=404, detail="No such sty")
    return sty


def _require_admin(db: Session, sty_id: str, user_id: str) -> None:
    row = db.get(StyMember, (sty_id, user_id))
    if not row or row.role != "admin":
        raise HTTPException(status_code=403, detail="Only this sty's admins can do that")


def _admin_count(db: Session, sty_id: str) -> int:
    return db.execute(
        select(func.count())
        .select_from(StyMember)
        .where(StyMember.sty_id == sty_id, StyMember.role == "admin")
    ).scalar_one()


def _people(db: Session, ids: Sequence[str]) -> Dict[str, UserPublic]:
    """Public shapes for a set of users, with the counts their avatars need."""
    ids = [i for i in dict.fromkeys(ids)]
    if not ids:
        return {}
    users = db.execute(select(User).where(User.id.in_(ids))).scalars().all()
    logged = places_logged_counts(db, ids)
    last = last_logged_map(db, ids)
    og = og_oink_counts(db, ids)
    return {
        u.id: user_public(u, logged.get(u.id, 0), last.get(u.id), og.get(u.id, 0))
        for u in users
    }


def _summaries(db: Session, viewer: User, sties: List[Sty]) -> List[StySummary]:
    if not sties:
        return []
    ids = [s.id for s in sties]

    rows = db.execute(select(StyMember).where(StyMember.sty_id.in_(ids))).scalars().all()
    by_sty: Dict[str, List[StyMember]] = {}
    for row in rows:
        by_sty.setdefault(row.sty_id, []).append(row)

    pending = db.execute(
        select(StyJoinRequest).where(
            StyJoinRequest.sty_id.in_(ids), StyJoinRequest.state == "pending"
        )
    ).scalars().all()
    pending_by_sty: Dict[str, List[StyJoinRequest]] = {}
    for row in pending:
        pending_by_sty.setdefault(row.sty_id, []).append(row)

    # Only the faces that will actually be drawn get looked up.
    wanted: List[str] = []
    for sty in sties:
        members = sorted(by_sty.get(sty.id, []), key=lambda m: (m.role != "admin", m.joined_at))
        wanted += [m.user_id for m in members[:PLAQUE_FACES]]
    people = _people(db, wanted)

    out: List[StySummary] = []
    for sty in sties:
        members = sorted(by_sty.get(sty.id, []), key=lambda m: (m.role != "admin", m.joined_at))
        mine = next((m for m in members if m.user_id == viewer.id), None)
        waiting = pending_by_sty.get(sty.id, [])
        out.append(StySummary(
            id=sty.id,
            name=sty.name,
            hut=sty.hut,
            ground=sty.ground,
            member_count=len(members),
            members=[people[m.user_id] for m in members[:PLAQUE_FACES] if m.user_id in people],
            is_member=mine is not None,
            is_admin=bool(mine and mine.role == "admin"),
            has_requested=any(r.user_id == viewer.id for r in waiting),
            # Only an admin is shown the queue; to everyone else it's zero.
            pending_count=len(waiting) if (mine and mine.role == "admin") else 0,
        ))
    return out


@router.get("", response_model=List[StySummary])
def list_sties(db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    """Every sty on the farm. Yours are marked rather than filtered — the farm
    view shows the whole thing, with the ones you're not in locked."""
    sties = db.execute(select(Sty).order_by(Sty.created_at)).scalars().all()
    return _summaries(db, viewer, sties)


@router.get("/{sty_id}", response_model=StyDetail)
def get_sty(sty_id: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    sty = _sty_or_404(db, sty_id)
    base = _summaries(db, viewer, [sty])[0]

    members = db.execute(select(StyMember).where(StyMember.sty_id == sty.id)).scalars().all()
    admin_ids = [m.user_id for m in members if m.role == "admin"]
    waiting = db.execute(
        select(StyJoinRequest).where(
            StyJoinRequest.sty_id == sty.id, StyJoinRequest.state == "pending"
        ).order_by(StyJoinRequest.requested_at)
    ).scalars().all()

    viewer_is_admin = base.is_admin
    people = _people(db, admin_ids + ([r.user_id for r in waiting] if viewer_is_admin else []))
    return StyDetail(
        **base.model_dump(),
        admins=[people[i] for i in admin_ids if i in people],
        # The queue is an admin's business. Nobody else is shown who is waiting.
        pending=[people[r.user_id] for r in waiting if viewer_is_admin and r.user_id in people],
    )


@router.get("/{sty_id}/members", response_model=List[UserPublic])
def sty_members(sty_id: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)):
    """Everyone in this sty — the crowd the field draws."""
    _sty_or_404(db, sty_id)
    rows = db.execute(select(StyMember).where(StyMember.sty_id == sty_id)).scalars().all()
    people = _people(db, [r.user_id for r in rows])
    return [people[r.user_id] for r in rows if r.user_id in people]


@router.post("", response_model=StyDetail, status_code=status.HTTP_201_CREATED)
def create_sty(
    payload: CreateStyRequest,
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Whoever makes a sty is its first admin, and anyone they add is added
    outright — an approval queue for your own new sty is friction with no
    purpose."""
    name = payload.name.strip()
    if db.execute(select(Sty).where(func.lower(Sty.name) == name.lower())).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A sty already goes by that name")
    if payload.hut not in STY_HUTS or payload.ground not in STY_GROUNDS:
        raise HTTPException(status_code=422, detail="No such hut or ground")

    sty = Sty(name=name, hut=payload.hut, ground=payload.ground, created_by=viewer.id)
    db.add(sty)
    db.flush()

    db.add(StyMember(sty_id=sty.id, user_id=viewer.id, role="admin"))
    for uid in dict.fromkeys(payload.member_ids):
        if uid == viewer.id or not db.get(User, uid):
            continue
        db.add(StyMember(sty_id=sty.id, user_id=uid, role="pig"))
    db.commit()
    return get_sty(sty.id, db, viewer)


@router.patch("/{sty_id}", response_model=StyDetail)
def update_sty(
    sty_id: str,
    payload: UpdateStyRequest,
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    sty = _sty_or_404(db, sty_id)
    _require_admin(db, sty_id, viewer.id)

    if payload.name is not None:
        name = payload.name.strip()
        clash = db.execute(
            select(Sty).where(func.lower(Sty.name) == name.lower(), Sty.id != sty.id)
        ).scalar_one_or_none()
        if clash:
            raise HTTPException(status_code=409, detail="A sty already goes by that name")
        sty.name = name
    if payload.hut is not None:
        if payload.hut not in STY_HUTS:
            raise HTTPException(status_code=422, detail="No such hut")
        sty.hut = payload.hut
    if payload.ground is not None:
        if payload.ground not in STY_GROUNDS:
            raise HTTPException(status_code=422, detail="No such ground")
        sty.ground = payload.ground

    db.commit()
    return get_sty(sty_id, db, viewer)


@router.post("/{sty_id}/requests", response_model=StyDetail)
def request_to_join(
    sty_id: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)
):
    _sty_or_404(db, sty_id)
    if db.get(StyMember, (sty_id, viewer.id)):
        raise HTTPException(status_code=409, detail="You're already a pig of this sty")

    existing = db.execute(
        select(StyJoinRequest).where(
            StyJoinRequest.sty_id == sty_id,
            StyJoinRequest.user_id == viewer.id,
            StyJoinRequest.state == "pending",
        )
    ).scalar_one_or_none()
    if not existing:
        db.add(StyJoinRequest(sty_id=sty_id, user_id=viewer.id))
        db.commit()
    return get_sty(sty_id, db, viewer)


@router.post("/{sty_id}/requests/{user_id}/{decision}", response_model=StyDetail)
def decide_request(
    sty_id: str,
    user_id: str,
    decision: str,
    db: Session = Depends(get_db),
    viewer: User = Depends(get_current_user),
):
    """Approve or decline. A declined pig is never told — they simply find they
    can ask again, which is a kinder outcome than being visibly turned down by
    friends."""
    _sty_or_404(db, sty_id)
    _require_admin(db, sty_id, viewer.id)
    if decision not in ("approve", "decline"):
        raise HTTPException(status_code=422, detail="approve or decline")

    row = db.execute(
        select(StyJoinRequest).where(
            StyJoinRequest.sty_id == sty_id,
            StyJoinRequest.user_id == user_id,
            StyJoinRequest.state == "pending",
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Nobody by that name is waiting")

    row.state = "approved" if decision == "approve" else "declined"
    row.decided_at = datetime.utcnow()
    row.decided_by = viewer.id
    if decision == "approve" and not db.get(StyMember, (sty_id, user_id)):
        db.add(StyMember(sty_id=sty_id, user_id=user_id, role="pig"))
    db.commit()
    return get_sty(sty_id, db, viewer)


@router.delete("/{sty_id}/members/{user_id}", response_model=StyDetail)
def remove_member(
    sty_id: str, user_id: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)
):
    """Leaving and being removed are the same operation seen from two sides, so
    they're one endpoint: you may always remove yourself, and an admin may
    remove anyone."""
    _sty_or_404(db, sty_id)
    row = db.get(StyMember, (sty_id, user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Not a pig of this sty")
    if user_id != viewer.id:
        _require_admin(db, sty_id, viewer.id)
    # The last admin can't go. An admin-less sty could never approve anyone
    # again, so it would be locked shut forever.
    if row.role == "admin" and _admin_count(db, sty_id) == 1:
        raise HTTPException(status_code=409, detail="A sty can't be left without an admin")

    db.delete(row)
    db.commit()
    return get_sty(sty_id, db, viewer)


@router.post("/{sty_id}/members/{user_id}/admin", response_model=StyDetail)
def promote(
    sty_id: str, user_id: str, db: Session = Depends(get_db), viewer: User = Depends(get_current_user)
):
    _sty_or_404(db, sty_id)
    _require_admin(db, sty_id, viewer.id)
    row = db.get(StyMember, (sty_id, user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Not a pig of this sty")
    row.role = "admin"
    db.commit()
    return get_sty(sty_id, db, viewer)


def sty_member_ids(db: Session, user_id: str) -> List[str]:
    """Everyone who shares a sty with this person, themselves included.

    This is what scopes the feed and the map's default view. Somebody in no sty
    at all still sees themselves, so a feed is never blank for want of a group.
    """
    mine = db.execute(
        select(StyMember.sty_id).where(StyMember.user_id == user_id)
    ).scalars().all()
    if not mine:
        return [user_id]
    peers = db.execute(
        select(StyMember.user_id).where(StyMember.sty_id.in_(mine))
    ).scalars().all()
    return list(dict.fromkeys(list(peers) + [user_id]))

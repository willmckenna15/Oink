"""Auth routes — spec §5 / §7."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config, mail, security
from ..db import get_db
from ..deps import get_current_user
from ..models import AuthToken, User
from ..schemas import (
    AuthResponse,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    SetEmailRequest,
    SignupRequest,
    UserPublic,
    VerifyEmailRequest,
)
from ..serializers import last_logged_map, places_logged_counts, user_public

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_MAX_AGE = config.JWT_EXPIRY_DAYS * 24 * 60 * 60


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=config.COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        # Secure once PUBLIC_BASE_URL is https; off for plain http://localhost,
        # where a Secure cookie would just be dropped.
        secure=config.COOKIE_SECURE,
        path="/",
    )


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, response: Response, db: Session = Depends(get_db)):
    existing = db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That username is taken")

    email = payload.email.lower().strip() if payload.email else None
    if email and db.execute(select(User).where(User.email == email)).scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email is already in use")

    user = User(
        username=payload.username,
        password_hash=security.hash_password(payload.password),
        display_name=payload.display_name.strip(),
        email=email,
        pig_avatar_config={"color": "pink", "hat": "none", "accessory": "none", "background": "apricot"},
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    if email:
        _send_verification(db, user)

    token = security.create_token(user.id, user.session_version)
    _set_session_cookie(response, token)
    return AuthResponse(token=token, user=user_public(user, 0))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if not user or not security.verify_password(payload.password, user.password_hash):
        # Same message either way — don't leak which usernames exist.
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong username or password")

    token = security.create_token(user.id, user.session_version)
    _set_session_cookie(response, token)
    counts = places_logged_counts(db, [user.id])
    last = last_logged_map(db, [user.id])
    return AuthResponse(
        token=token, user=user_public(user, counts.get(user.id, 0), last.get(user.id))
    )


@router.get("/me", response_model=UserPublic)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    counts = places_logged_counts(db, [user.id])
    last = last_logged_map(db, [user.id])
    return user_public(user, counts.get(user.id, 0), last.get(user.id))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout():
    """Clear the session cookie.

    The delete has to be set on the response that's actually returned. Setting
    it on an injected Response and then returning a fresh one threw the header
    away, so the cookie survived and signing out did nothing.

    The attributes have to match the ones it was set with, or the browser treats
    it as a different cookie and leaves the original in place.
    """
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        config.COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE,
    )
    return response


# --- Account recovery -------------------------------------------------------
#
# Two rules run through all of this. Nothing here ever reveals whether an
# address has an account — every path returns the same 204. And every route
# that proves possession of the account (a reset, a password change) bumps
# `session_version`, which strands every token already out there.


def _issue_token(db: Session, user: User, purpose: str, hours: int) -> str:
    """Mint a one-shot token, retiring any other of the same purpose."""
    db.query(AuthToken).filter(
        AuthToken.user_id == user.id,
        AuthToken.purpose == purpose,
        AuthToken.used_at.is_(None),
    ).update({"used_at": datetime.now(timezone.utc)})

    raw, digest = security.new_recovery_token()
    db.add(AuthToken(
        user_id=user.id,
        token_hash=digest,
        purpose=purpose,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=hours),
    ))
    db.commit()
    return raw


def _consume_token(db: Session, raw: str, purpose: str) -> User:
    """Redeem a one-shot token, or 400. Expired and already-used both count."""
    row = db.execute(
        select(AuthToken).where(
            AuthToken.token_hash == security.hash_recovery_token(raw),
            AuthToken.purpose == purpose,
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    expires = row.expires_at if row else None
    # SQLite hands back naive datetimes; compare like with like.
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    if not row or row.used_at is not None or expires is None or expires < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That link has expired or has already been used",
        )

    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That link is no longer valid")

    row.used_at = now
    db.commit()
    return user


def _send_verification(db: Session, user: User) -> None:
    raw = _issue_token(db, user, "email_verify", config.VERIFY_TOKEN_HOURS)
    mail.send_email_verification(
        user.email, user.display_name,
        f"{config.FRONTEND_BASE_URL}/verify-email?token={raw}",
    )


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Always 204, whether or not the address is known."""
    email = payload.email.lower().strip()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user:
        raw = _issue_token(db, user, "password_reset", config.RESET_TOKEN_HOURS)
        mail.send_password_reset(
            email, user.display_name,
            f"{config.FRONTEND_BASE_URL}/reset-password?token={raw}",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = _consume_token(db, payload.token, "password_reset")
    user.password_hash = security.hash_password(payload.password)
    # Whoever asked for this may be locked out *because* somebody else is in.
    user.session_version = (user.session_version or 1) + 1
    db.commit()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        config.COOKIE_NAME, path="/", httponly=True,
        samesite="lax", secure=config.COOKIE_SECURE,
    )
    return response


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if not security.verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Wrong password")
    user.password_hash = security.hash_password(payload.new_password)
    user.session_version = (user.session_version or 1) + 1
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/email", status_code=status.HTTP_204_NO_CONTENT)
def set_email(
    payload: SetEmailRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Set or change the address, and send a fresh verification to it."""
    email = payload.email.lower().strip()
    clash = db.execute(select(User).where(User.email == email, User.id != user.id)).scalar_one_or_none()
    if clash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email is already in use")

    user.email = email
    user.email_verified_at = None
    db.commit()
    _send_verification(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/verify-email", status_code=status.HTTP_204_NO_CONTENT)
def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)):
    user = _consume_token(db, payload.token, "email_verify")
    user.email_verified_at = datetime.now(timezone.utc)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout-everywhere", status_code=status.HTTP_204_NO_CONTENT)
def logout_everywhere(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cut every session loose, including this one."""
    user.session_version = (user.session_version or 1) + 1
    db.commit()

    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        config.COOKIE_NAME, path="/", httponly=True,
        samesite="lax", secure=config.COOKIE_SECURE,
    )
    return response

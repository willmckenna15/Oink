"""Shared FastAPI dependencies."""

from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from . import config, security
from .db import get_db
from .models import User


def get_current_user(
    db: Session = Depends(get_db),
    oink_session: Optional[str] = Cookie(default=None, alias=config.COOKIE_NAME),
    authorization: Optional[str] = Header(default=None),
) -> User:
    """Resolve the signed-in user from the session cookie, or a Bearer header.

    The cookie is what the browser uses; the Bearer header exists so the seed
    script and curl-based testing (spec §13) don't have to juggle cookies.
    """
    token = oink_session
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in")

    decoded = security.decode_token(token)
    if not decoded:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    user_id, session_version = decoded

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")

    # A password change, a reset, or signing out everywhere bumps the version
    # on the row, which strands every token minted before it.
    if session_version != (user.session_version or 1):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session ended")
    return user


def get_optional_user(
    db: Session = Depends(get_db),
    oink_session: Optional[str] = Cookie(default=None, alias=config.COOKIE_NAME),
    authorization: Optional[str] = Header(default=None),
) -> Optional[User]:
    """Same as get_current_user but returns None instead of raising."""
    try:
        return get_current_user(db=db, oink_session=oink_session, authorization=authorization)
    except HTTPException:
        return None

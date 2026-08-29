"""Password hashing, JWT issuing, and one-shot recovery tokens — spec §7."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import bcrypt
import jwt

from . import config


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed hash in the DB — a failed login, not a 500.
        return False


def create_token(user_id: str, session_version: int = 1) -> str:
    """Mint a session token stamped with the account's current session version.

    A JWT can't be withdrawn once issued, so the version is what makes logging
    out mean something: bump it on the user row and every token minted before
    now stops validating, wherever it is.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "sv": session_version,
        "iat": now,
        "exp": now + timedelta(days=config.JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[Tuple[str, int]]:
    """Return (user id, session version), or None if invalid/expired.

    Tokens minted before session versioning carry no `sv`. They're read as
    version 1 so existing sessions survive the upgrade rather than logging the
    whole userbase out.
    """
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    if not isinstance(sub, str):
        return None
    version = payload.get("sv", 1)
    return (sub, version if isinstance(version, int) else 1)


# --- One-shot tokens for password reset and email verification --------------

def new_recovery_token() -> Tuple[str, str]:
    """A URL-safe secret and its hash. Only the hash is ever stored."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_recovery_token(raw)


def hash_recovery_token(raw: str) -> str:
    """SHA-256 rather than bcrypt: these are 256 bits of randomness already, so
    there's nothing to slow a guesser down for, and lookup has to be by index."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()

"""Runtime configuration, read from the environment (optionally via .env).

Every setting has a working local default so `uvicorn app.main:app` runs with no
setup at all. Point DATABASE_URL / SUPABASE_* at real services to graduate off
the local-only defaults (see README "Switching to Supabase").
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")

# --- Database -------------------------------------------------------------
# Default is a local SQLite file so the API runs with zero external services,
# per the v1 "API runs locally only" constraint.
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'oink.db'}")
# Supabase (and Heroku) hand out `postgres://` URLs, which SQLAlchemy 2 refuses.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

# --- Auth -----------------------------------------------------------------
JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-insecure-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 30  # spec §7: flat 30-day expiry, no refresh dance in v1
COOKIE_NAME = "oink_session"

# --- Account email --------------------------------------------------------
# 'console' writes mail to the log. Anything else needs an implementation in
# mail.py. FRONTEND_BASE_URL is where reset/verify links point — the app the
# user is looking at, which is not the API.
MAIL_BACKEND = os.getenv("MAIL_BACKEND", "console")
MAIL_FROM = os.getenv("MAIL_FROM", "no-reply@oink.local")
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
RESET_TOKEN_HOURS = 2
VERIFY_TOKEN_HOURS = 48

# --- Image storage --------------------------------------------------------
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads")))
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "oink-images")

# --- Maps -----------------------------------------------------------------
# Optional. Without a key, Google Maps links are parsed from the URL itself and
# places are looked up via OpenStreetMap. With a key, the Places API is used.
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

# --- Server ---------------------------------------------------------------
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")

# The session cookie has to be Secure once the app is on HTTPS, and must not be
# over plain http://localhost — a Secure cookie is simply dropped there.
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "").strip().lower() in ("1", "true", "yes") or (
    PUBLIC_BASE_URL.startswith("https://")
)

USING_SQLITE = DATABASE_URL.startswith("sqlite")
USING_SUPABASE_STORAGE = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)

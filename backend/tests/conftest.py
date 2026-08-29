"""A fresh database per test, and helpers for signing people in.

Each test gets its own SQLite file rather than sharing one: these tests bump
session versions, delete accounts and mutate memberships, and a shared database
would make the order they run in matter.
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture()
def client(monkeypatch):
    tmp = tempfile.mkdtemp()
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/test.db"
    os.environ["UPLOAD_DIR"] = f"{tmp}/uploads"

    # Config and db read the environment at import, so drop anything already
    # imported by a previous test before building the app again.
    for name in [m for m in list(sys.modules) if m == "app" or m.startswith("app.")]:
        del sys.modules[name]

    from fastapi.testclient import TestClient
    from app.db import init_db
    from app.main import app

    init_db()
    with TestClient(app) as c:
        yield c


def signup(client, username, password="oink123", email=None, display_name=None):
    body = {
        "username": username,
        "password": password,
        "display_name": display_name or username.title(),
    }
    if email:
        body["email"] = email
    r = client.post("/api/v1/auth/signup", json=body)
    assert r.status_code == 201, r.text
    # Signing up sets the session cookie on the shared TestClient, and the API
    # rightly prefers a cookie over a Bearer header — so without this, the last
    # account created would be "the viewer" for every later request.
    client.cookies.clear()
    return r.json()


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def make_place(client, token, name="Test Place", place_id=None):
    """A place, with the Google id the API insists on to stop duplicates."""
    r = client.post("/api/v1/restaurants", headers=auth_header(token), json={
        "name": name, "kind": "restaurant", "category": ["italian"],
        "budget": "$$", "lat": 51.5, "lng": -0.1, "city": "London",
        "google_place_id": place_id or f"place-{name.lower().replace(' ', '-')}",
    })
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]

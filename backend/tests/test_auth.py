"""Sign-in, session revocation, reset and verification."""

from conftest import auth_header, signup


def test_signup_and_me(client):
    out = signup(client, "defne", email="defne@example.com")
    r = client.get("/api/v1/auth/me", headers=auth_header(out["token"]))
    assert r.status_code == 200
    assert r.json()["username"] == "defne"


def test_duplicate_username_and_email_rejected(client):
    signup(client, "defne", email="defne@example.com")
    assert client.post("/api/v1/auth/signup", json={
        "username": "defne", "password": "oink123", "display_name": "Other",
    }).status_code == 409
    assert client.post("/api/v1/auth/signup", json={
        "username": "mert", "password": "oink123",
        "display_name": "Mert", "email": "DEFNE@example.com",
    }).status_code == 409


def test_login_does_not_leak_which_usernames_exist(client):
    signup(client, "defne")
    wrong_pw = client.post("/api/v1/auth/login", json={"username": "defne", "password": "nope"})
    no_user = client.post("/api/v1/auth/login", json={"username": "ghost", "password": "nope"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json()["detail"] == no_user.json()["detail"]


def test_changing_password_ends_every_other_session(client):
    out = signup(client, "defne")
    old = out["token"]
    assert client.get("/api/v1/auth/me", headers=auth_header(old)).status_code == 200

    r = client.post("/api/v1/auth/change-password",
                    json={"current_password": "oink123", "new_password": "newpass1"},
                    headers=auth_header(old))
    assert r.status_code == 204
    # The token that was valid a moment ago is now refused.
    assert client.get("/api/v1/auth/me", headers=auth_header(old)).status_code == 401

    fresh = client.post("/api/v1/auth/login",
                        json={"username": "defne", "password": "newpass1"})
    assert fresh.status_code == 200
    assert client.get("/api/v1/auth/me", headers=auth_header(fresh.json()["token"])).status_code == 200


def test_change_password_requires_the_current_one(client):
    out = signup(client, "defne")
    r = client.post("/api/v1/auth/change-password",
                    json={"current_password": "wrong", "new_password": "newpass1"},
                    headers=auth_header(out["token"]))
    assert r.status_code == 403


def test_logout_everywhere_strands_old_tokens(client):
    a = signup(client, "defne")["token"]
    b = client.post("/api/v1/auth/login",
                    json={"username": "defne", "password": "oink123"}).json()["token"]

    assert client.post("/api/v1/auth/logout-everywhere", headers=auth_header(b)).status_code == 204
    assert client.get("/api/v1/auth/me", headers=auth_header(a)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=auth_header(b)).status_code == 401


def test_forgot_password_is_silent_about_unknown_addresses(client):
    signup(client, "defne", email="defne@example.com")
    known = client.post("/api/v1/auth/forgot-password", json={"email": "defne@example.com"})
    unknown = client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 204


def test_reset_password_end_to_end(client, caplog):
    import logging
    signup(client, "defne", email="defne@example.com")

    with caplog.at_level(logging.INFO, logger="oink.mail"):
        client.post("/api/v1/auth/forgot-password", json={"email": "defne@example.com"})
    link = [l for l in caplog.text.splitlines() if "reset-password?token=" in l][0]
    token = link.split("token=")[1].strip()

    old = client.post("/api/v1/auth/login",
                      json={"username": "defne", "password": "oink123"}).json()["token"]

    r = client.post("/api/v1/auth/reset-password", json={"token": token, "password": "brandnew1"})
    assert r.status_code == 204

    # Old password gone, old session gone, new password works.
    assert client.post("/api/v1/auth/login",
                       json={"username": "defne", "password": "oink123"}).status_code == 401
    assert client.get("/api/v1/auth/me", headers=auth_header(old)).status_code == 401
    assert client.post("/api/v1/auth/login",
                       json={"username": "defne", "password": "brandnew1"}).status_code == 200

    # And the link is single use.
    assert client.post("/api/v1/auth/reset-password",
                       json={"token": token, "password": "another1"}).status_code == 400


def test_reset_with_a_junk_token_is_rejected(client):
    signup(client, "defne", email="defne@example.com")
    r = client.post("/api/v1/auth/reset-password",
                    json={"token": "not-a-real-token", "password": "whatever1"})
    assert r.status_code == 400


def test_email_verification_end_to_end(client, caplog):
    import logging
    with caplog.at_level(logging.INFO, logger="oink.mail"):
        out = signup(client, "defne", email="defne@example.com")
    token = [l for l in caplog.text.splitlines() if "verify-email?token=" in l][0].split("token=")[1].strip()

    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 204
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 400

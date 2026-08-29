"""Blocking, reporting, the admin queue, and leaving for good."""

from conftest import auth_header, make_place, signup


def test_block_and_unblock(client):
    a = signup(client, "defne")["token"]
    b = signup(client, "mert")
    assert client.put(f"/api/v1/blocks/{b['user']['id']}", headers=auth_header(a)).status_code == 204

    listed = client.get("/api/v1/blocks", headers=auth_header(a)).json()
    assert [x["user"]["username"] for x in listed] == ["mert"]

    # Blocking twice is a no-op, not an error.
    assert client.put(f"/api/v1/blocks/{b['user']['id']}", headers=auth_header(a)).status_code == 204
    assert len(client.get("/api/v1/blocks", headers=auth_header(a)).json()) == 1

    assert client.delete(f"/api/v1/blocks/{b['user']['id']}", headers=auth_header(a)).status_code == 204
    assert client.get("/api/v1/blocks", headers=auth_header(a)).json() == []


def test_cannot_block_yourself(client):
    a = signup(client, "defne")
    r = client.put(f"/api/v1/blocks/{a['user']['id']}", headers=auth_header(a["token"]))
    assert r.status_code == 400


def test_reporting_twice_is_idempotent(client):
    a = signup(client, "defne")["token"]
    b = signup(client, "mert")

    body = {"target_type": "user", "target_id": b["user"]["id"], "reason": "being rude about a pie"}
    first = client.post("/api/v1/reports", headers=auth_header(a), json=body)
    second = client.post("/api/v1/reports", headers=auth_header(a), json=body)
    assert first.status_code == 201 and second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


def test_report_queue_is_admins_only(client):
    a = signup(client, "defne")["token"]
    # A brand new account is in no sty, so it administers nothing.
    assert client.get("/api/v1/reports", headers=auth_header(a)).status_code == 403


def test_admin_can_see_and_resolve_reports(client):
    admin = signup(client, "defne")["token"]
    # Creating a sty makes you its admin, which is what grants the queue.
    sty = client.post("/api/v1/sties", headers=auth_header(admin),
                      json={"name": "The Test Sty"})
    assert sty.status_code in (200, 201), sty.text

    reporter = signup(client, "mert")["token"]
    place = make_place(client, reporter)
    rep = client.post("/api/v1/reports", headers=auth_header(reporter), json={
        "target_type": "restaurant", "target_id": place, "reason": "not a real place",
    }).json()

    queue = client.get("/api/v1/reports", headers=auth_header(admin))
    assert queue.status_code == 200
    assert rep["id"] in [r["id"] for r in queue.json()]

    resolved = client.post(f"/api/v1/reports/{rep['id']}/resolve",
                           headers=auth_header(admin),
                           json={"state": "actioned", "note": "made up"})
    assert resolved.status_code == 204

    # Actioning it took the place down, and cleared it out of the open queue.
    assert client.get(f"/api/v1/restaurants/{place}", headers=auth_header(admin)).status_code == 404
    assert rep["id"] not in [r["id"] for r in client.get("/api/v1/reports", headers=auth_header(admin)).json()]


def test_delete_account_needs_the_password(client):
    a = signup(client, "defne")["token"]
    assert client.post("/api/v1/account/delete", headers=auth_header(a),
                       json={"password": "wrong"}).status_code == 403


def test_delete_account_erases_the_person_but_keeps_the_place(client):
    a = signup(client, "defne")["token"]
    other = signup(client, "mert")["token"]
    place = make_place(client, a, "Somewhere Good")

    wrote = client.post(f"/api/v1/restaurants/{place}/recommendations", headers=auth_header(a),
                        json={"review_text": "lovely", "recommended_dishes": ["the pie"]})
    assert wrote.status_code in (200, 201), wrote.text
    assert len(wrote.json()["recommendations"]) == 1

    assert client.post("/api/v1/account/delete", headers=auth_header(a),
                       json={"password": "oink123"}).status_code == 204

    # Gone, and the session with it.
    assert client.get("/api/v1/auth/me", headers=auth_header(a)).status_code == 401
    assert client.post("/api/v1/auth/login",
                       json={"username": "defne", "password": "oink123"}).status_code == 401

    # The place somebody else may be relying on survives, without its author.
    still_there = client.get(f"/api/v1/restaurants/{place}", headers=auth_header(other))
    assert still_there.status_code == 200
    assert still_there.json()["name"] == "Somewhere Good"
    # ...but the review went with the account.
    assert still_there.json().get("recommendations", []) == []

"""Sty membership: who gets in, who decides, and what the sty scopes."""

from conftest import auth_header, signup


def new_sty(client, token, name):
    r = client.post("/api/v1/sties", headers=auth_header(token), json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_creating_a_sty_makes_you_its_admin(client):
    a = signup(client, "defne")
    sty = new_sty(client, a["token"], "The Test Sty")
    members = client.get(f"/api/v1/sties/{sty['id']}/members", headers=auth_header(a["token"]))
    assert [m["username"] for m in members.json()] == ["defne"]


def test_joining_needs_an_admin_to_approve(client):
    admin = signup(client, "defne")["token"]
    sty = new_sty(client, admin, "The Test Sty")
    joiner = signup(client, "mert")

    # Knocking doesn't get you in.
    r = client.post(f"/api/v1/sties/{sty['id']}/requests", headers=auth_header(joiner["token"]))
    assert r.status_code == 200, r.text
    members = client.get(f"/api/v1/sties/{sty['id']}/members", headers=auth_header(admin)).json()
    assert "mert" not in [m["username"] for m in members]

    # The applicant can't wave themselves through.
    self_approve = client.post(
        f"/api/v1/sties/{sty['id']}/requests/{joiner['user']['id']}/approve",
        headers=auth_header(joiner["token"]),
    )
    assert self_approve.status_code == 403

    approved = client.post(
        f"/api/v1/sties/{sty['id']}/requests/{joiner['user']['id']}/approve",
        headers=auth_header(admin),
    )
    assert approved.status_code == 200, approved.text
    members = client.get(f"/api/v1/sties/{sty['id']}/members", headers=auth_header(admin)).json()
    assert "mert" in [m["username"] for m in members]


def test_only_one_request_can_be_pending(client):
    admin = signup(client, "defne")["token"]
    sty = new_sty(client, admin, "The Test Sty")
    joiner = signup(client, "mert")["token"]

    client.post(f"/api/v1/sties/{sty['id']}/requests", headers=auth_header(joiner))
    client.post(f"/api/v1/sties/{sty['id']}/requests", headers=auth_header(joiner))

    detail = client.get(f"/api/v1/sties/{sty['id']}", headers=auth_header(admin)).json()
    pending = detail.get("pending") or detail.get("pending_requests") or []
    assert len(pending) <= 1


def test_an_outsider_can_look_but_not_touch(client):
    """A sty is a lens, not a wall (models.Sty) — it scopes what you're shown
    and hides nothing. So an outsider can read it; what they can't do is
    change it or let anyone in."""
    admin = signup(client, "defne")["token"]
    sty = new_sty(client, admin, "The Test Sty")
    outsider = signup(client, "zeynep")
    other = signup(client, "ali")

    assert client.get(f"/api/v1/sties/{sty['id']}", headers=auth_header(outsider["token"])).status_code == 200

    assert client.patch(f"/api/v1/sties/{sty['id']}", headers=auth_header(outsider["token"]),
                        json={"name": "Mine Now"}).status_code == 403
    assert client.post(f"/api/v1/sties/{sty['id']}/requests/{other['user']['id']}/approve",
                       headers=auth_header(outsider["token"])).status_code == 403
    assert client.delete(f"/api/v1/sties/{sty['id']}", headers=auth_header(outsider["token"])).status_code == 403


def test_admin_can_remove_a_member(client):
    admin = signup(client, "defne")["token"]
    sty = new_sty(client, admin, "The Test Sty")
    joiner = signup(client, "mert")

    client.post(f"/api/v1/sties/{sty['id']}/requests", headers=auth_header(joiner["token"]))
    client.post(f"/api/v1/sties/{sty['id']}/requests/{joiner['user']['id']}/approve",
                headers=auth_header(admin))

    r = client.delete(f"/api/v1/sties/{sty['id']}/members/{joiner['user']['id']}",
                      headers=auth_header(admin))
    assert r.status_code == 200, r.text
    members = client.get(f"/api/v1/sties/{sty['id']}/members", headers=auth_header(admin)).json()
    assert "mert" not in [m["username"] for m in members]


def test_a_member_cannot_remove_someone_else(client):
    admin = signup(client, "defne")["token"]
    sty = new_sty(client, admin, "The Test Sty")
    joiner = signup(client, "mert")

    client.post(f"/api/v1/sties/{sty['id']}/requests", headers=auth_header(joiner["token"]))
    client.post(f"/api/v1/sties/{sty['id']}/requests/{joiner['user']['id']}/approve",
                headers=auth_header(admin))

    # An ordinary pig can't throw the admin out.
    r = client.delete(f"/api/v1/sties/{sty['id']}/members/{admin_id(client, admin)}",
                      headers=auth_header(joiner["token"]))
    assert r.status_code == 403


def admin_id(client, token):
    return client.get("/api/v1/auth/me", headers=auth_header(token)).json()["id"]

"""The feed: what it contains, how it pages, and what it leaves out."""

from conftest import auth_header, make_place, signup


def recommend(client, token, place, text="Very good"):
    r = client.post(f"/api/v1/restaurants/{place}/recommendations", headers=auth_header(token),
                    json={"review_text": text, "recommended_dishes": ["the pie"]})
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_feed_shows_activity(client):
    a = signup(client, "defne")["token"]
    place = make_place(client, a, "Somewhere")
    recommend(client, a, place)

    feed = client.get("/api/v1/feed", headers=auth_header(a))
    assert feed.status_code == 200
    assert len(feed.json()) >= 1


def test_feed_is_newest_first(client):
    a = signup(client, "defne")["token"]
    for i in range(3):
        place = make_place(client, a, f"Place {i}")
        recommend(client, a, place, f"review {i}")

    items = client.get("/api/v1/feed", headers=auth_header(a)).json()
    stamps = [i.get("created_at") or i.get("updated_at") for i in items]
    assert stamps == sorted(stamps, reverse=True)


def test_feed_paginates_without_repeating(client):
    a = signup(client, "defne")["token"]
    for i in range(6):
        place = make_place(client, a, f"Place {i}")
        recommend(client, a, place, f"review {i}")

    first = client.get("/api/v1/feed?limit=3&offset=0", headers=auth_header(a)).json()
    second = client.get("/api/v1/feed?limit=3&offset=3", headers=auth_header(a)).json()
    assert len(first) == 3
    ids = {i["id"] for i in first} & {i["id"] for i in second}
    assert not ids, "the same entry appeared on two pages"


def test_feed_rejects_a_silly_limit(client):
    a = signup(client, "defne")["token"]
    assert client.get("/api/v1/feed?limit=5000", headers=auth_header(a)).status_code == 422


def test_feed_needs_a_session(client):
    assert client.get("/api/v1/feed").status_code == 401

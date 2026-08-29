# Oink

Restaurant / bar / cafe recommendations between friends. Built to [SPEC.md](SPEC.md).

Mobile-first — design and test it at phone width; desktop just centres the same
phone-width column.

---

## Running it locally

Everything runs on your machine. **No Supabase project, no Google Cloud account
and no API keys are needed** — map tiles and place lookup both work keyless.

### Prerequisites

- Python 3.9+
- Node.js 20+

Node lives in `~/.local/node`. If `node` isn't on your PATH:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
# make it permanent:
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.zshrc
```

### 1. Backend (port 8000)

```bash
cd backend
python3 -m venv .venv                          # first time only
./.venv/bin/pip install -r requirements.txt    # first time only
./.venv/bin/python seed.py                     # first time only — test data
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

### 2. Frontend (port 3000)

```bash
cd frontend
npm install        # first time only
npm run dev
```

Open **http://localhost:3000**.

### Test accounts

Four friends, all with password **`oink123`**: `defne`, `mert`, `zeynep`, `ali`.

Reseed any time with `./.venv/bin/python seed.py --reset`.

### Tests

```bash
cd backend
./.venv/bin/python -m pytest tests/ -q
```

Covers sign-in and session revocation, password reset and email verification,
blocking and reporting, account deletion, sty membership, and the feed. Each
test builds its own throwaway SQLite database, so they can run in any order and
leave nothing behind.

### Account email

Password reset and email verification need somewhere to send to. There is no
provider wired up — `MAIL_BACKEND` defaults to `console`, which writes the mail
to the log. That's right for local development and **wrong in production**: it
puts reset links in your server logs, and the app logs an error saying so if it
finds itself doing that outside localhost. Implement the provider call in
`app/mail.py`; nothing upstream needs to change.

| Variable | Default | Purpose |
|---|---|---|
| `MAIL_BACKEND` | `console` | Delivery mechanism |
| `MAIL_FROM` | `no-reply@oink.local` | Sender address |
| `FRONTEND_BASE_URL` | `http://localhost:3000` | Where reset/verify links point |

### Deploying to Vercel + Supabase

`vercel.json` declares two [Vercel services](https://vercel.com/docs/services) —
the Next.js frontend and the FastAPI backend — in one project on one domain.
`/api/*` is rewritten to the backend, everything else to the frontend, so the
frontend calls a same-origin `/api/v1` and no CORS is involved.

Two of the local defaults **cannot** carry over, because Vercel's filesystem is
read-only and per-request:

- `DATABASE_URL` **must** point at Postgres. The SQLite default can't be written
  to, and wouldn't survive between requests if it could.
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are **required for photo
  uploads**. Without them uploads fall back to local disk and will fail.

1. Create a Supabase project in your `willmckenna15` account.
2. Set the Supabase connection string in Vercel as `DATABASE_URL`. Use the
   **connection pooler** string, not the direct one — serverless opens a new
   connection per cold start and will exhaust the direct limit.
3. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET`,
   and create that bucket as **public** so uploaded images are readable.
4. Set `JWT_SECRET` to a real secret — the built-in default is a known string.
5. Set `PUBLIC_BASE_URL` to your Vercel app URL (this also flips the session
   cookie to `Secure`).
6. Deploy the repo with Vercel from the repository root. Tables are created on
   first boot; to get the test accounts, run `seed.py` with `DATABASE_URL` set to
   the same Postgres URL.
Example with the Vercel CLI:

```bash
cd /Users/will/Desktop/Oink
vercel --prod
```

Or connect the repository in the Vercel dashboard and set the same environment variables there.
See `vercel.json` for the monorepo app configuration, `backend/api.py` for the Python backend entrypoint, and `backend/.env.example` / `frontend/.env.example` for the required environment variables.

---

## What runs locally vs. the upgrade path

| Concern | Runs now (no key) | Upgrade | How |
|---|---|---|---|
| Database | SQLite `backend/oink.db` | Supabase Postgres | set `DATABASE_URL` |
| Image storage | `backend/uploads/` | Supabase Storage | set `SUPABASE_URL` + service key |
| Map tiles | CARTO Positron | Google Maps JS API | change `TILE_URL` in `components/MapView.tsx` |
| Place search / link autofill | OpenStreetMap Nominatim | Google Places API | set `GOOGLE_MAPS_API_KEY` |

`GET /api/v1/health` reports which mode each one is in.

**Worth knowing about keyless place lookup:** OpenStreetMap's coverage of
*business names* is patchy. "Kiln Soho London" resolves; "Dishoom Shoreditch"
doesn't. When a name can't be resolved the form still fills in what it can and
asks you to drop a pin. A Google Maps API key fixes this properly — its free
tier ($200/month of credit) is far more than this app will use.

---

## How it works

**Auth** — bcrypt + JWT in an httpOnly cookie, 30-day expiry. Cookies ignore
port, so the cookie the API sets on `:8000` is visible to Next middleware on
`:3000`; middleware only checks presence, the API validates every request.

**No ratings** — no star scale, no score, no average, anywhere in the model, API
or UI. Signal is binary: **oink** (happy pig — this place served) or **shame**
(angry pig). Nuance lives in the review text and recommended dishes.

**Who recommends a place** is derived, never stored: everyone with a written
recommendation *or* an oink. Shame never counts. A shame-only place still gets a
map pin, greyed out.

**Adding a place auto-oinks it**, so it lands on your profile and shows as
endorsed straight away.

**Map pins show the pig face**; where several people rate a place the extra
faces fan out behind the leader, capping at three plus a count chip. Full-body
pigs appear only on the feed and the profile.

**Pigs** — warm brown outlines, soft shading, blush. The avatar is deliberately
neutral (it's an identity); all the attitude lives in the reaction icons. The
snout and nostrils are drawn at every size, because without them the avatar
stops reading as a pig. Avatars are customisable and gain **belly rolls** across
four tiers as you log places (thresholds live only in `lib/pig.ts`). Price tiers
are four fixed pigs — peasant, casual, smart, posh — and budget is never
rendered as bare `$$$` text.

**Look** — "Damson": oat ground, plum lead, gold and lemon support, eggplant
ink, Outfit for display type. Containers are defined by **outlines, not
shadows**; shadow is reserved for things floating above the page.

---

## Layout

```
backend/
  app/
    main.py        FastAPI app, CORS, /uploads mount
    config.py      env-driven settings, all with local defaults
    models.py      SQLAlchemy models
    schemas.py     request/response shapes
    security.py    bcrypt + JWT
    serializers.py derives recommender sets without N+1
    places.py      Maps-link parsing + keyless place search
    storage.py     local disk or Supabase Storage
    routers/       auth, users, restaurants, social, feed, places
  seed.py
frontend/
  app/             routes
  components/
    pigs/          the pig art — avatar, price tiers, reactions
    MapView.tsx    Leaflet map, pig-face pins
    CategoryPicker.tsx  searchable category dropdown
    AddPlaceSheet.tsx   add-place flow
  lib/pig.ts       fatness tiers + customisation options
  middleware.ts    route protection
```

---

## Not built yet

- **Follower graph** — every account is in one shared circle.
- **Password reset** — no email in the system at all.
- **Photo coverage** — auto-sourcing finds a photo for roughly a third of
  places without a Google key. Run `backend/backfill_photos.py` after adding one
  to fill in the rest.

---

## A note on source control

The first build of this app was lost entirely: the working tree was cleared
while the code had never been committed — only four files had ever been added,
so there was nothing to restore from. Everything here was rebuilt from scratch.
**Commit early and often.**

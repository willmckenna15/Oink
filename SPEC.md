# Oink — Product & Engineering Spec (v1)

## 0. Purpose of this document

This is the build spec for **Oink**, a restaurant/bar/cafe recommendation app for a closed friend group. It expands the original brainstorm into concrete scope, data model, API surface, page-level UX, and local dev setup. §15 lists the load-bearing assumptions.

**V1 constraint: the API runs locally only.** No deployment, no CDN — just `uvicorn` on localhost and `next dev` on localhost. Deployment is a later phase.

> **Naming note.** The app was called *Sofra* through the first build and was renamed to **Oink**. The `restaurants` table and `/restaurants` routes still carry the original naming and cover all three kinds (restaurant, bar, cafe) — kept so DB and API stay consistent. User-facing copy says "places".

---

## 1. Product overview

Oink is **Letterboxd for places you've eaten and drunk at**, shared only among people you know. No public discovery, no follower graph: every signed-up user is in the same friend circle and sees everyone else's activity.

Core loop: someone eats somewhere → logs a recommendation (review + recommended dishes + photos) or a quick reaction → it appears on friends' feed and as a pin on the shared map → friends can react (**oink** = agree, **shame** = disagree), wishlist it, or add their own take.

**There is deliberately no rating anywhere.** A recommendation is a recommendation.

## 2. V1 scope

In scope:
- Username/password sign-in with a persistent 30-day session
- Home feed of recent activity across all users
- Map + list discover view with filters, custom pins, add-place flow
- Place detail: recommendations with recommended dishes, images, oink/shame, wishlist
- Profile: logged places, wishlist (list + map), customisable pig avatar that fattens with activity
- FastAPI on `localhost:8000`, Next.js on `localhost:3000`

Out of scope for v1:
- Deployment; follower/following graph; public discovery
- Social login, password reset, email verification
- Push notifications, realtime feed; native apps; moderation tooling; i18n

## 3. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind — **mobile-first** |
| Backend | FastAPI (Python 3.9+) on Uvicorn, local only |
| Database | SQLite locally; Supabase Postgres via `DATABASE_URL` |
| Image storage | Local `uploads/`; Supabase Storage when configured |
| Maps | Leaflet + CARTO Positron tiles (**no API key**); Google Maps JS API is the upgrade path |
| Place lookup | OpenStreetMap Nominatim (**no key**); Google Places API when `GOOGLE_MAPS_API_KEY` is set |
| Auth | Custom username/password, bcrypt + JWT in an httpOnly cookie |

Data flow: **Next.js client → FastAPI (local) → database/storage.** The frontend never talks to the database directly.

## 4. Data model

```sql
users (id, username unique, password_hash, display_name, pig_avatar_config jsonb, created_at)

restaurants (
  id, name, kind check in ('restaurant','bar','cafe'),
  category text[],            -- vocabulary depends on kind, see §6.3
  budget check in ('$','$$','$$$','$$$$'),
  address, city, area, lat, lng,
  google_maps_url,            -- NULLABLE: adding a place never requires a link
  cover_image_url, created_by, created_at
)

restaurant_images (id, restaurant_id, uploaded_by, url, created_at)

recommendations (            -- review + dishes. No rating column, by design.
  id, restaurant_id, user_id,
  review_text not null, recommended_dishes text[],
  created_at, updated_at,
  unique (restaurant_id, user_id)
)

reactions (id, restaurant_id, user_id, type check in ('oink','shame'), created_at,
           unique (restaurant_id, user_id))

wishlist (user_id, restaurant_id, created_at, primary key (user_id, restaurant_id))
```

Implementation notes: uuids are stored as 36-char strings and `text[]` as JSON arrays, so one schema runs on both SQLite and Postgres. `recommendations.updated_at` exists so edits re-surface in the recency-ordered feed.

Derived, never stored:
- **Recommender set** = distinct users with a recommendation OR an `oink`. `shame` never counts.
- **Pig fatness tier** = count of distinct places logged (recommendation or oink), bucketed per §9.1.

## 5. API (`/api/v1`, base `http://localhost:8000`)

**Auth** — `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`

**Users** — `GET /users/{id|username|me}`, `GET /users/{…}/recommendations`, `PATCH /users/me`, `GET /users/me/wishlist`

**Places** — `GET /restaurants` (filters: `bbox`, `kind`, `category[]`, `budget[]`, `q`), `POST /restaurants`, `GET /restaurants/{id}`, `PATCH /restaurants/{id}`, `POST /restaurants/{id}/images`

**Social** — `POST|DELETE /restaurants/{id}/recommendations`, `POST|DELETE /restaurants/{id}/reactions`, `POST|DELETE /restaurants/{id}/wishlist`

**Feed** — `GET /feed`

**Place lookup** — `POST /places/parse-google-maps-link`, `GET /places/search?q=` (name search, keyless)

Detail responses include `oinked_by` and `shamed_by` as separate user lists (§6.4).

## 6. Frontend

**Mobile-first.** Every page is designed phone-first; desktop centres the same phone-width column. Bottom tab bar (Feed / Discover / Farm / You), bottom sheets rather than centred modals, ≥44px tap targets.

| Route | Purpose |
|---|---|
| `/sign-in` | Username/password |
| `/` | Friend activity feed |
| `/discover` | Map/list toggle, filters, add-place FAB |
| `/restaurant/[id]` | Place detail |
| `/profile/[username]` | Places logged + pig |
| `/profile/me/wishlist` | Wishlist, list/map toggle |

Middleware redirects unauthenticated requests to `/sign-in`.

### 6.2 Home feed
Two shapes, because a reaction isn't a small review:

- **Recommendation** — a card: full-body pig, name, timestamp, an untilted
  "recommends" sticker, a dashed rule, then a 74px thumbnail beside the place
  name, mono meta line, review text and dish tags.
- **Oink / shame** — a row with the same header as the card (pig, name, verdict
  pill, time right-aligned), then the place name in bold and its meta line.
  **No thumbnail.**

The row carries no thumbnail on purpose. Most places reached only by a reaction
have no photo, so the tile was the generated letter placeholder far more often
than a picture — a coloured square repeated down the page, carrying nothing. A
review keeps its thumbnail, which is where a photo actually is.

**An oink means two different things, and the feed says which.** Oinking a place
nobody has logged is *introducing* it, which is an event and gets its own row.
Oinking a place someone already logged is *agreeing*, which isn't news on its own
— it folds onto the log it agrees with and shows as one face, a `+n` count, and
the names.

The anchor is **the review if the place has one**, otherwise the first log of it
in the feed. A write-up is the thing worth reading, so agreement belongs on that
card even when somebody oinked the place first — and a place nobody has written
up keeps the oink row that introduced it. That trades strict chronology for
readability: an oink from Tuesday can appear under a review written on Thursday.

Nothing else folds. A **shame** stays its own row: putting a disagreement on
somebody's own card is a different decision from showing agreement, and one to
take separately. A **second recommendation** stays its own card — someone writing
their own review days later is exactly the kind of thing the feed exists to
surface, however many people got there first.

Adding a place auto-oinks it, so anyone who adds somewhere and writes it up holds
both rows; the feed endpoint collapses those to one card per person per place
with the review winning, so nobody appears to agree with themselves.

The feed is a recent-activity window, so an oink whose original log has scrolled
out of it has nothing to attach to and becomes its own row — the alternative
loses the event entirely.

No rating anywhere.

### 6.3 Discover
- Map default, framed on the logged places once on load.
- **Pins show one pig face**, plus a count chip when more than one person rates
  the place. A stacked fan was tried and crowded badly where pins sit close
  together. Shame-only places get a greyed-out pin with the angry pig.
- **Basemap** is CARTO Voyager at full contrast. Warming Positron into aged
  paper was tried so the map would sit in the oat palette, but it left roads too
  quiet to navigate by — on a map you actually use, contrast beats
  colour-matching.
- Tap pin → bottom sheet → View details.
- Filters: kind, budget (as price pigs), category.
- **Kind and cuisine prefill themselves.** OSM's `type` maps to kind
  (restaurant / bar / cafe) and its `cuisine` tag to category tags — Monmouth
  Coffee resolves to Cafe · Specialty Coffee, The Harp to Bar · Pub, Padella to
  Restaurant · Italian. Bars take their category from the type rather than the
  cuisine tag, since their vocabulary is fixed. A prefill never overwrites a
  choice the user has already made, and reverse-geocoded results are only
  trusted when the matched object is the venue itself rather than a neighbour.
- **Add-place flow — a Google Maps link is optional.** Four ways in: search by name (type-ahead), use current location, drop a pin, or paste a Maps link. Whenever a link or search result resolves, **the pin drops automatically**. Category is a **searchable dropdown** that filters remaining options as you type; bars use a fixed vocabulary, restaurants/cafes allow custom tags.
- Adding a place **auto-oinks it**, so it appears on your profile and as an endorsed pin straight away.

### 6.4 Place detail
Cover, name, kind, category, budget pig, address, Maps link (when present). Oink and Shame buttons (toggle, mutually exclusive). **Two labelled groups — "Oinked" and "Shamed" — listing each person's pig face and name underneath.** Wishlist toggle (hidden once you've been). Then the reviews list: each person's recommendation as its own card with their review, dish tags, photos and timestamp.

### 6.4b Photos
Every photo opens. Tapping the header carousel or any thumbnail under a review
raises a full-screen view on a solid dark ground — swipe or arrow between shots,
Escape or tap to close.

One component serves both surfaces, so it takes a list and an index rather than
a place: the carousel opens at whichever slide is showing, a review thumbnail at
the one tapped. The caption credits whoever uploaded it, which review photos
already know; a place's own listing photo says so instead, since nobody here
took it.

The viewer is **portalled onto `<body>`**. A z-index only ranks siblings inside
one stacking context, and this page has several — a sticky blurred header and a
fixed tab bar among them — so an overlay left in the tree paints under them
however high its z-index goes.

The ground is solid rather than a scrim: at 95% the layout behind stayed legible
enough to compete with the photo.

### 6.4a Replies
You can reply to a **review**, and only a review. An oink carries no text to
reply to, and letting every row start a thread turns the feed into a chat.

Threads are **flat** — no nesting. Twenty-odd friends arguing about one
restaurant don't need a tree, and threading doubles the layout work for nothing.

**The full thread lives on the place page**; the feed shows only faces and a
count. Reply bodies in the feed would grow cards without limit and undo the work
of making that page quiet, and **a reply never bumps a review** — re-ordering the
feed for one chatty thread breaks it for everything else. If replies should be
noticeable, that wants an unread marker on the tab, not a re-sort.

Only the reply's own author can delete it — not the review's author, who could
otherwise quietly clear disagreement off their own card.

### 6.5 Profile
**Full-body pig** at current fatness tier, display name, places-logged count, tier label and progress to the next one. Pig customiser (colour/hat/accessory/background). Places logged. Wishlist link.

### 6.6 The farm
The fourth tab. The farm is every sty on Oink, scattered across one flower
meadow you drag around and zoom; a **sty** is a group of pigs with its own hut
on that meadow and its own ground inside. The old single pigsty is now one sty
among many — **The OG Sty**, seeded with everyone and admined by the founders.

**A sty is a lens, not a wall.** You can see the whole farm from the outside:
every hut, its name, three faces and a count. What you can't do is walk into one
uninvited. A sty you're not in is drawn dimmed with two chains running in from
either side to a padlock hanging over the middle of its door; the chains and the
lock are at full strength, so it reads as a sty somebody locked rather than a
picture somebody faded. Tapping it says *you are not a pig of this sty* and
offers a request to join. Requesting twice does nothing — the request is
idempotent, and the button says `requested` afterwards.

**Huts are scattered, not listed.** Each sty's patch of grass comes from a hash
of its id, so it sits in the same place every visit and you find it by learning
where it is — the same bargain the sty itself makes with its pigs. Yours are
seeded from the middle outward and everyone else's from the edge inward, so the
default view opens on your own. Toggling *my sties* / *the whole farm* reframes
the view rather than reflowing it: the huts never move, the camera does. Search
does the same, panning to whatever matches — a sty by name, or a pig by name or
username.

**Six huts, six grounds**, chosen independently by a sty's admins:
corrugated sty, beach hut, igloo, volcano, sand castle, nightclub; and flower
meadow, beach, snow, lava, desert, nightclub. The ground is a repeating tile
inside the panned layer, so it scales with the zoom and never runs out. Scenery
that belongs to the screen rather than the field is pinned to the viewport —
snow's mountains stay in a band at the very top, the beach's sea stays along the
bottom, the nightclub's ball and lasers stay overhead — because panning
shouldn't sail the sea up into the sky. Dark floors put a patch of light under
each pig, or a charcoal one disappears into the lava.

**Every sty has its own throne and its own shame enclosure.** Both the
candidates and the *votes* are that sty's: a pig's count is the oinks and shames
its own members have left on the places that pig put on the map first. A throne
decided by the whole farm would just install the farm's favourite in every sty
at once, and the point of splitting the farm up was that each group makes up its
own mind — a small sty can crown somebody instead of being permanently outvoted
by a big one. Leaving the counts off isn't neutral either: they default to zero,
so every sty came up with an empty throne and an empty enclosure however long
the group had been oinking at each other.

**Admins.** Whoever makes a sty is its first admin. An admin approves and
declines join requests — the queue sits at the top of the sty screen for admins
and nowhere else, because it's a job to do and should be in the way — and can
remove a pig, make another pig an admin, and change the hut and ground. A sty
can't be left without an admin; the last one is blocked from leaving. An admin
can also knock the sty down, behind a confirm that names it — nothing a sty
holds is unique to it, since places, oinks, reviews and shames all belong to the
pigs, so demolishing one loses the grouping and nothing else. The OG Sty is no
different: its admins are trusted with it the same way.

The sty page's server read is best-effort, exactly as `serverFetch` promises —
it exists to put the sty in the HTML, not to decide whether the page may exist.
Calling `notFound()` on a null turned every transient hiccup, an API restart or
a cold start, into a hard 404 on a sty that was there all along. Only a sty the
API positively denies says it's gone; anything else leaves the screen waiting
with a retry.

**The feed and the map are scoped to your sties.** The feed is everything logged
by anyone who shares a sty with you — a farm you could see all of would make
joining a sty pointless. Somebody in no sty at all still sees their own activity,
so a new account's feed is never blank for want of a group. The map's filter
adds a lens: all my sties (the default), any one sty, or the whole farm. Unlike
the map's other filters this one can't run on the client — a place logged only
by a sty you're not in was never in the payload, and shouldn't be.

Inside a sty, the field behaves as the pigsty always did:

**No names in the field.** At phone width twenty-odd labels can't avoid fighting
the art, and the fix isn't smaller type — it's not drawing them. Tap a pig and
the bar underneath says who it is, with their places, og oinks and tier. That's
also how you find out who a penguin is in the game this borrows from.

**Positions are stable.** Each pig's patch of ground comes from a hash of its
user id, not its index in the list, so nobody moves when somebody new joins — the
sty is only navigable if you can learn where your friends stand. Cells are
claimed in id order with linear probing, so an arrival takes an empty cell rather
than displacing anyone. Jitter is capped at half a cell, so two pigs can never
overlap however they're seeded.

**The field is sized from the crowd**, not fixed: five pigs shouldn't be marooned
in a paddock built for thirty. It opens framed on everyone, and an `all` button
returns to that view.

Avatars are full-body, so anyone with a truffle brings it along. Idle bob is
staggered per pig off the id hash so the crowd breathes out of step, and it stops
entirely under `prefers-reduced-motion`.

**Pinch to zoom, drag to pan**, and pinching zooms about the point between your
fingers rather than a corner — the field holds still under whatever you're
looking at. Coming out of a pinch re-anchors to the finger still down, or the
field jumps by however far apart the two were.

Pointer capture is taken **late** — once a drag passes the slop threshold or a
second finger lands — never on the first touch. A captured pointer retargets the
following `click` to the capturing element, so grabbing it up front sends every
tap to the field instead of the pig that was tapped.

**The ground never runs out.** Scenery used to be positioned nodes inside the
field, so pulling back ran past its edge into bare green. It's now one repeating
tile laid far beyond the pigs, which keeps going however far out you go and
still scales with the zoom because it sits inside the transformed layer. The
tile is a data URI run through `encodeURIComponent` rather than escaped by hand:
a raw `#` starts a fragment and truncates the URI mid-attribute, which fails
silently — the element still paints, just with no image on it.

Search pans to the first match and dims the rest rather than filtering the field
down — the sty should stay a place you're looking around, not collapse into a
list.

`/pigsty` redirects to `/farm`, so old links still work.

## 7. Auth

bcrypt password hashes; JWT (HS256) in an httpOnly cookie, flat 30-day expiry, no refresh. Cookies ignore port, so the cookie set by `:8000` is visible to Next middleware on `:3000`; middleware only checks presence, the API validates every request. No password reset in v1.

## 8. Reactions & recommendations

**No ratings anywhere** — no star scale, no numeric score, no average. Signal is binary; nuance lives in the review text and dishes.

- **Oink** — "this place served". Counts toward the recommender set and pins.
- **Shame** — disagreement. Never counts toward the recommender set; the place still shows on the map, greyed out.
- **Recommendation** — review text (required) + dishes + optional photos. Also counts. Writing one clears any shame you'd left.
- One reaction and one recommendation per user per place; re-submitting replaces.
- You can't wishlist a place you've already logged.

## 9. Pig systems

### 9.1 Avatar pig
Drawn in the reference style: a warm brown outline (**never black**), soft shaded
fill, blush cheeks, wide-set dot eyes with a highlight, snub snout, small upright
ears, tiny trotters, curly tail.

The avatar is deliberately **neutral** — it is an identity, not a mood. All the
expression in the interface comes from the reaction icons instead.

**Modelling, not just outline.** A flat fill inside a uniform stroke reads as a
die-cut sticker. Volume comes from three soft passes clipped inside each form —
a core shadow down the lower-right, a broad highlight on the upper left, and a
contact shadow where the head meets the body — all Gaussian-blurred, with a
thinner stroke so the line stops dominating.

Construction: a rounded body with the head overlapping it, so the whole thing
reads as one silhouette. Arms are drawn **on top of** the body edges in the
slightly darker ear tone — that's what makes them read as arms in front. Drawn
behind the body they look like detached limbs floating beside a ball.

The tail starts outside the right arm's outer edge, so it comes off the rump
rather than appearing to grow out of the arm.

**The snout and its two nostrils are drawn at every size.** They are the most
recognisably pig feature, and dropping them at small sizes makes the avatar read
as a generic animal blob.

Fat is drawn as **volume**, not stripes — chest fat above, one gut below, each
lit from above and creased underneath so it hangs rather than floats:

| Places logged | Tier | Build |
|---|---|---|
| — | Dead Pig | gaunt, drained of colour, X'd eyes |
| 0–4 | Slim | narrow body, no rolls |
| 5–9 | Regular | wider, some gut |
| 10–14 | Chubby | chest and gut, second chin |
| 15–19 | Fat | both full, widest silhouette |
| 20+ | Hunky | the ladder turns a corner — pecs and abs, not bulk |

**Pigs starve.** The tier you get is the tier you earned minus one step for every
**fortnight** without logging anywhere, floored at the Dead Pig. A fortnight, not
a week: a friend group can easily go a month without eating out, and weekly decay
killed a maxed-out pig in four. Somebody who has never logged doesn't rot — they
sit at Slim until the first log starts the clock. Nothing has to be earned twice:
one log anywhere restores the earned tier.

Hunky is the only tier that isn't an ellipse — wide across the shoulders and
drawn in at the waist. Everything hanging off the torso follows the same
silhouette, **costumes included**: a garment takes the body's own outline inset
rather than assuming a fixed shape, or it hangs off a body that isn't there.

Thresholds and decay live only in `lib/pig.ts`.

**Face variant** is used on map pins and in dense lists; the **full body**
appears only on the feed and the profile.

**Species** — pig, boar or hog, chosen in the customiser with **pig as the
default** so nobody has to decide. **All three share one set of 13 coats** — playful (pink, mint, seafoam, lilac,
butter) alongside naturalistic (umber, charcoal, ginger, sand) — so a mint boar
is as possible as a pink pig. The species is the silhouette; the coat is taste.
Each coat carries its own outline colour, since one shared brown line suited
neither a charcoal boar nor a pink pig. Only the starting colour differs by
species: pig begins pink, boar umber, hog sand. Species is the only avatar attribute still
legible at 24px on a map pin, which is exactly where telling friends apart
matters. Boar and hog carry their own coats, ears, tusks and darker outlines;
all three keep the fatness tiers, nostrils and shading.

**OG oinks.** Being first to put a place on the map is counted on the profile as
**OG oinks**, beside the places count. `OG` is the one thing in the app that
stays uppercase: the app speaks in lowercase, but an initialism set in lower case
reads as a word rather than an abbreviation. It's kept off the feed cards deliberately:
review-first anchoring hands the card to whoever wrote the place up, and adding a
third credit to every card was noise. The profile is where a finder's tally
belongs, and it's durable in a way a scrolling card never is.

### 9.2 Price-tier pig
Budget is **never** bare `$` text. Four fixed pigs, always with the label beside them: `$` peasant (patched smock, straw), `$$` casual (tee), `$$$` smart (collared shirt), `$$$$` posh (top hat, monocle, cigar, tailcoat).

### 9.3 Costumes
The avatar has four independent slots — **costume, headwear, face, companion** —
and the point is that they **stack**. Club Penguin's memorable items were never
garments, they were characters, and a few dozen items produced hundreds of
visibly distinct penguins only because several could be worn at once.

Three everyday tops (hoodie, puffer, dungarees) sit alongside nine costumes:
princess, pirate, raver, astronaut, superhero, ninja, dinosaur, rockstar, chef.

A wizard and a hot dog were built and cut. Neither drew well: the robe was a flat
field the stars sat on rather than in, and the bun halves fought the body's
outline instead of wrapping it. The wizard *hat* survives as headwear, which is
where it was working anyway.

Two rules make a costume read as worn rather than stuck on:

- **It changes the silhouette.** A garment that only recolours the torso reads as
  a bib. The puffer is drawn wider than the body, the gown flares past the
  trotters, hoods sit behind the head.
- **Sleeves recolour the arms.** Arms left in the coat colour were what made the
  first attempt fail, more than any amount of detail on the chest.

Costumes are drawn once in normalised space (waist 30, head radius 27.5) and
scaled about the body or head centre, so one set of paths fits all four fatness
tiers. The two anchors are separate because head and waist grow at different
rates between tiers.

Each costume names the headwear it implies, which fills an **empty** hat slot but
never overrides a hat already chosen. The slots stay independent on purpose: a
viking helmet over a princess gown is a legitimate outcome, and that freedom is
where the humour lives.

The face slot is separate from headwear so sunglasses can be worn under a hat,
and it's the one slot that takes **several at once** — specs, a moustache and a
cigar sit on three different parts of a face, so picking one shouldn't take the
others off. It's stored as a list; a lone string is still read, so configs saved
before the slot took more than one still render. In the picker `none` is the
empty set rather than an option of its own, since a "none" chip you can tick
alongside the others reads as a contradiction.

**Hats that sit down over the ears hide them** rather than poking them through —
a cap with two ears out the sides of it reads as a mistake, not a style. Cap,
beret, bucket, chef, top hat, beanie, pirate, sun hat, headphones, viking, flat
cap, wizard and helmet all cover; the party cone, crown, bandana and flower crown
perch on top and leave the ears showing.

Costumes and companions need a body, so they appear only where the full-body
variant does — the feed and the profile. Map pins draw the head alone and are
unaffected.

### 9.4 The truffle
The puffle role: a creature standing beside the animal rather than a prop it has
to hold, since the pig has no hand to hold anything with.

There is **exactly one**, and that's the point. A dozen pets were drawn — piglet,
duckling, parrot, fox, bunny and the rest — and cut, because a menagerie dilutes
the joke instead of extending it. The truffle is the thing a pig is actually
hunting, so it carries the slot alone.

Its colours are the four real varieties — burgundy, black périgord, white alba,
summer — **plus the thirteen coats**, derived from the same palette rather than
hand-picked a second time, so the two sets can't drift apart and a truffle that
matches your animal comes free. Naturalistic first, playful after, so the real
ones read as the default and the fun ones as a departure from it.

The warts carry their own tone, separate from the shading colour. On a pale coat
the two are nearly the same value and the warts turn to noise; they need a tone
that stays dark whatever the fill is, or a pink truffle reads as a scribble
rather than a truffle.

Since it is the only companion, the variety picker doubles as the on/off control:
one row in the customiser rather than two stacked ones.

It stands to the animal's **left**, since the tail comes off the right
hip. Its position is offset from the body but clamped to the frame edge — a round
animal leaves no clear space beside it, so the companion may stand slightly in
front rather than shrinking to fit. A companion that shrank would read as further
away, not as a smaller creature.

## 10. Aesthetic — "Damson"

Warm, outlined, and a bit grumpy. Derived from supplied references: a pig
character sheet, two colour palettes, and six layout references.

**The structural rule, taken from every layout reference: containers are defined
by OUTLINES, not shadows.** Shadow is reserved for things genuinely floating
above the page — sheets, dropdowns, the FAB. This is the single biggest
difference from earlier iterations.

| Role | Colour |
|---|---|
| Ground | oat `#F4EEDC` |
| Surface | cream `#FFFDF6` |
| Ink | eggplant `#4D303F`, headings `#2F2A35` |
| Lead | plum `#914E56` |
| Support | antique gold `#CFA51F`, lemon `#E6D389` |
| Shame | rust `#A9503C` |
| Accent | light lilac `#D8B5F7` |

- **Type**: Outfit (500–800) for the wordmark, headings and place names.
  Body copy stays on Nunito Sans. **Mono micro-labels** (uppercase, letter-
  spaced) carry timestamps, place meta lines and status pills, so the display
  face is reserved for things that are actually headings.
- **Wordmark**: lowercase `oink`, olive `#806B28`, tight tracking.
- **The app speaks in lowercase.** Headings, buttons, nav, form labels, empty
  states — anything the app writes about itself. Never applied to user content:
  place names, display names, review text and dish tags keep whatever casing
  they arrived with. Mono micro-labels stay uppercase, which is the one
  deliberate exception and reads as a different register rather than an
  inconsistency.
- **Badges** — `oinked`, `shamed`, `recommends` — are outlined, **never
  rotated**, and set in the display face **lowercase**, matching the wordmark.
- **Dashed rules** separate a card's header from its body.
- **Dish tags are lilac**, distinct from the gold accents.
- **Lemon** appears on exactly two surfaces — the profile header and empty
  states — where there's no photography for it to fight.
- **Photos** get a whisper of warmth (94% saturation, 7% plum multiply) so they
  stop clashing without becoming a duotone.
- **Shape**: 2px eggplant outlines, 14px card radius, full-pill buttons.
- **Reaction icons are pigs with attitude** — a delighted squeezed-eye grin for
  oink, a furious angled-brow scowl with a steam puff for shame. Never a clock
  or a bell.
- **Placeholder imagery** is drawn from the palette, so a place with no photo
  still belongs to the page.
- Map tiles are CARTO Voyager on a cream ground, with pins outlined in eggplant
  to match the rest of the app.

## 11. Local development

Prerequisites: Node 20+, Python 3.9+. **No accounts or API keys needed.**

```bash
# backend
cd backend && python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python seed.py
./.venv/bin/uvicorn app.main:app --reload --port 8000

# frontend
cd frontend && npm install && npm run dev
```

CORS allows `http://localhost:3000`. Tables are created on boot.

## 12. Testing

Run both servers, seed, and walk the golden path **at a phone viewport (390×844)**: sign in → feed → map → pin tap → filters → detail → oink → write a review with dishes → profile → customise pig → wishlist → add a place. Check the bottom tab bar, map bottom sheet, and add-place flow specifically.

## 13. Source control

**Commit early and often.** The first build was lost entirely because the working tree was cleared while the app had never been committed — only 4 files had ever been added, so there was nothing to restore. Every meaningful chunk of work gets committed.

## 14. Still needs art/content
- Commissioned pig illustration, if the built SVG family isn't enough
- Empty-state illustrations
- Final font/colour sign-off

## 15. Assumptions

- **"Friends" = all signed-up users.** One shared circle; feed and map show everyone. Invite-gated groups would change the auth/data model.
- **Custom JWT, not Supabase Auth** — the brainstorm wanted plain username/password without email-shaped signup.
- **Keyless by default.** Map tiles (CARTO) and place lookup (Nominatim) need no account, so the app runs immediately. The tradeoff is real: **OSM's coverage of business names is patchy**, so name lookup misses some restaurants where Google would not. Setting `GOOGLE_MAPS_API_KEY` upgrades lookup and unlocks styled Google tiles.
- **The Google Maps Embed API can't be used for Discover** — it's an iframe, so custom pig pins, clustering and tap-to-drop-a-pin are all impossible. The Maps JavaScript API is the upgrade path.
- **Category vocabulary differs by kind** — bars use a fixed set (Pub / Club / Beer Garden / Cocktail Bar / …); restaurants and cafes use free-form cuisine tags with suggestions.
- **`review_text` is required** on a recommendation. With ratings removed, a recommendation with no text carries no more information than an oink.
- **Photos are auto-sourced, best-effort.** Priority is: a photo someone
  uploaded → an auto-sourced one → a generated placeholder. Keyless, the source
  is OpenStreetMap's `website` tag followed by that site's `og:image` — the
  restaurant's own published photo. Coverage is roughly a third; a Google key
  raises it to near-complete via Places Photos.

  Two guards matter. A candidate is rejected unless it sits within 250m of the
  place's own pin — searching "Kiln" in London otherwise returns Kiln *Theatre*
  and puts its photo on a Thai restaurant. And because these are hotlinked from
  someone else's server, a failed load falls back to the placeholder rather than
  leaving a broken image.

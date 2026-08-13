"use client";

/**
 * Place detail — spec §6.4.
 * Reactions are the pig pair (oink / shame), and who did which is shown as two
 * labelled groups. Each person's recommendation is its own card. No rating.
 */
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, api, googlePhotoSrc } from "@/lib/api";
import type { PlaceDetail, User } from "@/lib/types";
import PigAvatar from "@/components/pigs/PigAvatar";
import ReplyThread from "@/components/ReplyThread";
import PhotoViewer, { type ViewerPhoto } from "@/components/PhotoViewer";
import { BudgetTag } from "@/components/pigs/PricePig";
import { OinkPig, ShamePig } from "@/components/pigs/ReactionPigs";
import PhotoCarousel from "@/components/PhotoCarousel";
import BottomTabBar, { TabBarSpacer } from "@/components/BottomTabBar";
import { EmptyState, ErrorNote, KIND_LABELS, PageHeader, Sheet, Spinner, timeAgo } from "@/components/ui";

export default function PlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [place, setPlace] = useState<PlaceDetail | null>(null);
  // Needed only to know whose replies carry a delete button.
  const [viewer, setViewer] = useState<User | null>(null);
  // Which photo the full-screen view is showing, or null when it's closed.
  const [lightbox, setLightbox] = useState<{ photos: ViewerPhoto[]; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Shaming asks why, and won't take no for an answer.
  const [shameOpen, setShameOpen] = useState(false);
  const [shameWhy, setShameWhy] = useState("");
  const [landedOnExisting, setLandedOnExisting] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("oink_landed_on_existing")) {
        setLandedOnExisting(true);
        sessionStorage.removeItem("oink_landed_on_existing");
      }
    } catch {
      /* storage disabled — nothing to show */
    }
  }, []);

  const load = useCallback(() => {
    api.place(id).then(setPlace).catch((e) => setError(e.message));
    api.me().then(setViewer).catch(() => {});
  }, [id]);

  useEffect(load, [load]);

  async function act(fn: () => Promise<PlaceDetail>) {
    setBusy(true);
    setError(null);
    try {
      setPlace(await fn());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  if (error && !place) return <EmptyState title="couldn't load this place" body={error} />;
  if (!place) return <Spinner />;

  const canWishlist = !place.my_recommendation && place.my_reaction !== "oink";

  // The header mixes the place's listing photo with people's own shots, so the
  // viewer credits each accordingly — the listing one belongs to nobody here.
  const uploaders = new Map(
    place.recommendations.flatMap((r) => r.images.map((img) => [img.id, r.user] as const))
  );
  // Same order as the carousel, or opening the viewer lands on a different
  // photo from the one that was on screen.
  const headerPhotos: ViewerPhoto[] = [
    ...place.images.map((img) => ({ url: img.url, by: uploaders.get(img.id) ?? null })),
    ...(place.google_place_id ? [{ url: googlePhotoSrc(place.id), by: null }] : []),
  ];

  return (
    <>
      <PageHeader title={place.name} back="/discover" />

      <main className="mx-auto max-w-[820px] space-y-4 px-3 pb-4">
        {landedOnExisting && (
          <p className="rounded-card border-2 border-ink bg-gold px-3 py-2 text-sm font-bold text-ink-deep">
            Already on the map — oinked it for you instead of adding it twice.
          </p>
        )}

        <PhotoCarousel
          images={place.images}
          tailSrc={place.google_place_id ? googlePhotoSrc(place.id) : null}
          onOpen={(i) => setLightbox({ photos: headerPhotos, index: i })}
          alt={place.name}
          className="h-52 w-full"
        />

        <section className="card space-y-2.5 p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-2xl leading-tight">{place.name}</h2>
              <p className="text-sm text-ink-soft">
                {[KIND_LABELS[place.kind], ...place.category].filter(Boolean).join(" · ")}
              </p>
            </div>
            <BudgetTag budget={place.budget} size={34} />
          </div>

          {(place.address || place.city) && (
            <p className="text-sm text-ink-soft">
              {place.address ?? [place.area, place.city].filter(Boolean).join(", ")}
            </p>
          )}

          {place.google_maps_url && (
            <a
              href={place.google_maps_url}
              target="_blank"
              rel="noreferrer"
              className="btn-plain block text-center text-sm"
            >
              Open in Google Maps ↗
            </a>
          )}
        </section>

        {/* Reactions */}
        <section className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => act(() => api.react(place.id, "oink"))}
            disabled={busy}
            className={`btn flex flex-col items-center gap-1 py-3.5 ${
              place.my_reaction === "oink" ? "bg-plum text-oat" : "bg-cream"
            }`}
          >
            <OinkPig size={40} active={place.my_reaction === "oink"} />
            <span className="text-sm">{place.my_reaction === "oink" ? "Oinked!" : "Oink"}</span>
          </button>
          <button
            onClick={() => {
              // Clearing a shame needs no explanation; leaving one does.
              if (place.my_reaction === "shame") {
                act(() => api.react(place.id, "shame"));
                return;
              }
              setShameWhy(place.my_recommendation?.review_text ?? "");
              setShameOpen(true);
            }}
            disabled={busy || place.added_by_me}
            title={
              place.added_by_me ? "You put this place on the map — you can't shame your own find." : undefined
            }
            className={`btn flex flex-col items-center gap-1 py-3.5 ${
              place.my_reaction === "shame" ? "bg-rust text-oat" : "bg-cream"
            } ${place.added_by_me ? "opacity-40" : ""}`}
          >
            <ShamePig size={40} active={place.my_reaction === "shame"} />
            <span className="text-sm">{place.my_reaction === "shame" ? "Shamed" : "Shame"}</span>
          </button>
        </section>

        {place.added_by_me && (
          <p className="-mt-2 text-center text-xs text-ink-soft">
            you put this one on the map — shame is everyone else&apos;s to give
          </p>
        )}

        {/* Who oinked, who shamed — two labelled groups (spec §6.4) */}
        <section className="grid gap-2.5">
          <PeopleGroup title="oinked" people={place.oinked_by} tone="plum" />
          <PeopleGroup title="shamed" people={place.shamed_by} tone="rust" />
        </section>

        {canWishlist && (
          <button
            onClick={() =>
              act(() => (place.in_my_wishlist ? api.removeWishlist(place.id) : api.addWishlist(place.id)))
            }
            disabled={busy}
            className={`btn w-full ${
              place.in_my_wishlist ? "bg-lilac text-oat" : "bg-cream"
            }`}
          >
            {place.in_my_wishlist ? "★ On your wishlist" : "☆ Add to wishlist"}
          </button>
        )}

        <button onClick={() => setReviewOpen(true)} className="btn-primary w-full text-lg">
          {place.my_reaction === "shame"
            ? "Edit why you shamed it"
            : place.my_recommendation
              ? "Edit your recommendation"
              : "Write a recommendation"}
        </button>

        {error && <ErrorNote message={error} />}

{/* The photo grid that used to sit here is gone — the header carousel
            already shows every photo, and per-review shots stay on their card. */}

        {/* Reviews — each person's take is its own card (spec §6.4) */}
        <section className="space-y-3">
          <h3 className="px-1 text-lg">
            {place.recommendations.length} {place.recommendations.length === 1 ? "review" : "reviews"}
          </h3>

          {place.recommendations.length === 0 && (
            <EmptyState title="no write-ups yet" body="be the first to say something." />
          )}

          {place.recommendations.map((rec) => (
            <article key={rec.id} className="card space-y-2.5 p-3.5">
              <div className="flex items-center gap-2.5">
                <Link href={`/profile/${rec.user.username}`}>
                  <PigAvatar
                    config={rec.user.pig_avatar_config}
                    placesLogged={rec.user.places_logged}
                    lastLoggedAt={rec.user.last_logged_at}
                    size={34}
                    variant="face"
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/profile/${rec.user.username}`}
                    className="block truncate font-display text-sm font-extrabold"
                  >
                    {rec.user.display_name}
                  </Link>
                  <p className="text-xs text-ink-soft">{timeAgo(rec.updated_at)}</p>
                </div>
              </div>

              <p className="text-sm leading-snug">{rec.review_text}</p>

              {rec.recommended_dishes.length > 0 && (
                <div>
                  <p className="mb-1.5 font-display text-xs font-bold text-ink-soft">get the:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {rec.recommended_dishes.map((d) => (
                      <span key={d} className="dish-tag">{d}</span>
                    ))}
                  </div>
                </div>
              )}

              {rec.images.length > 0 && (
                <div className="flex gap-2 overflow-x-auto">
                  {rec.images.map((img, i) => (
                    <button
                      key={img.id}
                      onClick={() =>
                        setLightbox({
                          photos: rec.images.map((im) => ({
                            url: im.url,
                            by: rec.user,
                            takenAt: timeAgo(rec.updated_at),
                          })),
                          index: i,
                        })
                      }
                      className="shrink-0"
                      aria-label={`photo ${i + 1} by ${rec.user.display_name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local uploads */}
                      <img src={img.url} alt="" className="h-20 w-20 cursor-zoom-in rounded-xl object-cover" />
                    </button>
                  ))}
                </div>
              )}

              <ReplyThread placeId={place.id} rec={rec} viewer={viewer} onChange={setPlace} />
            </article>
          ))}
        </section>
      </main>

      {lightbox && (
        <PhotoViewer
          photos={lightbox.photos}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Why. Compulsory: the write-up is the whole value of a shame, and it's
          what the feed shows. Pre-filled from an existing review so shaming a
          place you've already written up edits that rather than blanking it. */}
      <Sheet
        open={shameOpen}
        onClose={() => setShameOpen(false)}
        title={`why are you shaming ${place.name}?`}
      >
        <div className="space-y-3 pb-4">
          <p className="text-sm text-ink-soft">
            This is what everyone sees on the feed. Be specific — &ldquo;bad&rdquo; helps nobody
            decide anything.
          </p>
          <textarea
            className="field min-h-[130px] w-full"
            value={shameWhy}
            onChange={(e) => setShameWhy(e.target.value)}
            placeholder="cold, slow, and £14 for a flat white…"
            autoFocus
          />
          <button
            onClick={async () => {
              const why = shameWhy.trim();
              if (!why) return;
              await act(async () => {
                // Reason first: the API refuses a shame that hasn't got one.
                await api.recommend(place.id, why, []);
                return api.react(place.id, "shame");
              });
              setShameOpen(false);
            }}
            disabled={busy || !shameWhy.trim()}
            className="btn-primary w-full text-lg disabled:opacity-50"
          >
            {busy ? "…" : "Shame it"}
          </button>
        </div>
      </Sheet>

      <TabBarSpacer />
      <BottomTabBar />

      <ReviewSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        place={place}
        onSaved={(updated) => {
          setPlace(updated);
          setReviewOpen(false);
        }}
      />
    </>
  );
}

/** One labelled group of people — "Oinked" or "Shamed" (spec §6.4). */
function PeopleGroup({
  title,
  people,
  tone,
}: {
  title: string;
  people: User[];
  tone: "plum" | "rust";
}) {
  const chip = tone === "plum" ? "bg-plum" : "bg-rust";
  return (
    <div className="card p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className={`rounded-full ${chip} px-2.5 py-1 font-display text-xs font-bold text-white`}>
          {title}
        </span>
        <span className="font-display text-xs text-ink-soft">{people.length}</span>
      </div>

      {people.length === 0 ? (
        <p className="text-sm text-ink-soft">nobody yet</p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {people.map((u) => (
            <Link key={u.id} href={`/profile/${u.username}`} className="flex items-center gap-1.5">
              <PigAvatar
                config={u.pig_avatar_config}
                placesLogged={u.places_logged}
                lastLoggedAt={u.last_logged_at}
                size={28}
                variant="face"
              />
              <span className="text-xs font-bold">{u.display_name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Review composer — text + recommended dishes + photos. No rating (spec §8). */
function ReviewSheet({
  open,
  onClose,
  place,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  place: PlaceDetail;
  onSaved: (p: PlaceDetail) => void;
}) {
  const existing = place.my_recommendation;
  const [text, setText] = useState(existing?.review_text ?? "");
  const [dishes, setDishes] = useState<string[]>(existing?.recommended_dishes ?? []);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deleting a write-up is destructive and there's no undo, so it asks first.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText(existing?.review_text ?? "");
      setDishes(existing?.recommended_dishes ?? []);
      setError(null);
      setFiles([]);
      setConfirmingDelete(false);
    }
  }, [open, existing]);

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.deleteRecommendation(place.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete that");
      setSaving(false);
    }
  }

  function addDish() {
    const value = draft.trim();
    if (value && !dishes.includes(value)) setDishes((d) => [...d, value]);
    setDraft("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError("Say something about it — that's the whole point.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const file of files) {
        await api.uploadImage(place.id, file);
      }
      onSaved(await api.recommend(place.id, text.trim(), dishes));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={existing ? "Edit your take" : "Your take"}>
      <form onSubmit={submit} className="space-y-3 pb-4">
        <textarea
          className="field min-h-[120px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="what's it like? who should go?"
          required
        />

        <div className="space-y-2">
          <p className="font-display text-sm font-bold">dishes worth ordering</p>
          <div className="flex gap-2">
            <input
              className="field flex-1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDish();
                }
              }}
              placeholder="e.g. monkfish curry"
            />
            <button type="button" onClick={addDish} className="btn-plain px-4">+</button>
          </div>
          {dishes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {dishes.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDishes((prev) => prev.filter((x) => x !== d))}
                  className="dish-tag"
                >
                  {d} ✕
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="font-display text-sm font-bold">photos</p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <button type="button" onClick={() => fileInput.current?.click()} className="btn-plain w-full text-sm">
            {files.length ? `${files.length} photo${files.length > 1 ? "s" : ""} ready` : "Add photos"}
          </button>
        </div>

        {error && <ErrorNote message={error} />}

        <button type="submit" className="btn-primary w-full text-lg" disabled={saving}>
          {saving ? "Posting…" : existing ? "Update" : "Post it"}
        </button>

        {existing &&
          (confirmingDelete ? (
            <div className="space-y-2 rounded-card border-2 border-rust p-3">
              <p className="text-sm font-bold text-rust">
                Delete your write-up? Your oink stays; only the words and dishes go.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="btn-plain flex-1 text-sm"
                  disabled={saving}
                >
                  Keep it
                </button>
                <button
                  type="button"
                  onClick={remove}
                  className="btn flex-1 bg-rust text-sm text-oat"
                  disabled={saving}
                >
                  {saving ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="btn-quiet w-full text-sm text-rust"
              disabled={saving}
            >
              Delete this write-up
            </button>
          ))}
      </form>
    </Sheet>
  );
}

"use client";

/** Discover — map/list toggle, filters, add-place FAB (spec §6.3). */
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Kind, PlaceSummary, User } from "@/lib/types";
import { BUDGETS, Budget } from "@/lib/pig";
import { categoriesFor } from "@/lib/categories";
import BottomTabBar from "@/components/BottomTabBar";
import PlaceListCard from "@/components/PlaceListCard";
import PigAvatar from "@/components/pigs/PigAvatar";
import { BudgetTag } from "@/components/pigs/PricePig";
import AddPlaceSheet from "@/components/AddPlaceSheet";
import { EmptyState, KIND_LABELS, Sheet, Spinner } from "@/components/ui";
import DiscoverDrawer, { PEEK } from "@/components/DiscoverDrawer";
import { ME_SPAN_M } from "@/lib/map";

// Leaflet touches `window` at import time, so it can't be server-rendered.
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-oat-deep" />,
});

/** A row of pig faces with names — used for both sides of the pin sheet. */
function FaceRow({ people, muted = false }: { people: User[]; muted?: boolean }) {
  if (people.length === 0) return null;
  return (
    <div className={`mt-1.5 flex flex-wrap items-center gap-2 ${muted ? "opacity-70 grayscale" : ""}`}>
      {people.map((u) => (
        <span key={u.id} className="flex items-center gap-1">
          <PigAvatar
            config={u.pig_avatar_config}
            placesLogged={u.places_logged}
            lastLoggedAt={u.last_logged_at}
            size={28}
            variant="face"
          />
          <span className="text-xs">{u.display_name}</span>
        </span>
      ))}
    </div>
  );
}

export default function DiscoverScreen({ initialPlaces }: { initialPlaces: PlaceSummary[] | null }) {
  const [places, setPlaces] = useState<PlaceSummary[] | null>(initialPlaces);
  const [selected, setSelected] = useState<PlaceSummary | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [pickedPoint, setPickedPoint] = useState<{ lat: number; lng: number } | null>(null);
  // Bumped when starting a genuinely new place, so the sheet blanks itself.
  const [addResetKey, setAddResetKey] = useState(0);
  // Where the map is pointed. Biases place search to the area on screen.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  // Jump-to-a-city search. Geocoded through the same place lookup the add-place
  // flow uses, so it needs no extra backend.
  const [cityQuery, setCityQuery] = useState("");
  const [cityBusy, setCityBusy] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);
  // `span` frames that many metres across rather than jumping to a zoom level.
  const [focusPoint, setFocusPoint] = useState<{
    lat: number;
    lng: number;
    span?: number;
  } | null>(null);

  /**
   * Been / not been. The map's other filters narrow what kind of place you're
   * looking at; this one narrows it by your own history, which is the question
   * you're actually asking when you open the map in a part of town you know.
   */
  const [visited, setVisited] = useState<"all" | "mine" | "new">("all");
  /** What the map is currently showing. The list is scoped to it — a list of
   *  every pin in the country is a directory, not a view of where you are. */
  const [bounds, setBounds] = useState<{
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  } | null>(null);
  const [sort, setSort] = useState<"newest" | "oinks" | "cheap" | "pricey">("newest");
  const [drawerOpen, setDrawerOpen] = useState(false);
  /**
   * Which layout is live. Tailwind can hide the wrong one, but two of these
   * decisions aren't CSS: the pin sheet must not *mount* on a phone (it locks
   * body scroll when it opens, visible or not), and the add button's offset
   * differs per layout — an inline style would beat any `lg:` class.
   */
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  /** The viewer, so the map can put their own pig where they're standing. */
  const [me, setMe] = useState<User | null>(null);
  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api.places().then(setPlaces).catch(() => setPlaces([]));
  }, []);

  useEffect(() => {
    // The server payload paints instantly, but it's a snapshot: anything
    // changed since — a place un-logged, someone else's oink — would sit here
    // stale forever if this returned early. Refresh in the background instead,
    // which costs a request and never blanks what's already on screen.
    load();
  }, [load]);

  // Filtering happens client-side so toggling a filter doesn't refetch. The API
  // supports the same filters for when the dataset outgrows this.
  const filtered = useMemo(() => {
    if (!places) return [];
    return places.filter((p) => {
      if (visited === "mine" && !p.logged_by_me) return false;
      if (visited === "new" && p.logged_by_me) return false;
      if (kinds.length && !kinds.includes(p.kind)) return false;
      if (budgets.length && !budgets.includes(p.budget)) return false;
      if (categories.length) {
        const own = p.category.map((c) => c.toLowerCase());
        if (!categories.some((c) => own.includes(c.toLowerCase()))) return false;
      }
      return true;
    });
  }, [places, visited, kinds, budgets, categories]);

  /**
   * The list: the filtered set narrowed to what's on the map, then sorted.
   *
   * Kept separate from `filtered` because the map wants every match — a pin
   * outside the viewport is simply off screen, and culling those would empty
   * the map as you panned toward them.
   */
  /**
   * What's on the map, in the order the API sent it — newest first. Kept apart
   * from the sorted list because the drawer's shut state shows "the newest
   * thing on screen", and that has to stay true whatever the sort is set to.
   */
  const inView = useMemo(() => {
    if (!bounds) return filtered;
    return filtered.filter(
      (p) =>
        p.lat >= bounds.minLat &&
        p.lat <= bounds.maxLat &&
        p.lng >= bounds.minLng &&
        p.lng <= bounds.maxLng
    );
  }, [filtered, bounds]);

  /**
   * The list: what's on the map, sorted.
   *
   * Kept separate from `filtered` because the map wants every match — a pin
   * outside the viewport is simply off screen, and culling those would empty
   * the map as you panned toward them.
   */
  const listed = useMemo(() => {
    if (sort === "newest") return inView;
    const price = (p: PlaceSummary) => BUDGETS.indexOf(p.budget);
    // Sorted copies, and every comparator falls back to the name so a page of
    // one-oink places doesn't reshuffle itself on every re-render.
    const byName = (a: PlaceSummary, b: PlaceSummary) => a.name.localeCompare(b.name);
    return [...inView].sort((a, b) => {
      if (sort === "oinks") return b.recommender_count - a.recommender_count || byName(a, b);
      if (sort === "cheap") return price(a) - price(b) || byName(a, b);
      return price(b) - price(a) || byName(a, b);
    });
  }, [inView, sort]);

  const ALL_KINDS: Kind[] = useMemo(() => ["restaurant", "bar", "cafe"], []);

  // Subtypes belong to a type: cuisines under restaurants, drinking-institution
  // types under bars. The curated vocabulary comes first so its capitalisation
  // wins over whatever casing a place happens to be tagged with.
  const categoriesByKind = useMemo(() => {
    const map = new Map<Kind, Map<string, string>>();
    ALL_KINDS.forEach((k) => {
      const entries = new Map<string, string>();
      categoriesFor(k).options.forEach((o) => entries.set(o.toLowerCase(), o));
      map.set(k, entries);
    });
    places?.forEach((p) => {
      const entries = map.get(p.kind);
      if (!entries) return;
      p.category.forEach((c) => {
        if (!entries.has(c.toLowerCase())) entries.set(c.toLowerCase(), c);
      });
    });
    return map;
  }, [places, ALL_KINDS]);

  // With no type chosen, every subtype is on the table.
  const categoryOptions = useMemo(() => {
    const active = kinds.length ? kinds : ALL_KINDS;
    const merged = new Map<string, string>();
    active.forEach((k) =>
      categoriesByKind.get(k)?.forEach((label, key) => {
        if (!merged.has(key)) merged.set(key, label);
      })
    );
    return [...merged.values()].sort((a, b) => a.localeCompare(b));
  }, [categoriesByKind, kinds, ALL_KINDS]);

  const activeFilters =
    kinds.length + budgets.length + categories.length + (visited === "all" ? 0 : 1);

  function toggle<T>(list: T[], setList: (v: T[]) => void, value: T) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  /** Re-ask for the location. The open-on-your-city prompt only appears once,
   *  and a dismissed or denied one silently leaves you looking at the pins with
   *  no way back — this is that way back. */
  function locateMe() {
    if (!navigator.geolocation) {
      setCityError("This browser won't share a location.");
      return;
    }
    setCityBusy(true);
    setCityError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFocusPoint({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          span: ME_SPAN_M,
        });
        setCityBusy(false);
      },
      () => {
        setCityError("Couldn't get your location — allow it in your browser, or search a city.");
        setCityBusy(false);
      },
      { timeout: 8000, maximumAge: 60000 }
    );
  }

  async function goToCity(e: React.FormEvent) {
    e.preventDefault();
    const q = cityQuery.trim();
    if (q.length < 3) return;
    setCityBusy(true);
    setCityError(null);
    try {
      const [best] = await api.searchPlaces(q);
      if (!best) {
        setCityError("Couldn't find that place.");
        return;
      }
      // A new object each time, so searching the same city twice still moves
      // the map back if you've panned away since.
      setFocusPoint({ lat: best.lat, lng: best.lng });
    } catch {
      setCityError("Couldn't look that up.");
    } finally {
      setCityBusy(false);
    }
  }

  /** Changing the type prunes subtypes that no longer belong to it — otherwise a
   *  leftover cuisine silently filters every bar away. */
  function toggleKind(k: Kind) {
    const next = kinds.includes(k) ? kinds.filter((v) => v !== k) : [...kinds, k];
    setKinds(next);
    const allowed = new Set<string>();
    (next.length ? next : ALL_KINDS).forEach((kk) =>
      categoriesByKind.get(kk)?.forEach((_, key) => allowed.add(key))
    );
    setCategories((prev) => prev.filter((c) => allowed.has(c.toLowerCase())));
  }

  return (
    <div className="relative flex h-[100dvh] flex-col">
      {/* Title and search share a line: on a phone the map is the screen, and
          every row above it is a row the map doesn't get. Filters and locate
          move onto the map itself below. */}
      <header className="z-[900] bg-oat px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h1 className="shrink-0 text-3xl text-plum">discover</h1>
          <form onSubmit={goToCity} className="flex min-w-0 flex-1 items-center gap-2">
            <input
              className="field min-w-0 flex-1 py-2 text-sm"
              value={cityQuery}
              onChange={(e) => {
                setCityQuery(e.target.value);
                setCityError(null);
              }}
              placeholder="jump to a city…"
              aria-label="search for a city"
              enterKeyHint="search"
            />
            <button
              type="submit"
              className="btn-plain shrink-0 px-3 py-2 text-sm"
              disabled={cityBusy || cityQuery.trim().length < 3}
            >
              {cityBusy ? "…" : "Go"}
            </button>
          </form>
          {/* A laptop has the room, so it keeps its filters button up here and
              the map stays clear. */}
          <button
            onClick={() => setFiltersOpen(true)}
            className={`btn hidden shrink-0 px-3 py-2 text-sm lg:block ${
              activeFilters ? "bg-plum text-oat" : "bg-cream"
            }`}
          >
            Filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </div>
        {cityError && <p className="mt-1 px-1 text-xs font-bold text-rust">{cityError}</p>}

        {pickMode && (
          <p className="mt-2 rounded-lg border-2 border-ink bg-gold px-3 py-2 text-center font-display text-xs font-bold text-ink-deep">
            Tap the map to drop your pin
          </p>
        )}
      </header>

      <div className="relative flex-1 overflow-hidden lg:flex">
        {!places && <Spinner label="finding the good stuff…" />}

        {places && (
          <div className="h-full w-full lg:h-full lg:min-w-0 lg:flex-1">
            <MapView
              places={filtered}
              onSelect={setSelected}
              onCenterChange={(lat, lng) => setMapCenter({ lat, lng })}
              onBoundsChange={setBounds}
              me={me}
              focusPoint={focusPoint}
              pickMode={pickMode}
              pickedPoint={pickedPoint}
              onPick={(lat, lng) => {
                setPickedPoint({ lat, lng });
                setPickMode(false);
                setAddOpen(true);
              }}
              className="h-full w-full"
            />

            {/* Over the map on a phone, where the header has no room for them.
                Both clear the drawer's shut height. */}
            <button
              onClick={() => setFiltersOpen(true)}
              className={`btn absolute right-3 top-3 z-[1000] px-3 py-2 text-sm shadow-lift lg:hidden ${
                activeFilters ? "bg-plum text-oat" : "bg-cream"
              }`}
            >
              Filters{activeFilters ? ` (${activeFilters})` : ""}
            </button>
            <button
              type="button"
              onClick={locateMe}
              disabled={cityBusy}
              className="btn-plain absolute left-3 z-[1000] px-3 py-2 text-base shadow-lift lg:hidden"
              style={{ bottom: `calc(${PEEK + 112}px + env(safe-area-inset-bottom))` }}
              aria-label="centre the map on my location"
              title="centre on my location"
            >
              ◎
            </button>
          </div>
        )}

        {places && (
          <div
            className="hidden h-full space-y-3 overflow-y-auto px-3 py-1
                       lg:block lg:w-[400px] lg:shrink-0 lg:border-l-2 lg:border-ink lg:pb-6"
          >
            {/* Sticky, so the sort stays reachable however far down you are. */}
            <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-oat px-3 pb-2 pt-1">
              <p className="micro flex-1">
                {listed.length} {listed.length === 1 ? "place" : "places"} in view
              </p>
              <label className="flex items-center gap-1.5">
                <span className="micro">sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  className="rounded-lg border-2 border-ink bg-cream px-2 py-1 font-display text-xs font-bold"
                  aria-label="sort the list"
                >
                  <option value="newest">Newest</option>
                  <option value="oinks">Most oinks</option>
                  <option value="cheap">Cheapest</option>
                  <option value="pricey">Priciest</option>
                </select>
              </label>
            </div>

            {listed.length === 0 && (
              <EmptyState
                title="nothing here"
                body={
                  filtered.length
                    ? "no matches in this part of the map — pan out, or move the map."
                    : "loosen the filters a bit."
                }
              />
            )}
            {listed.map((p) => (
              <PlaceListCard key={p.id} place={p} />
            ))}
          </div>
        )}

        {/* Add-place FAB — bottom right, in the thumb zone (spec §6.3) */}
        <button
          onClick={() => {
            setPickedPoint(null);
            setAddResetKey((k) => k + 1);
            setAddOpen(true);
          }}
          /* Sits clear of the tab bar — this screen has no spacer, so the
             offset has to cover the bar's height itself. */
          className="absolute right-4 z-[1000] flex h-16 w-16 items-center justify-center rounded-full bg-plum font-display text-4xl font-extrabold text-white shadow-lift transition-transform active:scale-95 lg:right-[424px]"
          style={{
            bottom: isDesktop ? 24 : `calc(${PEEK + 112}px + env(safe-area-inset-bottom))`,
          }}
          aria-label="add a place"
        >
          +
        </button>
      </div>

      {/* Tapping a pin fills this rather than opening a sheet — the map stays
          visible, which is the whole point of the redesign. Hidden while
          dropping a pin, where the map is the only thing that matters. */}
      {places && !pickMode && (
        <DiscoverDrawer
          expanded={drawerOpen}
          onExpandedChange={setDrawerOpen}
          peek={selected ?? inView[0] ?? null}
          places={listed}
          anyMatches={filtered.length > 0}
          sort={sort}
          onSortChange={(v) => setSort(v as typeof sort)}
        />
      )}

      <BottomTabBar />

      {/* Pin tap → bottom sheet (spec §6.3) */}
      <Sheet
        open={!!selected && isDesktop}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
      >
        {selected && (
          <div className="space-y-3 pb-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-ink-soft">
                {[KIND_LABELS[selected.kind], ...selected.category].filter(Boolean).join(" · ")}
              </p>
              <BudgetTag budget={selected.budget} />
            </div>

            {selected.city && (
              <p className="text-sm">{[selected.area, selected.city].filter(Boolean).join(", ")}</p>
            )}

            {/* Both sides of the verdict, each with its own faces — a place can
                be oinked by some and shamed by others. */}
            <div className="space-y-2.5">
              {selected.recommender_count === 0 && selected.shame_count === 0 && (
                <p className="font-display text-sm font-bold">nobody's weighed in yet</p>
              )}

              {selected.recommender_count > 0 && (
                <div>
                  <p className="font-display text-sm font-bold">
                    Oinked by {selected.recommender_count}
                  </p>
                  <FaceRow people={selected.recommenders} />
                </div>
              )}

              {selected.shame_count > 0 && (
                <div>
                  <p className="font-display text-sm font-bold text-rust">
                    Shamed by {selected.shame_count}
                  </p>
                  <FaceRow people={selected.shamers} muted />
                </div>
              )}
            </div>

            <Link href={`/restaurant/${selected.id}`} className="btn-primary block text-center">
              View details
            </Link>
          </div>
        )}
      </Sheet>

      {/* Filters */}
      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="filters">
        <div className="space-y-4 pb-4">
          <section>
            <p className="mb-1.5 font-display text-sm font-bold">been here?</p>
            <div className="flex gap-2">
              {(
                [
                  ["all", "Everywhere"],
                  ["mine", "Places I've been"],
                  ["new", "New to me"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setVisited(value)}
                  className={`btn flex-1 text-xs ${
                    visited === value ? "bg-plum text-oat" : "bg-cream"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="micro mt-1.5">oinked, written up, shamed or added all count</p>
          </section>

          <section>
            <p className="mb-1.5 font-display text-sm font-bold">type</p>
            <div className="flex gap-2">
              {(["restaurant", "bar", "cafe"] as Kind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => toggleKind(k)}
                  className={`btn flex-1 text-xs ${
                    kinds.includes(k) ? "bg-plum text-oat" : "bg-cream"
                  }`}
                >
                  {KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-1.5 font-display text-sm font-bold">budget</p>
            <div className="grid grid-cols-4 gap-1.5">
              {BUDGETS.map((b) => (
                <button
                  key={b}
                  onClick={() => toggle(budgets, setBudgets, b)}
                  className={`btn flex items-center justify-center px-1 py-2 ${
                    budgets.includes(b) ? "bg-lemon" : "bg-cream"
                  }`}
                >
                  <BudgetTag budget={b} size={30} />
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-1.5 font-display text-sm font-bold">
              {kinds.length === 1 && kinds[0] === "bar" ? "What kind of bar?" : "Cuisine"}
            </p>
            <select
              className="field"
              // Stays on the placeholder: picking is an "add one" action, and
              // what's chosen is shown as chips below rather than in the box.
              value=""
              onChange={(e) => {
                if (e.target.value) toggle(categories, setCategories, e.target.value);
              }}
            >
              <option value="">
                {kinds.length === 1
                  ? `Any ${KIND_LABELS[kinds[0]].toLowerCase()} subtype`
                  : "Any subtype"}
              </option>
              {categoryOptions
                .filter((c) => !categories.includes(c))
                .map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>

            {categories.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => toggle(categories, setCategories, c)}
                    className="tag tag-active"
                  >
                    {c} ✕
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setVisited("all");
                setKinds([]);
                setBudgets([]);
                setCategories([]);
              }}
              className="btn-plain flex-1"
            >
              Clear
            </button>
            <button onClick={() => setFiltersOpen(false)} className="btn-primary flex-1">
              Show {filtered.length}
            </button>
          </div>
        </div>
      </Sheet>

      <AddPlaceSheet
        open={addOpen}
        resetKey={addResetKey}
        onClose={() => setAddOpen(false)}
        pickedPoint={pickedPoint}
        near={mapCenter}
        onRequestPick={() => {
          setAddOpen(false);
          setPickMode(true);
          }}
        onPointResolved={(lat, lng) => setPickedPoint({ lat, lng })}
        onCreated={() => {
          load();
          setPickedPoint(null);
          setAddResetKey((k) => k + 1);
        }}
      />
    </div>
  );
}

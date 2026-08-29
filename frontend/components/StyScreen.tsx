"use client";

/**
 * One sty — its pigs, out on its own ground (spec §6.6).
 *
 * This is the old pigsty field, narrowed: the crowd is that sty's members, and
 * the throne and the enclosure are that sty's verdicts rather than the whole
 * farm's. Every sty gets its own supreme oink and its own shame enclosure,
 * which is most of the point of splitting the farm up — a small sty can crown
 * somebody instead of being permanently outvoted by a big one.
 *
 * The floor comes from the sty's chosen ground. Scenery that belongs to the
 * screen rather than the field (mountains at the top, sea at the bottom) is
 * pinned to the viewport, so panning doesn't sail the sea up into the sky.
 *
 * **No names in the field**, same as before: at phone width twenty-odd labels
 * fight the art. Tap a pig and the bar underneath says who it is.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import type { StyDetail, User } from "@/lib/types";
import PigAvatar from "@/components/pigs/PigAvatar";
import BottomTabBar, { TabBarSpacer } from "@/components/BottomTabBar";
import { Sheet, Spinner } from "@/components/ui";
import { TIER_LABELS, fatnessTier } from "@/lib/pig";
import PigsOfTheSty from "@/components/PigsOfTheSty";
import { Hut, type HutKind } from "@/components/pigs/Huts";
import { GROUNDS, GROUND_LABELS, GroundSwatch, ground, type GroundKind } from "@/components/pigs/Grounds";
import { HUTS, HUT_LABELS } from "@/components/pigs/Huts";
import {
  GRAVEYARD_HEADROOM,
  Grave,
  GraveyardGround,
  STY_PIG,
  ShameEnclosure,
  Throne,
} from "@/components/pigs/PigstyLandmarks";

const CELL_W = 132;
const CELL_H = 150;
const MIN_SCALE = 0.22;
const MAX_SCALE = 1.6;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

type Spot = { user: User; x: number; y: number; landmark?: "throne" | "shame" | "grave" };
type Plot = { x: number; y: number; width: number; height: number };
type Field = { spots: Spot[]; width: number; height: number; graveyard: Plot | null };

const TOP_BAND = 300;
const TOP_GAP = 250;
const GRAVE_COLS = 4;
const GRAVE_W = 128;
const GRAVE_H = 172;
// The plot sits close around the graves. Wider at the foot than the head: the
// near run of railings stands on the bottom edge and rises into the plot, and
// anything less than its height there would put the front row's feet through
// the fence. The back run rises outside the plot, so the head needs nothing.
const GRAVE_PAD_X = 12;
const GRAVE_PAD_TOP = 10;
const GRAVE_PAD_BOTTOM = 34;

// Clearance between the crowd and the graveyard: enough for the gateway, which
// stands above the plot, plus room for a low-hanging pig in the last row.
const GRAVE_GAP = GRAVEYARD_HEADROOM + 40;

/**
 * Whoever this sty's verdict picks out, by the widest margin, for each end of
 * it. Ties settle on the user id rather than on list order, so nobody is
 * crowned and dethroned again by the next refresh. A zero doesn't win anything.
 */
function champion(users: User[], key: "og_oinks_received" | "og_shames_received"): User | null {
  let top: User | null = null;
  for (const u of users) {
    const n = u[key] ?? 0;
    if (n <= 0) continue;
    const best = top ? top[key] ?? 0 : 0;
    if (n > best || (n === best && top && u.id < top.id)) top = u;
  }
  return top;
}

function layout(users: User[]): { spots: Spot[]; width: number; height: number } {
  const n = Math.max(users.length, 1);
  const cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.5)));
  const rows = Math.max(2, Math.ceil(n / cols));
  const taken = new Set<number>();
  const cells = cols * rows;
  const width = cols * CELL_W;
  const height = rows * CELL_H;

  const ordered = [...users].sort((a, b) => a.id.localeCompare(b.id));
  const spots: Spot[] = [];

  for (const user of ordered) {
    const h = hash(user.id);
    let cell = h % cells;
    while (taken.has(cell)) cell = (cell + 1) % cells;
    taken.add(cell);
    const cx = cell % cols;
    const cy = Math.floor(cell / cols);
    const jx = ((h >> 8) % 1000) / 1000 - 0.5;
    const jy = ((h >> 18) % 1000) / 1000 - 0.5;
    spots.push({
      user,
      x: ((cx + 0.5 + jx * 0.55) / cols) * width,
      y: ((cy + 0.5 + jy * 0.5) / rows) * height,
    });
  }
  return { spots, width, height };
}

export default function StyScreen({
  styId,
  initialSty,
  initialMembers,
}: {
  styId: string;
  /** May be null: the server read is best-effort, not a permission check. */
  initialSty: StyDetail | null;
  initialMembers: User[] | null;
}) {
  const router = useRouter();
  const [sty, setSty] = useState<StyDetail | null>(initialSty);
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [users, setUsers] = useState<User[] | null>(initialMembers);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scale, setScale] = useState(0.7);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const framed = useRef(false);

  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; scale: number; fx: number; fy: number } | null>(null);
  const captured = useRef(new Set<number>());

  // Falls back to the meadow while the sty is still loading, so the field has
  // a floor rather than flashing bare.
  const floor = useMemo(() => ground((sty?.ground ?? "meadow") as GroundKind), [sty?.ground]);

  useEffect(() => {
    // Whatever the server managed, the client refetches — this is also what
    // recovers the page when the server read came back empty.
    let live = true;
    api
      .sty(styId)
      .then((fresh) => {
        if (!live) return;
        setSty(fresh);
        // Not a pig of this sty: the farm chains it shut and offers a join
        // request, which is where this belongs.
        if (!fresh.is_member) router.replace("/farm");
      })
      .catch((e) => {
        if (!live) return;
        // Only a sty the API positively denies is gone. Anything else — the
        // API down, a dropped connection — leaves the screen waiting rather
        // than announcing a demolition that never happened.
        if (e instanceof ApiError && e.status === 404) setGone(true);
        else setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [styId, router]);

  useEffect(() => {
    if (!sty?.is_member) return;
    api.styMembers(styId).then(setUsers).catch(() => {});
  }, [styId, sty?.is_member]);

  const scaleRef = useRef(scale);
  const panRef = useRef(pan);
  scaleRef.current = scale;
  panRef.current = pan;
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    // Attached by hand: React registers wheel handlers passively at the root,
    // where preventDefault is ignored, so the page would scroll under the zoom.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      const from = scaleRef.current;
      const to = Math.min(MAX_SCALE, Math.max(MIN_SCALE, from * Math.exp(-e.deltaY * 0.0018)));
      if (to === from) return;
      const p = panRef.current;
      setScale(to);
      setPan({ x: px - ((px - p.x) / from) * to, y: py - ((py - p.y) / from) * to });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const { spots, width: fieldW, height: fieldH, graveyard } = useMemo<Field>(() => {
    const all = users ?? [];
    const throned = champion(all, "og_oinks_received");
    let shamed = champion(all, "og_shames_received");
    // Nobody is crowned and caged at once. The throne wins.
    if (shamed && throned && shamed.id === throned.id) shamed = null;

    const buried = all.filter(
      (u) =>
        u.id !== throned?.id &&
        u.id !== shamed?.id &&
        fatnessTier(u.places_logged, u.last_logged_at) === "dead"
    );
    const dead = new Set(buried.map((u) => u.id));
    const crowd = all.filter((u) => u.id !== throned?.id && u.id !== shamed?.id && !dead.has(u.id));
    const base = layout(crowd);
    const top = throned || shamed ? TOP_BAND : 0;

    const graveCols = Math.min(GRAVE_COLS, Math.max(buried.length, 1));
    const graveRows = Math.ceil(buried.length / GRAVE_COLS);
    const plotW = graveCols * GRAVE_W + GRAVE_PAD_X * 2;
    const plotH = graveRows * GRAVE_H + GRAVE_PAD_TOP + GRAVE_PAD_BOTTOM;
    const graveBand = buried.length ? GRAVE_GAP + plotH + 40 : 0;

    const width = Math.max(base.width, TOP_GAP + 240, plotW + 40);
    const dx = (width - base.width) / 2;
    const spots: Spot[] = base.spots.map((s) => ({ ...s, x: s.x + dx, y: s.y + top }));

    const bothUp = !!throned && !!shamed;
    if (throned) spots.push({ user: throned, x: width / 2 - (bothUp ? TOP_GAP / 2 : 0), y: top / 2, landmark: "throne" });
    if (shamed) spots.push({ user: shamed, x: width / 2 + (bothUp ? TOP_GAP / 2 : 0), y: top / 2, landmark: "shame" });

    let graveyard: Plot | null = null;
    if (buried.length) {
      const plotTop = top + base.height + GRAVE_GAP;
      graveyard = { x: (width - plotW) / 2, y: plotTop, width: plotW, height: plotH };
      buried.forEach((user, i) => {
        const col = i % GRAVE_COLS;
        const row = Math.floor(i / GRAVE_COLS);
        const inRow = Math.min(GRAVE_COLS, buried.length - row * GRAVE_COLS);
        const rowW = inRow * GRAVE_W;
        spots.push({
          user,
          x: (width - rowW) / 2 + col * GRAVE_W + GRAVE_W / 2,
          y: plotTop + GRAVE_PAD_TOP + row * GRAVE_H + GRAVE_H / 2,
          landmark: "grave",
        });
      });
    }
    return { spots, width, height: base.height + top + graveBand, graveyard };
  }, [users]);

  const q = query.trim().toLowerCase();
  const matches = (u: User) =>
    !q || u.display_name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
  const hits = spots.filter((s) => matches(s.user));

  function fitAll(w: number, h: number) {
    const box = viewport.current?.getBoundingClientRect();
    if (!box || !w || !h) return;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(box.width / w, box.height / h) * 0.9));
    setScale(s);
    setPan({ x: (box.width - w * s) / 2, y: (box.height - h * s) / 2 });
  }

  useEffect(() => {
    if (framed.current || !users?.length) return;
    framed.current = true;
    fitAll(fieldW, fieldH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, fieldW, fieldH]);

  useEffect(() => {
    if (!q || hits.length === 0) return;
    const first = hits[0];
    setSelected(first.user.id);
    const box = viewport.current?.getBoundingClientRect();
    if (!box) return;
    setPan({ x: box.width / 2 - first.x * scale, y: box.height / 2 - first.y * scale });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function local(e: { clientX: number; clientY: number }) {
    const box = viewport.current?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  }
  /** Capture is taken late: a captured pointer retargets the following click. */
  function capture(id: number) {
    if (captured.current.has(id)) return;
    viewport.current?.setPointerCapture(id);
    captured.current.add(id);
  }
  function onPointerDown(e: React.PointerEvent) {
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale,
        fx: (mid.x - pan.x) / scale,
        fy: (mid.y - pan.y) / scale,
      };
      pointers.current.forEach((_, id) => capture(id));
      drag.current = null;
      return;
    }
    drag.current = { x: p.x - pan.x, y: p.y - pan.y, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (pinch.current.scale * dist) / pinch.current.dist));
      setScale(next);
      setPan({ x: mid.x - pinch.current.fx * next, y: mid.y - pinch.current.fy * next });
      if (drag.current) drag.current.moved = true;
      return;
    }
    if (!drag.current) return;
    const next = { x: p.x - drag.current.x, y: p.y - drag.current.y };
    if (Math.abs(next.x - pan.x) + Math.abs(next.y - pan.y) > 3) {
      drag.current.moved = true;
      capture(e.pointerId);
    }
    if (!drag.current.moved) return;
    setPan(next);
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (captured.current.delete(e.pointerId)) viewport.current?.releasePointerCapture?.(e.pointerId);
    if (pointers.current.size === 1) {
      const [only] = [...pointers.current.values()];
      pinch.current = null;
      drag.current = { x: only.x - pan.x, y: only.y - pan.y, moved: true };
      return;
    }
    if (pointers.current.size === 0) pinch.current = null;
  }
  function pick(id: string) {
    if (drag.current?.moved) return;
    setSelected((current) => (current === id ? null : id));
  }

  const chosen = users?.find((u) => u.id === selected) ?? null;

  async function act(fn: () => Promise<StyDetail>) {
    const next = await fn();
    setSty(next);
    api.styMembers(styId).then(setUsers).catch(() => {});
  }

  async function demolish() {
    await api.deleteSty(styId);
    router.replace("/farm");
  }

  if (gone) {
    return (
      <>
        <main className="grid min-h-[60vh] place-items-center px-6">
          <div className="grid justify-items-center gap-2">
            <p className="font-display text-lg font-bold">no sty here</p>
            <p className="micro text-center">it may have been knocked down.</p>
            <Link href="/farm" className="btn-primary mt-1 text-sm">back to the farm</Link>
          </div>
        </main>
        <TabBarSpacer />
        <BottomTabBar />
      </>
    );
  }

  if (!sty) {
    return (
      <>
        <main className="px-3 pt-6">
          {failed ? (
            <div className="grid justify-items-center gap-2 py-16">
              <p className="font-display text-lg font-bold">couldn&apos;t reach the sty</p>
              <button onClick={() => { setFailed(false); api.sty(styId).then(setSty).catch(() => setFailed(true)); }}
                className="btn-primary text-sm">try again</button>
              <Link href="/farm" className="micro underline">back to the farm</Link>
            </div>
          ) : (
            <Spinner label="finding the sty…" />
          )}
        </main>
        <TabBarSpacer />
        <BottomTabBar />
      </>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-[900] mx-auto max-w-[1400px] bg-oat/95 px-3 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Link href="/farm" className="shrink-0 text-xl leading-none" aria-label="back to the farm">
            ←
          </Link>
          <span className="shrink-0 leading-none">
            <Hut kind={sty.hut as HutKind} size={30} />
          </span>
          <h1 className="min-w-0 flex-1 truncate text-2xl text-plum">{sty.name}</h1>
          <span className="micro shrink-0">{users ? `${users.length} pigs` : ""}</span>
          {sty.is_admin && (
            <button onClick={() => setAdminOpen(true)} className="tag shrink-0 !py-0.5 text-xs" aria-label="sty settings">
              ⚙ admin
            </button>
          )}
        </div>

        {/* The queue sits at the top of the sty for its admins and nowhere else
            — it's a job to do, so it should be in the way. */}
        {sty.is_admin && sty.pending.length > 0 && (
          <div className="card mt-2 grid gap-1.5 p-2.5">
            <p className="font-display text-sm font-bold">
              {sty.pending.length} {sty.pending.length === 1 ? "pig wants" : "pigs want"} in
            </p>
            {sty.pending.map((u) => (
              <div key={u.id} className="flex items-center gap-2">
                <PigAvatar config={u.pig_avatar_config} placesLogged={u.places_logged}
                  lastLoggedAt={u.last_logged_at} size={30} variant="face" />
                <span className="min-w-0 flex-1 truncate text-sm">{u.display_name}</span>
                <button onClick={() => act(() => api.decideRequest(sty.id, u.id, "decline"))}
                  className="btn-plain shrink-0 !px-2.5 !py-1 text-xs">no</button>
                <button onClick={() => act(() => api.decideRequest(sty.id, u.id, "approve"))}
                  className="btn-primary shrink-0 !px-2.5 !py-1 text-xs">let in</button>
              </div>
            ))}
          </div>
        )}

        <label className="field mt-2 flex items-center gap-2 !py-1.5">
          <span aria-hidden className="text-ink-soft">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="find a pig…"
            className="w-full bg-transparent text-sm outline-none" aria-label="find a pig" />
          {query && <button onClick={() => setQuery("")} className="micro shrink-0" aria-label="clear">clear</button>}
        </label>

        <button onClick={() => setRosterOpen(true)} className="btn-plain mt-2 w-full py-2 text-sm" disabled={!users?.length}>
          The pigs of the sty
        </button>
      </header>

      <main className="mx-auto max-w-[1400px] px-3">
        {!users && <Spinner label="rounding them up…" />}

        {users && (
          <>
            <div
              ref={viewport}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="relative h-[58vh] min-h-[320px] cursor-grab touch-none overflow-hidden rounded-card border-2 border-ink active:cursor-grabbing lg:h-[calc(100vh-230px)]"
              style={{ backgroundImage: floor.base }}
            >
              <div
                className="absolute left-0 top-0 origin-top-left"
                style={{ width: fieldW, height: fieldH, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
              >
                {/* The floor's texture, tiled far past the pigs so pulling back
                    never reaches an edge. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute"
                  style={{
                    left: -fieldW * 2, top: -fieldH * 2, width: fieldW * 5, height: fieldH * 5,
                    backgroundImage: floor.tile, backgroundRepeat: "repeat",
                  }}
                />

                {graveyard && (
                  <div style={{ position: "absolute", left: graveyard.x, top: graveyard.y }}>
                    <GraveyardGround width={graveyard.width} height={graveyard.height} />
                  </div>
                )}

                {spots.map(({ user, x, y, landmark }) => {
                  const dim = !!q && !matches(user);
                  const isChosen = user.id === selected;
                  return (
                    <button
                      key={user.id}
                      onClick={() => pick(user.id)}
                      className="absolute -translate-x-1/2 -translate-y-1/2 transition-opacity"
                      style={{ left: x, top: y, opacity: dim ? 0.22 : 1, zIndex: isChosen ? 20 : 1 }}
                      aria-label={user.display_name}
                    >
                      {/* A dark floor swallows a charcoal pig, so it stands in
                          its own patch of light. */}
                      {floor.needsHalo && !landmark && (
                        <span aria-hidden className="pointer-events-none absolute bottom-1 left-1/2 h-5 w-[70px] -translate-x-1/2 rounded-[50%] bg-oat/25 blur-[3px]" />
                      )}
                      {landmark === "throne" ? (
                        <Throne user={user} />
                      ) : landmark === "shame" ? (
                        <ShameEnclosure user={user} />
                      ) : landmark === "grave" ? (
                        <Grave user={user} />
                      ) : (
                        <span className="pig-bob block" style={{ animationDelay: `${-(hash(user.id) % 3000) / 1000}s` }}>
                          <PigAvatar config={user.pig_avatar_config} placesLogged={user.places_logged}
                            lastLoggedAt={user.last_logged_at} size={STY_PIG} variant="full" />
                        </span>
                      )}
                      {isChosen && !landmark && (
                        <span className="pointer-events-none absolute bottom-0 left-1/2 h-4 w-16 -translate-x-1/2 rounded-[50%] border-[3px] border-plum" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Scenery that belongs to the screen, not the field: mountains
                  stay at the top and the sea stays at the bottom however you pan. */}
              {floor.top}
              {floor.bottom}

              {q && hits.length === 0 && (
                <p className="absolute inset-x-0 top-1/2 text-center font-display text-sm font-bold text-ink">
                  no pig by that name
                </p>
              )}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span className="micro shrink-0">wide</span>
              <input type="range" min={MIN_SCALE * 100} max={MAX_SCALE * 100} value={scale * 100}
                onChange={(e) => setScale(Number(e.target.value) / 100)}
                className="h-1.5 flex-1 accent-plum" aria-label="zoom" />
              <span className="micro shrink-0">close</span>
              <button onClick={() => fitAll(fieldW, fieldH)} className="tag shrink-0 !py-0.5 text-xs">all</button>
            </div>

            <div className="card mt-2 flex items-center gap-2.5 p-2.5">
              {chosen ? (
                <>
                  <PigAvatar config={chosen.pig_avatar_config} placesLogged={chosen.places_logged}
                    lastLoggedAt={chosen.last_logged_at} size={38} variant="face" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-base font-bold leading-tight">{chosen.display_name}</p>
                    <p className="micro truncate">
                      @{chosen.username} · {chosen.places_logged} {chosen.places_logged === 1 ? "place" : "places"}
                      {!!chosen.og_oinks && ` · ${chosen.og_oinks} og`} ·{" "}
                      {TIER_LABELS[fatnessTier(chosen.places_logged, chosen.last_logged_at)].toLowerCase()}
                    </p>
                  </div>
                  <Link href={`/profile/${chosen.username}`} className="btn-primary shrink-0 text-xs">visit</Link>
                </>
              ) : (
                <p className="micro w-full text-center">tap a pig to see who it is</p>
              )}
            </div>
          </>
        )}
      </main>

      <PigsOfTheSty open={rosterOpen} onClose={() => setRosterOpen(false)} users={users ?? []} />

      <Sheet open={adminOpen} onClose={() => setAdminOpen(false)} title={`${sty.name} · admin`}>
        <div className="grid gap-4 pb-2">
          <section className="grid gap-1.5">
            <p className="micro">the hut, on the farm</p>
            <div className="grid grid-cols-3 gap-1.5">
              {HUTS.map((h) => (
                <button key={h} onClick={() => act(() => api.updateSty(sty.id, { hut: h }))}
                  className={`grid justify-items-center gap-0.5 rounded-card border-2 p-1.5 ${
                    sty.hut === h ? "border-plum bg-cream" : "border-ink bg-oat"}`}>
                  <Hut kind={h} size={52} />
                  <span className="micro">{HUT_LABELS[h]}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="grid gap-1.5">
            <p className="micro">the ground, inside</p>
            <div className="grid grid-cols-3 gap-1.5">
              {GROUNDS.map((g) => (
                <button key={g} onClick={() => act(() => api.updateSty(sty.id, { ground: g }))}
                  className={`grid justify-items-center gap-1 rounded-card border-2 p-1.5 ${
                    sty.ground === g ? "border-plum bg-cream" : "border-ink bg-oat"}`}>
                  <GroundSwatch kind={g} />
                  <span className="micro">{GROUND_LABELS[g]}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="grid gap-1.5">
            <p className="micro">the pigs</p>
            {(users ?? []).map((u) => {
              const isAdmin = sty.admins.some((a) => a.id === u.id);
              return (
                <div key={u.id} className="flex items-center gap-2">
                  <PigAvatar config={u.pig_avatar_config} placesLogged={u.places_logged}
                    lastLoggedAt={u.last_logged_at} size={30} variant="face" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {u.display_name}
                    {isAdmin && <span className="micro-pill ml-1 bg-plum text-oat">admin</span>}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {!isAdmin && (
                      <button onClick={() => act(() => api.promoteInSty(sty.id, u.id))}
                        className="btn-plain !px-2 !py-0.5 text-[11px]">make admin</button>
                    )}
                    <button onClick={() => act(() => api.removeFromSty(sty.id, u.id))}
                      className="btn-plain !px-2 !py-0.5 text-[11px]">remove</button>
                  </span>
                </div>
              );
            })}
          </section>

          {/* Last, and behind a second tap. Knocking a sty down can't be undone,
              and the confirm names it so you can see which one you're on. */}
          <section className="grid gap-1.5 border-t-2 border-oat-deep pt-3">
            <p className="micro">knock it down</p>
            {confirmDelete ? (
              <div className="grid gap-1.5">
                <p className="text-sm">
                  delete <span className="font-bold">{sty.name}</span> for all{" "}
                  {sty.member_count} pigs? the places everyone logged stay put — only the
                  sty goes.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="btn-plain flex-1 text-sm">
                    keep it
                  </button>
                  <button onClick={demolish} className="btn-primary flex-1 text-sm">
                    delete it
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="btn-plain w-full text-sm">
                delete this sty
              </button>
            )}
          </section>
        </div>
      </Sheet>

      <TabBarSpacer />
      <BottomTabBar />
    </>
  );
}

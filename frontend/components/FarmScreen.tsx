"use client";

/**
 * The farm — every sty, standing on the meadow (spec §6.6).
 *
 * Huts are scattered rather than listed. Each one's patch of grass comes from a
 * hash of its id, so a sty sits in the same place every visit and you find it by
 * learning where it is — the same bargain the pigsty makes with its pigs.
 *
 * The whole farm is always visible: a sty is a lens, not a wall. What you can't
 * do is walk into one uninvited, so sties you're not in are chained shut.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { StySummary } from "@/lib/types";
import { Hut, ChainedLock, type HutKind } from "@/components/pigs/Huts";
import PigAvatar from "@/components/pigs/PigAvatar";
import BottomTabBar, { TabBarSpacer } from "@/components/BottomTabBar";
import { Spinner } from "@/components/ui";
import NewStySheet from "@/components/NewStySheet";
import ModerationQueue from "@/components/ModerationQueue";

const CELL_W = 150;
const CELL_H = 168;
const MIN_SCALE = 0.4;
const MAX_SCALE = 1.5;

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

type Spot = { sty: StySummary; x: number; y: number };

/**
 * Yours toward the middle, the rest further out. Within each band a hut's cell
 * is claimed by hash with linear probing, so a new sty takes an empty patch
 * rather than shifting anybody who's already there.
 */
function layout(sties: StySummary[]) {
  const n = Math.max(sties.length, 1);
  const cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.6)));
  const rows = Math.max(2, Math.ceil(n / cols));
  const width = cols * CELL_W;
  const height = rows * CELL_H;
  const centre = { x: (cols - 1) / 2, y: (rows - 1) / 2 };

  const cells: { cx: number; cy: number; d: number }[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      cells.push({ cx, cy, d: Math.hypot(cx - centre.x, cy - centre.y) });
    }
  }
  // Nearest the middle first, so mine can be handed the innermost patches.
  cells.sort((a, b) => a.d - b.d);

  const taken = new Set<number>();
  const spots: Spot[] = [];
  const ordered = [...sties].sort(
    (a, b) => Number(b.is_member) - Number(a.is_member) || a.id.localeCompare(b.id)
  );

  for (const sty of ordered) {
    const h = hash(sty.id);
    // Members search from the centre outward, non-members from the edge inward.
    const order = sty.is_member ? cells : [...cells].reverse();
    let idx = h % order.length;
    let cell = order[idx];
    let guard = 0;
    while (taken.has(cell.cy * cols + cell.cx) && guard++ < order.length) {
      idx = (idx + 1) % order.length;
      cell = order[idx];
    }
    taken.add(cell.cy * cols + cell.cx);

    const jx = ((h >> 8) % 1000) / 1000 - 0.5;
    const jy = ((h >> 18) % 1000) / 1000 - 0.5;
    spots.push({
      sty,
      x: ((cell.cx + 0.5 + jx * 0.4) / cols) * width,
      y: ((cell.cy + 0.5 + jy * 0.36) / rows) * height,
    });
  }
  return { spots, width, height };
}

const MEADOW_TILE = (() => {
  const petals: [number, number][] = [[15, 10], [11.55, 14.76], [5.95, 12.94], [5.95, 7.06], [11.55, 5.24]];
  const parts: string[] = [];
  for (let i = 0; i < 84; i++) {
    const h = hash(`farm-${i}`);
    const x = ((h % 1000) / 1000) * 340;
    const y = (((h >> 10) % 1000) / 1000) * 340;
    if (i % 3 === 0) {
      const c = ["#E6D389", "#D8B5F7", "#F5BCC8", "#FFFDF6"][h % 4];
      parts.push(
        petals.map(([px, py]) =>
          `<circle cx="${(x + px - 10).toFixed(1)}" cy="${(y + py - 10).toFixed(1)}" r="3.4" fill="${c}" stroke="#4D303F" stroke-width="1.4"/>`).join("") +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#CFA51F"/>`
      );
    } else {
      const r = ((h >> 20) % 24) - 12;
      parts.push(`<g transform="rotate(${r} ${x.toFixed(1)} ${y.toFixed(1)})"><path d="M${(x - 4).toFixed(1)} ${(y + 5).toFixed(1)} Q${(x - 2.8).toFixed(1)} ${(y - 1).toFixed(1)} ${(x - 1).toFixed(1)} ${(y - 4).toFixed(1)} M${x.toFixed(1)} ${(y + 5).toFixed(1)} Q${(x + 0.4).toFixed(1)} ${(y - 1).toFixed(1)} ${(x + 1).toFixed(1)} ${(y - 4).toFixed(1)}" fill="none" stroke="#7FA366" stroke-width="1.6" stroke-linecap="round"/></g>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="340" viewBox="0 0 340 340">${parts.join("")}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
})();

export default function FarmScreen({ initialSties }: { initialSties: StySummary[] | null }) {
  const router = useRouter();
  const [sties, setSties] = useState<StySummary[] | null>(initialSties);
  const [query, setQuery] = useState("");
  const [mineOnly, setMineOnly] = useState(true);
  const [locked, setLocked] = useState<StySummary | null>(null);
  // The reports queue only exists for people who administer a sty, so the way
  // in only appears for them. Asked once, when the farm loads.
  const [canModerate, setCanModerate] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);

  const [scale, setScale] = useState(0.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const framed = useRef(false);

  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<{ dist: number; scale: number; fx: number; fy: number } | null>(null);
  const captured = useRef(new Set<number>());

  const load = () => api.sties().then(setSties).catch(() => {});
  useEffect(() => { load(); }, []);
  // Whether to offer the reports queue. A failure here is not worth surfacing:
  // the worst case is a button that isn't shown, and the API refuses anyone
  // who shouldn't get in regardless.
  useEffect(() => {
    api.account().then((a) => setCanModerate(a.is_sty_admin)).catch(() => {});
  }, []);

  const { spots, width, height } = useMemo(() => layout(sties ?? []), [sties]);
  const q = query.trim().toLowerCase();

  const matches = (s: StySummary) =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    s.members.some(
      (m) => m.display_name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
    );

  const shown = spots.filter((s) => (!mineOnly || s.sty.is_member) && matches(s.sty));

  function frame(list: Spot[]) {
    const box = viewport.current?.getBoundingClientRect();
    if (!box || list.length === 0) return;
    const pad = 90;
    const xs = list.map((s) => s.x);
    const ys = list.map((s) => s.y);
    const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(box.width / w, box.height / h)));
    setScale(s);
    setPan({
      x: box.width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * s,
      y: box.height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * s,
    });
  }

  useEffect(() => {
    if (framed.current || !sties?.length) return;
    framed.current = true;
    frame(spots.filter((s) => s.sty.is_member));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sties]);

  // Toggling reframes rather than reflowing: the huts never move, the view does.
  useEffect(() => {
    if (!sties?.length) return;
    frame(mineOnly ? spots.filter((s) => s.sty.is_member) : spots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineOnly]);

  // Searching pans to the match rather than filtering the farm down.
  useEffect(() => {
    if (!q) return;
    const hit = spots.filter((s) => matches(s.sty));
    if (hit.length) frame(hit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function local(e: { clientX: number; clientY: number }) {
    const box = viewport.current?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  }
  function capture(id: number) {
    if (captured.current.has(id)) return;
    viewport.current?.setPointerCapture(id);
    captured.current.add(id);
  }
  function onDown(e: React.PointerEvent) {
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
  function onMove(e: React.PointerEvent) {
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
    // Capture is taken late: a captured pointer retargets the following click to
    // the field, so taking it up front sends every tap to the meadow.
    if (Math.abs(next.x - pan.x) + Math.abs(next.y - pan.y) > 3) {
      drag.current.moved = true;
      capture(e.pointerId);
    }
    if (!drag.current.moved) return;
    setPan(next);
  }
  function onUp(e: React.PointerEvent) {
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

  function open(sty: StySummary) {
    if (drag.current?.moved) return;
    if (sty.is_member) router.push(`/farm/${sty.id}`);
    else setLocked(sty);
  }

  async function askToJoin() {
    if (!locked) return;
    setBusy(true);
    try {
      await api.requestToJoin(locked.id);
      await load();
      setLocked(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="sticky top-0 z-[900] bg-oat/95 px-3 pb-2 pt-3 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="wordmark text-3xl">farm</h1>
          <div className="flex items-center gap-2">
            {canModerate && (
              <button
                onClick={() => setQueueOpen(true)}
                className="btn bg-cream px-3 py-1 text-xs"
              >
                Reports
              </button>
            )}
            <span className="micro">{sties ? `${sties.length} sties` : ""}</span>
          </div>
        </div>
        <label className="field mt-2 flex items-center gap-2 !py-1.5">
          <span aria-hidden className="text-ink-soft">⌕</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="find a sty or a pig…"
            className="w-full bg-transparent text-sm outline-none"
            aria-label="find a sty or a pig"
          />
        </label>
        <div className="mt-2 flex overflow-hidden rounded-full border-2 border-ink">
          {[["my sties", true], ["whole farm", false]].map(([label, mine]) => (
            <button
              key={String(label)}
              onClick={() => setMineOnly(mine as boolean)}
              className={`flex-1 py-1 font-display text-xs font-bold ${
                mineOnly === mine ? "bg-plum text-oat" : "bg-cream text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="relative px-3">
        {!sties && <Spinner label="walking the farm…" />}

        {sties && (
          <>
            <div
              ref={viewport}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              className="relative h-[62vh] min-h-[340px] cursor-grab touch-none overflow-hidden rounded-card border-2 border-ink active:cursor-grabbing"
              style={{ background: "linear-gradient(#AECD8F, #8FB374)" }}
            >
              <div
                className="absolute left-0 top-0 origin-top-left"
                style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute"
                  style={{
                    left: -width * 2,
                    top: -height * 2,
                    width: width * 5,
                    height: height * 5,
                    backgroundImage: MEADOW_TILE,
                    backgroundRepeat: "repeat",
                  }}
                />
                {shown.map(({ sty, x, y }) => (
                  <button
                    key={sty.id}
                    onClick={() => open(sty)}
                    className="absolute grid -translate-x-1/2 -translate-y-1/2 justify-items-center gap-0.5"
                    style={{ left: x, top: y }}
                    aria-label={sty.is_member ? sty.name : `${sty.name}, locked`}
                  >
                    <span className="relative block leading-none" style={{ opacity: sty.is_member ? 1 : 0.78 }}>
                      <Hut kind={sty.hut as HutKind} size={78} />
                      {!sty.is_member && (
                        // Full strength over a dimmed hut: a sty someone locked,
                        // not a picture someone faded.
                        <span className="absolute inset-0" style={{ opacity: 1 }}>
                          <ChainedLock size={78} />
                        </span>
                      )}
                    </span>
                    <span className="whitespace-nowrap rounded-full border-2 border-ink bg-cream px-2 text-[11px] font-bold">
                      {sty.name}
                    </span>
                    <span className="flex items-center gap-0.5">
                      {sty.members.slice(0, 3).map((m) => (
                        <PigAvatar key={m.id} config={m.pig_avatar_config} placesLogged={m.places_logged}
                          lastLoggedAt={m.last_logged_at} size={17} variant="face" />
                      ))}
                      <span className="micro">{sty.member_count}</span>
                      {sty.pending_count > 0 && (
                        <span className="micro-pill bg-gold text-ink">{sty.pending_count}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>

              {shown.length === 0 && (
                <p className="absolute inset-x-0 top-1/2 text-center font-display text-sm font-bold">
                  {q ? "no sty or pig by that name" : "you're not in a sty yet"}
                </p>
              )}
            </div>

            <button
              onClick={() => setMaking(true)}
              className="absolute bottom-4 right-6 z-10 grid h-14 w-14 place-items-center rounded-full border-2 border-ink bg-plum text-3xl leading-none text-oat"
              aria-label="make a sty"
            >
              +
            </button>
          </>
        )}
      </main>

      {locked && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-ink-deep/60 px-6"
          role="dialog" aria-modal="true" onClick={() => setLocked(null)}>
          <div className="card grid w-full max-w-[330px] justify-items-center gap-2 p-5"
            onClick={(e) => e.stopPropagation()}>
            <span className="relative block leading-none">
              <Hut kind={locked.hut as HutKind} size={92} />
              <span className="absolute inset-0"><ChainedLock size={92} /></span>
            </span>
            <p className="text-center font-display text-lg font-bold">you are not a pig of this sty</p>
            <p className="micro text-center">
              {locked.name} · {locked.member_count} pigs
            </p>
            <div className="mt-1 flex w-full gap-2">
              <button onClick={() => setLocked(null)} className="btn-plain flex-1 text-sm">cancel</button>
              <button onClick={askToJoin} disabled={busy || locked.has_requested}
                className="btn-primary flex-1 text-sm disabled:opacity-50">
                {locked.has_requested ? "requested" : busy ? "asking…" : "request to join"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ModerationQueue open={queueOpen} onClose={() => setQueueOpen(false)} />

      <NewStySheet open={making} onClose={() => setMaking(false)} onMade={(sty) => { setMaking(false); load(); router.push(`/farm/${sty.id}`); }} />

      <TabBarSpacer />
      <BottomTabBar />
    </>
  );
}

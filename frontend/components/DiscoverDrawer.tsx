"use client";

/**
 * The phone's half of discover.
 *
 * A laptop shows the map and the list side by side. A phone can't, and the
 * old answer was a Map/List toggle — which made them two screens, so you were
 * either looking at where things are or at what they are, never both.
 *
 * This is one screen instead: the map fills it, and the list lives in a drawer
 * along the bottom. It rests at one of three heights — a peek showing a single
 * place (whichever pin you tapped, or the newest thing on screen), a half sheet,
 * and near-full. You drag between them and it follows your finger; where it
 * lands is decided by which way you were going when you let go, not by which
 * stop happens to be nearest, so a short deliberate push up never drops you
 * back where you started.
 *
 * It animates its height rather than sliding on `transform`. A transform on a
 * bottom-anchored panel pushes its base *past* the anchor, so the shut state
 * ended up lying over the tab bar; height keeps the base where it was put.
 *
 * The drag writes that height straight to the DOM as a custom property, and
 * React renders a constant `height: var(--h)` it never re-touches. Putting the
 * live height in React state instead would re-render every card in the list on
 * every pointer event, which is exactly the frame budget a drag needs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlaceSummary } from "@/lib/types";
import PlaceListCard from "@/components/PlaceListCard";
import { EmptyState } from "@/components/ui";

/**
 * How tall the drawer is when shut: the handle strip (38), the sort row (37)
 * and one card, ending at 161, cut in the 12px gap before the next card starts
 * at 173. Measured rather than guessed, in both directions — a peek taller than
 * its contents is a band of empty oat where the map should be, and one a few
 * pixels shorter leaves a sliver of the next card pinned to the bottom edge.
 *
 * The sort row costs the map 38px it didn't use to. That's the price of the row
 * never having to appear: it used to mount when the drawer opened, which is
 * both the jump you saw and, with the list behind it, the stutter you felt.
 */
export const PEEK = 172;
/** Air kept above the drawer at full height, so the map never disappears
 *  entirely and the filter button stays reachable. */
const TOP_GAP = 88;
/** Travel under this, with no throw behind it, was a tap and not a drag. */
const TAP = 6;
/** px/ms. Past this the flick's direction decides where it lands, however
 *  little ground it actually covered. */
const FLICK = 0.22;
/** Only the last of a gesture describes where it was heading — a slow drag
 *  that ends in a flick should read as a flick. */
const VELOCITY_WINDOW = 80;

export type Detent = "min" | "mid" | "max";
/** Shortest first. The settle logic leans on this being sorted. */
const ORDER: Detent[] = ["min", "mid", "max"];

type Snaps = Record<Detent, number>;

type Drag = {
  startY: number;
  startH: number;
  snaps: Snaps;
  moved: boolean;
  /** Recent positions, for the release velocity. */
  trail: { y: number; t: number }[];
};

export default function DiscoverDrawer({
  detent,
  onDetentChange,
  places,
  anyMatches,
  sort,
  onSortChange,
}: {
  detent: Detent;
  onDetentChange: (v: Detent) => void;
  /** Sorted, and with the tapped pin's place first — that's the one on show
   *  when the drawer is shut. */
  places: PlaceSummary[];
  /** Whether anything matched the filters at all, anywhere on the map. */
  anyMatches: boolean;
  sort: string;
  onSortChange: (v: string) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  /** Set by a finished pointer gesture so the click it synthesises afterwards
   *  doesn't toggle on top of it. Keyboard clicks arrive with this clear. */
  const handled = useRef(false);

  const [snaps, setSnaps] = useState<Snaps | null>(null);
  const open = detent !== "min";

  /**
   * Held apart from the rest of the render so that settling on a new detent —
   * which changes the label, the aria and one overflow class — can't drag ten
   * cards and their pig avatars through React with it. Same elements back,
   * so React skips those subtrees entirely.
   */
  const cards = useMemo(
    () => places.map((p) => <PlaceListCard key={p.id} place={p} />),
    [places],
  );

  /** How long the next settle should take. Written by the release handler,
   *  which knows the throw; anything else gets the plain 260ms. */
  const settleMs = useRef(260);
  const mounted = useRef(false);

  const setHeight = useCallback((px: number, ms: number) => {
    const el = elRef.current;
    if (!el) return;
    // Neither of these appears in the style prop, so React's diffing leaves
    // them alone and these writes survive re-renders.
    el.style.transition = ms > 0 ? `height ${ms}ms cubic-bezier(.32,.72,0,1)` : "none";
    el.style.setProperty("--h", `${px}px`);
  }, []);

  /* The stops, in pixels. Derived from the viewport, so they have to wait for
     the client and be redone when it changes shape. */
  useEffect(() => {
    const measure = () => {
      const el = elRef.current;
      if (!el) return;
      const vh = window.innerHeight;
      // The base sits above the tab bar and the home indicator. Read the gap
      // off the element rather than re-deriving the calc() that produced it.
      const base = Math.max(0, vh - el.getBoundingClientRect().bottom);
      const min = PEEK;
      const max = Math.max(min + 160, Math.round(vh - base - TOP_GAP));
      setSnaps({ min, mid: Math.round((min + max) / 2), max });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  /* Park the drawer on its detent. The first run is the initial placement and
     must not animate; later ones are taps, key presses, or the parent. */
  useEffect(() => {
    if (!snaps) return;
    setHeight(snaps[detent], mounted.current ? settleMs.current : 0);
    mounted.current = true;
    settleMs.current = 260;
  }, [detent, snaps, setHeight]);

  function go(next: Detent) {
    if (next !== detent) onDetentChange(next);
  }

  function onPointerDown(e: React.PointerEvent) {
    const el = elRef.current;
    if (!snaps || !el || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startY: e.clientY,
      startH: el.getBoundingClientRect().height,
      snaps,
      moved: false,
      trail: [{ y: e.clientY, t: e.timeStamp }],
    };
    el.style.transition = "none";
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > TAP) d.moved = true;

    d.trail.push({ y: e.clientY, t: e.timeStamp });
    if (d.trail.length > 8) d.trail.shift();

    // Up the screen is a smaller clientY, and a taller drawer. This is the
    // whole of a drag frame: one custom property, no React, no layout.
    setHeight(resist(d.startH - dy, d.snaps.min, d.snaps.max), 0);
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    const el = elRef.current;
    drag.current = null;
    handled.current = true;
    if (!d || !el) return;

    const h = el.getBoundingClientRect().height;
    const v = velocity(d.trail);
    // A throw wins outright; failing that, whichever way it actually moved.
    const dir =
      Math.abs(v) > FLICK ? (v < 0 ? 1 : -1) : d.moved ? (h > d.startH ? 1 : -1) : 0;

    if (dir === 0) {
      setHeight(d.snaps[detent], 200);
      toggle();
      return;
    }

    const target = bracket(h, d.snaps, dir);
    // Fast throws land fast, gentle releases ease in. The floor stops a short
    // hop from snapping so hard it reads as a jump.
    const ms = clamp(
      Math.round(Math.abs(d.snaps[target] - h) / Math.max(Math.abs(v), 0.6)),
      170,
      420,
    );

    settleMs.current = ms;
    setHeight(d.snaps[target], ms);
    go(target);
  }

  function onPointerCancel() {
    const d = drag.current;
    drag.current = null;
    handled.current = true;
    if (!d) return;
    setHeight(d.snaps[detent], 200);
  }

  /** Tap opens to the half sheet, or shuts it. The third stop is the drag's. */
  function toggle() {
    go(detent === "min" ? "mid" : "min");
  }

  /** Pointer gestures settle themselves; this is the keyboard's way in, and it
   *  has to ignore the click that follows every touch. */
  function onClick() {
    if (handled.current) {
      handled.current = false;
      return;
    }
    toggle();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const i = ORDER.indexOf(detent);
    go(ORDER[clamp(i + (e.key === "ArrowUp" ? 1 : -1), 0, ORDER.length - 1)]);
  }

  return (
    <div
      ref={elRef}
      className="fixed inset-x-0 z-[1200] overflow-hidden rounded-t-3xl border-x-2 border-t-2 border-ink bg-oat shadow-lift lg:hidden"
      style={{
        bottom: "calc(100px + env(safe-area-inset-bottom))",
        // Constant on purpose — see the note at the top of the file. The
        // fallback covers the first paint, before the stops are measured.
        height: `var(--h, ${PEEK}px)`,
      }}
      aria-label="places in view"
    >
      {/*
        Held at full height whatever the drawer is doing, and clipped by it.
        The drag then changes only where this gets cut off — if the panel were
        sized off the drawer instead, every frame would re-run the flex column
        and re-measure the scroll area under a list of cards.
      */}
      <div
        className="flex flex-col"
        style={{ height: snaps ? `${snaps.max}px` : "68vh" }}
      >
        {/* The whole strip is the handle, not just the bar — a 4px target is a
            gesture only its author can hit. */}
        <button
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={onClick}
          onKeyDown={onKeyDown}
          className="flex w-full shrink-0 touch-none select-none flex-col items-center gap-1 px-3 pb-1 pt-2.5"
          aria-expanded={open}
          aria-label={`${places.length} places in view — drag, or use the arrow keys, to resize the list`}
        >
          <span aria-hidden className="h-1.5 w-11 rounded-full bg-ink/25" />
          <span className="micro w-full text-left">
            {places.length} {places.length === 1 ? "place" : "places"} in view
            <span className="float-right">{open ? "close" : "see all"}</span>
          </span>
        </button>

        {/* The sort and the list are always here, however shut the drawer is —
            the drag only moves the edge that hides them. They used to be
            swapped in at a threshold, which meant mounting every card in the
            middle of a gesture: one 76ms frame, right where the hand expects
            the list to start following it. */}
        <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
          <label className="ml-auto flex items-center gap-1.5">
            <span className="micro">sort</span>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value)}
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

        {/* Shut, the list can't be scrolled — the one card on show is the peek,
            and a stray swipe scrolling it out of sight would be a puzzle. The
            class only changes when a gesture settles, never during one. */}
        <div
          className={`min-h-0 flex-1 space-y-3 px-3 pb-4 ${
            open ? "overflow-y-auto overscroll-contain" : "overflow-hidden"
          }`}
        >
          {places.length === 0 && <Nothing anyMatches={anyMatches} />}
          {cards}
        </div>
      </div>
    </div>
  );
}

/**
 * Which stop a drag released at `h` heading `dir` belongs to: the one above it
 * going up, the one below it going down. Past either end there's nothing to
 * move on to, so it stays put.
 */
function bracket(h: number, snaps: Snaps, dir: number): Detent {
  if (dir > 0) {
    return ORDER.find((k) => snaps[k] > h + 0.5) ?? "max";
  }
  return [...ORDER].reverse().find((k) => snaps[k] < h - 0.5) ?? "min";
}

/** Past the ends the drawer still moves, just grudgingly — a panel that stops
 *  dead under your finger reads as broken rather than as bounded. */
function resist(h: number, min: number, max: number) {
  if (h > max) return max + (h - max) * 0.25;
  if (h < min) return min - (min - h) * 0.12;
  return h;
}

/** px/ms, positive downwards, over the tail of the gesture. */
function velocity(trail: { y: number; t: number }[]) {
  const last = trail[trail.length - 1];
  let first = trail[0];
  for (let i = trail.length - 1; i >= 0; i--) {
    if (last.t - trail[i].t > VELOCITY_WINDOW) break;
    first = trail[i];
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function Nothing({ anyMatches }: { anyMatches: boolean }) {
  return (
    <EmptyState
      title="nothing here"
      body={
        anyMatches
          ? "no matches in this part of the map — pan out, or move the map."
          : "loosen the filters a bit."
      }
    />
  );
}

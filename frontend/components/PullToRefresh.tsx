"use client";

/**
 * Pull down at the top of the page to reload — the gesture every other social
 * app has trained people to expect.
 *
 * The browser's own pull-to-refresh is suppressed in globals.css
 * (`overscroll-behavior-y: contain`), so this owns the gesture outright rather
 * than racing it.
 *
 * Touch handlers are attached natively rather than through React props because
 * React registers `touchmove` passively at the root, and a passive listener
 * can't `preventDefault()` — without which the page scrolls away under the
 * pull instead of following it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Pull past this and letting go refreshes. ~115px of finger travel. */
const TRIGGER = 60;
/** Rubber-band ceiling. The page approaches this and never reaches it, so
 *  there's no point where the pull visibly stops dead against a clamp. */
const MAX = 110;
/** Where the indicator parks while the request is in flight. */
const HOLD = 48;
/** How much of the first pixel of travel the page takes. It gives up more of
 *  each subsequent pixel — see `damp`. */
const RESISTANCE = 0.75;
/** A beat of spinner after a fast response, so the refresh reads as one. */
const SETTLE_MS = 320;

/**
 * Finger travel → how far the page actually moves.
 *
 * A flat fraction of the travel was the tell that this wasn't the browser's
 * own bounce: real elastic scrolling gives up ground more grudgingly the
 * further you pull, then stops against a ceiling it never quite reaches. This
 * curve starts at RESISTANCE and decays towards MAX, so there's no clamp to
 * hit — the pull just runs out of give.
 */
function damp(dy: number) {
  return MAX * (1 - Math.exp((-dy * RESISTANCE) / MAX));
}

export default function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown>;
  children: React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // The native listeners are bound once, so everything they read lives in refs.
  const pullRef = useRef(0);
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  // Set once the gesture has been read as a downward pull. Until then it may
  // still belong to something else — a card's photo carousel scrolls
  // sideways, and claiming that swipe would kill it.
  const claimed = useRef(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const latestRefresh = useRef(onRefresh);
  useEffect(() => {
    latestRefresh.current = onRefresh;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setPullTo = useCallback((v: number) => {
    pullRef.current = v;
    setPull(v);
  }, []);

  const run = useCallback(async () => {
    busy.current = true;
    setRefreshing(true);
    setPullTo(HOLD);
    try {
      await latestRefresh.current();
    } catch {
      /* the feed keeps whatever it already had — a failed refresh isn't news */
    }
    window.setTimeout(() => {
      if (!alive.current) return;
      setPullTo(0);
      setRefreshing(false);
      busy.current = false;
    }, SETTLE_MS);
  }, [setPullTo]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const armed = () =>
      !busy.current &&
      window.scrollY <= 0 &&
      // A sheet locks the body; its own scroll shouldn't reload the page under it.
      document.body.style.overflow !== "hidden";

    const reset = () => {
      startY.current = null;
      claimed.current = false;
      setDragging(false);
      if (!busy.current) setPullTo(0);
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !armed()) return;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      claimed.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = e.touches[0].clientX - startX.current;

      if (!claimed.current) {
        // Too small to read yet — let the finger say what it means first.
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        // Sideways, or upward: not ours.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          startY.current = null;
          return;
        }
        claimed.current = true;
      }

      // The page scrolled under us — hand the gesture back.
      if (window.scrollY > 0) {
        reset();
        return;
      }
      e.preventDefault();
      setDragging(true);
      setPullTo(damp(dy));
    };

    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      claimed.current = false;
      setDragging(false);
      if (pullRef.current >= TRIGGER) void run();
      else setPullTo(0);
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", reset);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", reset);
    };
  }, [run, setPullTo]);

  const progress = Math.min(1, pull / TRIGGER);
  const ready = progress >= 1;
  // Springs back when the finger leaves, follows it exactly while it's down.
  const glide = dragging ? undefined : "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)";

  return (
    <div ref={host} className="relative">
      {/* Sits in the strip the pull opens up at the top of the screen, above
          the header that's travelling down with the feed. A sibling of the
          moving content rather than a child, so the transform below doesn't
          carry it along and double its travel. Parked off the top at rest, and
          transparent there besides. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-[901] flex justify-center"
        style={{ transform: `translateY(${pull - 44}px)`, opacity: progress, transition: glide }}
      >
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink bg-cream ${
            ready || refreshing ? "text-plum" : "text-ink-soft"
          }`}
        >
          {refreshing ? (
            <span className="h-4 w-4 animate-spin rounded-full border-[3px] border-oat-deep border-t-plum" />
          ) : (
            // Points down as you start and swings up as it arms — the arrow
            // says "release" without a word of copy.
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: `rotate(${180 + progress * 180}deg)`,
                transition: dragging ? undefined : "transform 200ms ease-out",
              }}
            >
              <path d="M12 20V4" />
              <path d="M5 11l7-7 7 7" />
            </svg>
          )}
        </div>
      </div>

      {/* No transform at rest: a permanent one would make this the containing
          block for any fixed overlay a card opens. */}
      <div style={{ transform: pull ? `translateY(${pull}px)` : undefined, transition: glide }}>
        {children}
      </div>
    </div>
  );
}

"use client";

/**
 * A scrolling list of places that only builds the cards you can see.
 *
 * Discover's list is scoped to the map, so it re-renders every time the map
 * settles. Building all of it each time is work proportional to how many places
 * exist rather than to how many are on screen: at a few hundred, opening the
 * phone drawer cost ~316ms of script and ~729ms of main thread to mount 245
 * cards, of which about five were visible.
 *
 * This renders the visible window plus a few rows of slack, inside a spacer
 * tall enough to keep the scrollbar honest. Mount cost then depends on the
 * height of the drawer, not the size of the dataset.
 *
 * Fixed-height windowing is exact here rather than estimated, because
 * PlaceListCard cannot vary: an 80px thumbnail plus its 2px borders, and every
 * piece of text in it is `truncate`, so nothing wraps to a second line. If that
 * ever stops being true this list will drift, which is why CARD_H lives next to
 * the reason it holds.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaceSummary } from "@/lib/types";
import PlaceListCard from "@/components/PlaceListCard";

/** PlaceListCard's fixed height — see the note above before changing it. */
const CARD_H = 84;
/** The `space-y-3` between cards. */
const GAP = 12;
const ROW = CARD_H + GAP;
/** Rows kept mounted past each edge, so a fast flick doesn't outrun the
 *  render and show a band of empty oat. */
const OVERSCAN = 4;
/** Row counts are rounded up to this, so a drawer animating open doesn't
 *  re-render the list on every frame of the transition. */
const CHUNK = 8;

export default function VirtualPlaceList({
  places,
  className,
  empty,
}: {
  places: PlaceSummary[];
  className?: string;
  /** Shown instead of the list when there's nothing to show. */
  empty?: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ first: 0, count: 12 });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const first = Math.max(0, Math.floor(el.scrollTop / ROW) - OVERSCAN);
    // +1 for the row straddling the bottom edge. Rounded up to a whole
    // CHUNK because the drawer animates its height open: measured exactly,
    // the count would tick up on every frame of that transition and re-render
    // the list each time. Quantised, it changes once or twice.
    const fits = Math.ceil(el.clientHeight / ROW) + OVERSCAN * 2 + 1;
    const count = Math.ceil(fits / CHUNK) * CHUNK;
    setRange((r) => (r.first === first && r.count === count ? r : { first, count }));
  }, []);

  /* Scroll fires far more often than the screen refreshes, and each one of
     these is a React render — so coalesce them to one a frame. */
  const queued = useRef(false);
  const onScroll = useCallback(() => {
    if (queued.current) return;
    queued.current = true;
    requestAnimationFrame(() => {
      queued.current = false;
      measure();
    });
  }, [measure]);

  /* The drawer changes height as it opens, which changes how many rows fit.
     A resize observer catches that without the drawer having to say so. */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  /* A new set of places — a filter, a sort, a pan — can leave the window
     scrolled past the end of a now-shorter list. */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const max = Math.max(0, places.length * ROW - GAP - el.clientHeight);
    if (el.scrollTop > max) el.scrollTop = max;
    measure();
  }, [places, measure]);

  const slice = places.slice(range.first, range.first + range.count);

  return (
    <div ref={scroller} onScroll={onScroll} className={className}>
      {places.length === 0 && empty}
      {places.length > 0 && (
        // Tall enough for the whole list, so the scrollbar and the fling
        // distance match what's actually there.
        <div style={{ height: Math.max(0, places.length * ROW - GAP) }}>
          {/* Offset on transform rather than padding — this moves every frame
              of a scroll, and padding would relayout the spacer each time. */}
          <div className="space-y-3" style={{ transform: `translateY(${range.first * ROW}px)` }}>
            {slice.map((p) => (
              <PlaceListCard key={p.id} place={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

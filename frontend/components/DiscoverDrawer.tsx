"use client";

/**
 * The phone's half of discover.
 *
 * A laptop shows the map and the list side by side. A phone can't, and the
 * old answer was a Map/List toggle — which made them two screens, so you were
 * either looking at where things are or at what they are, never both.
 *
 * This is one screen instead: the map fills it, and the list lives in a drawer
 * along the bottom. Collapsed it shows a single place — whichever pin you
 * tapped, or the newest thing on screen if you haven't tapped one — so there is
 * always something to read without giving up the map. Dragged up it becomes the
 * full list of what's in view, with the sort.
 *
 * It animates its height rather than sliding on `transform`. A transform on a
 * bottom-anchored panel pushes its base *past* the anchor, so the shut state
 * ended up lying over the tab bar; height keeps the base where it was put. The
 * gesture is a threshold rather than a follow-the-finger drag, so this is one
 * 260ms transition, not a reflow every frame.
 */
import { useRef } from "react";
import type { PlaceSummary } from "@/lib/types";
import PlaceListCard from "@/components/PlaceListCard";
import { EmptyState } from "@/components/ui";

/** How tall the drawer is when shut: the handle strip and one card, measured
 *  rather than guessed — a peek taller than its contents is a band of empty
 *  oat where the map should be. */
export const PEEK = 134;
const HEIGHT = "68vh";
/** Past this much travel a gesture is a drag; under it, it was a tap. */
const DRAG = 36;

export default function DiscoverDrawer({
  expanded,
  onExpandedChange,
  peek,
  places,
  anyMatches,
  sort,
  onSortChange,
}: {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  peek: PlaceSummary | null;
  places: PlaceSummary[];
  /** Whether anything matched the filters at all, anywhere on the map. */
  anyMatches: boolean;
  sort: string;
  onSortChange: (v: string) => void;
}) {
  const from = useRef<number | null>(null);

  /** Tap toggles; a drag goes wherever it was heading. One handler, because on
   *  a grab handle they're the same gesture at different lengths. */
  function onPointerDown(e: React.PointerEvent) {
    from.current = e.clientY;
  }
  function onPointerUp(e: React.PointerEvent) {
    if (from.current === null) return;
    const dy = e.clientY - from.current;
    from.current = null;
    if (dy < -DRAG) onExpandedChange(true);
    else if (dy > DRAG) onExpandedChange(false);
    else onExpandedChange(!expanded);
  }

  return (
    <div
      className="fixed inset-x-0 z-[1200] flex flex-col overflow-hidden rounded-t-3xl border-x-2 border-t-2 border-ink bg-oat shadow-lift lg:hidden"
      style={{
        bottom: "calc(100px + env(safe-area-inset-bottom))",
        height: expanded ? HEIGHT : `${PEEK}px`,
        transition: "height 260ms cubic-bezier(.22,.61,.36,1)",
      }}
      aria-label="places in view"
    >
      {/* The whole strip is the handle, not just the bar — a 4px target is a
          gesture only its author can hit. */}
      <button
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        className="flex w-full shrink-0 touch-none flex-col items-center gap-1 px-3 pb-1 pt-2.5"
        aria-expanded={expanded}
      >
        <span aria-hidden className="h-1.5 w-11 rounded-full bg-ink/25" />
        <span className="micro w-full text-left">
          {places.length} {places.length === 1 ? "place" : "places"} in view
          <span className="float-right">{expanded ? "close" : "see all"}</span>
        </span>
      </button>

      {/* Collapsed: the one place. Expanded: the sort, then all of them. */}
      {expanded ? (
        <>
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
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4">
            {places.length === 0 && <Nothing anyMatches={anyMatches} />}
            {places.map((p) => (
              <PlaceListCard key={p.id} place={p} />
            ))}
          </div>
        </>
      ) : (
        <div className="px-3 pb-3">
          {peek ? <PlaceListCard place={peek} /> : <Nothing anyMatches={anyMatches} />}
        </div>
      )}
    </div>
  );
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

/**
 * Where you'd got to on discover, kept across a trip to a place page.
 *
 * Opening a restaurant and coming back used to drop you at square one: filters
 * cleared, map re-framed on your location or on London. On a screen whose whole
 * job is narrowing things down, that's the work thrown away every time you look
 * at one of the answers.
 *
 * sessionStorage rather than localStorage on purpose. This is "where I was a
 * moment ago", not a preference — it should survive a tap through to a place
 * and back, and not still be waiting a week later.
 */
import type { Kind } from "@/lib/types";
import type { Budget } from "@/lib/pig";

const KEY = "oink_discover_view";

export type DiscoverView = {
  visited: "all" | "mine" | "new";
  kinds: Kind[];
  budgets: Budget[];
  categories: string[];
  sort: "newest" | "oinks" | "cheap" | "pricey";
  /** Where the map was pointed, and how close in. */
  center: { lat: number; lng: number; zoom: number } | null;
};

export function readDiscoverView(): Partial<DiscoverView> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<DiscoverView>) : null;
  } catch {
    // Storage disabled, or something else wrote nonsense under our key.
    // Neither is worth breaking the screen over — just open fresh.
    return null;
  }
}

export function writeDiscoverView(patch: Partial<DiscoverView>): void {
  if (typeof window === "undefined") return;
  try {
    const current = readDiscoverView() ?? {};
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* storage disabled — the screen still works, it just won't remember */
  }
}

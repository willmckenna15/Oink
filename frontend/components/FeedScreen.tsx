"use client";

/**
 * Home — recent activity from the whole friend group (spec §6.2).
 *
 * The feed arrives a page at a time. The server render carries the first page
 * only, so the document isn't waiting on cards nobody has scrolled to; a
 * sentinel below the last card pulls the next page in before it comes into
 * view. Folding still runs over everything loaded so far, which is what lets an
 * oink on page two land on the review that anchors it on page one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { FeedItem } from "@/lib/types";
import ActivityCard from "@/components/ActivityCard";
import { FEED_PAGE_SIZE, foldFeed } from "@/lib/feed";
import BottomTabBar, { TabBarSpacer } from "@/components/BottomTabBar";
import PullToRefresh from "@/components/PullToRefresh";
import { EmptyState, PageHeader, Spinner } from "@/components/ui";
import HowItWorks from "@/components/HowItWorks";
import { introPending, markIntroSeen } from "@/lib/intro";
import AddToHomeScreen from "@/components/AddToHomeScreen";
import { markInstallOffered, platform, shouldOfferInstall } from "@/lib/homescreen";
import type { Platform } from "@/lib/homescreen";

/** How far down before the back-to-top button is worth offering. */
const TOP_BUTTON_AFTER = 700;

const keyOf = (item: FeedItem) => `${item.activity}-${item.id}`;

export default function FeedScreen({ initialItems }: { initialItems: FeedItem[] | null }) {
  const [items, setItems] = useState<FeedItem[] | null>(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Set once the server runs out of rows, so the sentinel stops asking. A short
  // first page means there was never a second one.
  const [exhausted, setExhausted] = useState(
    (initialItems?.length ?? FEED_PAGE_SIZE) < FEED_PAGE_SIZE
  );
  const [showTop, setShowTop] = useState(false);

  // Rows the server has handed over, which is the offset for the next page —
  // not the rendered count, since folding hides some of them.
  const loaded = useRef(initialItems?.length ?? 0);
  const sentinel = useRef<HTMLDivElement | null>(null);
  // A refresh rewinds to page one, so paging has to stand off while one is in
  // flight or it would append rows onto a list about to be replaced.
  const refreshing = useRef(false);
  const hasItems = useRef(!!initialItems);
  useEffect(() => {
    hasItems.current = !!items;
  }, [items]);
  // Set at sign-in for anyone who hasn't seen the explainer on this device.
  const [introFor, setIntroFor] = useState<string | null>(null);

  useEffect(() => setIntroFor(introPending()), []);

  // Everyone gets the home-screen steps once, including people who joined
  // before this existed — so it can't ride on the intro's flag. It waits for
  // the intro to be dealt with rather than stacking two sheets on a new user.
  const [installFor, setInstallFor] = useState<string | null>(null);
  const [os, setOs] = useState<Platform>("desktop");
  useEffect(() => {
    if (introFor) return;
    setOs(platform());
    api
      .me()
      .then((u) => {
        if (shouldOfferInstall(u.id)) setInstallFor(u.id);
      })
      .catch(() => {
        /* not signed in, or offline — nothing to offer */
      });
  }, [introFor]);

  /**
   * Back to the first page. Used both for the snapshot refresh on mount and for
   * the pull gesture — in both cases the list resets rather than merges, which
   * is the honest thing to do when rows may have been added, edited or removed
   * above everything already loaded.
   */
  const refresh = useCallback(async () => {
    refreshing.current = true;
    try {
      const first = await api.feed(FEED_PAGE_SIZE, 0);
      loaded.current = first.length;
      setItems(first);
      setExhausted(first.length < FEED_PAGE_SIZE);
      setError(null);
    } catch (e) {
      // Only surfaced when there's nothing on screen already — a failed
      // refresh shouldn't replace a feed that's rendering fine.
      if (!hasItems.current) setError((e as Error).message ?? "Couldn't load the feed");
      throw e;
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    // The server payload is a snapshot, so refresh behind it rather than
    // trusting it forever.
    refresh().catch(() => {
      /* handled above */
    });
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || refreshing.current) return;
    setLoadingMore(true);
    try {
      const next = await api.feed(FEED_PAGE_SIZE, loaded.current);
      loaded.current += next.length;
      if (next.length < FEED_PAGE_SIZE) setExhausted(true);
      if (next.length) {
        setItems((current) => {
          const seen = new Set((current ?? []).map(keyOf));
          // A row can shift pages if something was logged mid-scroll; showing
          // it twice is worse than showing it once, high up.
          return [...(current ?? []), ...next.filter((item) => !seen.has(keyOf(item)))];
        });
      }
    } catch {
      // Left alone deliberately: the sentinel is still on screen, so the next
      // scroll retries without an error state taking over the feed.
    } finally {
      setLoadingMore(false);
    }
  }, [exhausted, loadingMore]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || exhausted || !items) return;
    // Fires a screen early, so the next page is usually already there by the
    // time the last card scrolls past.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [exhausted, items, loadMore]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > TOP_BUTTON_AFTER);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const folded = useMemo(() => (items ? foldFeed(items) : null), [items]);

  return (
    <>
      {/* Back to the top of the feed — appears only once you're deep enough in
          for the scroll back to be a chore. Stays outside the pull, both
          because a `fixed` child of a transformed element would be captured by
          it, and because it only ever shows when you're scrolled too far down
          to pull anyway. */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="back to the top"
        aria-hidden={!showTop}
        tabIndex={showTop ? 0 : -1}
        className={`fixed left-1/2 top-[68px] z-[950] flex h-10 w-10 -translate-x-1/2 items-center
                    justify-center rounded-full border-2 border-ink bg-cream font-display text-lg
                    font-bold text-ink shadow-lift transition-all duration-200 ease-out
                    active:scale-95 ${
                      showTop ? "opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
                    }`}
      >
        ↑
      </button>

      <PullToRefresh onRefresh={refresh}>
        {/* Inside the pull, so the wordmark travels with the feed rather than
            the cards sliding out from under it. */}
        <PageHeader title="oink" />

        {/* One column on a phone; two on a laptop, where a single 480px strip
            of cards down the middle of a 1400px screen is mostly wallpaper.
            Grid rather than CSS columns: columns fill top-to-bottom, which
            would put the second-newest card halfway down the page. */}
        <main className="content-rise mx-auto max-w-[1100px] space-y-4 px-3 pb-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
          {/* Full-width whatever the column count — a spinner in one half of a
              two-column grid reads as a card that failed. */}
          {error && (
            <div className="lg:col-span-2">
              <EmptyState title="couldn't load the feed" body={error} />
            </div>
          )}
          {!items && !error && (
            <div className="lg:col-span-2">
              <Spinner label="fetching the goss…" />
            </div>
          )}
          {items?.length === 0 && (
            <div className="lg:col-span-2">
              <EmptyState title="nothing here yet" body="head to discover and log the first place." />
            </div>
          )}
          {folded?.map(({ item, agreed }) => (
            <ActivityCard key={keyOf(item)} item={item} agreed={agreed} />
          ))}

          {/* Trips the next page, and holds the spinner while it lands. */}
          {items && items.length > 0 && !exhausted && (
            <div ref={sentinel} className="py-2 lg:col-span-2">
              {loadingMore && (
                <div className="flex justify-center py-3">
                  <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-oat-deep border-t-plum" />
                </div>
              )}
            </div>
          )}
        </main>
      </PullToRefresh>

      <TabBarSpacer />
      <BottomTabBar />

      <AddToHomeScreen
        open={!!installFor}
        os={os}
        onClose={() => {
          if (installFor) markInstallOffered(installFor);
          setInstallFor(null);
        }}
      />

      <HowItWorks
        open={!!introFor}
        onClose={() => {
          if (introFor) markIntroSeen(introFor);
          setIntroFor(null);
        }}
      />
    </>
  );
}

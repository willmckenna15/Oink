"use client";

/**
 * Primary navigation on a phone — spec §6: a thumb-reachable bottom tab bar,
 * not a desktop-style top nav.
 *
 * Above `lg` this hides and SideNav takes over down the left; the two share
 * TABS so they can't drift apart.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export const TABS = [
  { href: "/", label: "feed", icon: FeedIcon },
  { href: "/discover", label: "discover", icon: MapIcon },
  { href: "/farm", label: "farm", icon: FarmIcon },
  { href: "/profile/me", label: "you", icon: PigIcon },
];

export default function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-1/2 z-[1000] w-full max-w-[480px] -translate-x-1/2 border-t-2 border-ink bg-cream pt-2.5 pb-[calc(env(safe-area-inset-bottom)+26px)] lg:hidden">
      <ul className="flex">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href.replace("/me", ""));
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                /* Colour fades rather than flips, and the whole tab dips under
                   the thumb — the press should feel like it landed before the
                   next screen has had time to render. */
                className={`flex min-h-[54px] flex-col items-center justify-center gap-0.5 py-1.5
                            font-display text-[11px] font-bold transition-[color,transform]
                            duration-200 ease-out active:scale-[0.94] ${
                              active ? "text-plum" : "text-ink-soft"
                            }`}
              >
                {/* Icons inherit the link's colour, so the swap animates with it. */}
                <span
                  className={`transition-transform duration-200 ease-out ${
                    active ? "-translate-y-[1px] scale-110" : "scale-100"
                  }`}
                >
                  <Icon />
                </span>
                {label}
                {/* A dot that grows in under the active tab. */}
                <span
                  aria-hidden
                  className={`h-1 w-1 rounded-full bg-plum transition-transform duration-200 ease-out ${
                    active ? "scale-100" : "scale-0"
                  }`}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Spacer so page content isn't hidden behind the fixed bar. Tracks the bar's
 * own height — 10 top + 54 tab + 26 bottom, plus the home-indicator inset —
 * with a little air under the last card.
 */
export function TabBarSpacer() {
  return <div className="h-[calc(100px+env(safe-area-inset-bottom))] lg:h-6" aria-hidden />;
}

function FeedIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <rect x="3" y="4" width="18" height="6" rx="2.5" />
      <rect x="3" y="14" width="18" height="6" rx="2.5" />
    </svg>
  );
}

function MapIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

/** Two huts on a hill — a farm is more than one sty. */
function FarmIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M2.5 11.5 6.5 8l4 3.5V16h-8Z" />
      <path d="M13 13.5 17.5 9.5l4.5 4V19h-9Z" />
      <path d="M1.5 20.5h21" strokeLinecap="round" />
    </svg>
  );
}

function PigIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 8 5 4l5 2.5" strokeLinejoin="round" />
      <path d="M18 8l1-4-5 2.5" strokeLinejoin="round" />
      <ellipse cx="12" cy="13" rx="8" ry="7" />
      <ellipse cx="12" cy="15" rx="3.2" ry="2.2" />
    </svg>
  );
}

"use client";

/**
 * How a sty looks from the farm — spec §6.6.
 *
 * Every hut is drawn in the same 96×80 box with its door at roughly (48, 60),
 * so the padlock can hang in one place across all of them without being
 * positioned per design.
 *
 * A locked sty is *chained shut*: two chains run in from either side and meet
 * at a padlock over the door. Only the hut dims behind them — the chains and
 * lock stay at full strength, so it reads as a sty someone locked rather than a
 * picture someone faded.
 */
import type { ReactNode } from "react";

export const HUTS = ["meadow", "beach", "snow", "lava", "desert", "club"] as const;
export type HutKind = (typeof HUTS)[number];

export const HUT_LABELS: Record<HutKind, string> = {
  meadow: "corrugated sty",
  beach: "beach hut",
  snow: "igloo",
  lava: "volcano",
  desert: "sand castle",
  club: "nightclub",
};

const INK = "#4D303F";
const LEMON = "#E6D389";
const RUST = "#A9503C";
const GOLD = "#CFA51F";
const LILAC = "#D8B5F7";

const line = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" as const };

function Shape({ kind }: { kind: HutKind }) {
  switch (kind) {
    case "beach":
      return (
        <>
          <path d="M12 42 q36 -22 72 0 Z" fill={LEMON} {...line} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} d={`M${20 + i * 11} 42 q0 -12 6 -17`} fill="none" stroke={INK} strokeWidth="1.6" />
          ))}
          <rect x="22" y="40" width="52" height="32" fill="#F3E3C6" {...line} />
          <rect x="40" y="52" width="16" height="20" rx="1.5" fill="#5FBFD8" {...line} />
        </>
      );
    case "snow":
      return (
        <>
          <path d="M8 72 a40 34 0 0 1 80 0 Z" fill="#FFFFFF" {...line} />
          <path d="M16 56 h64 M24 44 h48" fill="none" stroke="#C9DAE6" strokeWidth="1.6" />
          <path d="M30 72 v-16 M48 72 v-16 M66 72 v-16 M38 56 v-12 M58 56 v-12" stroke="#C9DAE6" strokeWidth="1.6" />
          <path d="M36 72 a12 14 0 0 1 24 0 Z" fill="#BBD2E0" {...line} />
        </>
      );
    case "lava":
      return (
        <>
          <path d="M10 72 L34 26 L62 26 L86 72 Z" fill="#5E4A4A" {...line} />
          <path d="M34 26 q14 10 28 0 q-6 -10 -14 -10 q-8 0 -14 10 Z" fill={RUST} {...line} />
          <path d="M40 26 q4 -14 8 -18 q4 8 8 18 Z" fill={GOLD} />
          <path d="M44 30 q6 18 -2 40" fill="none" stroke={RUST} strokeWidth="3.2" strokeLinecap="round" />
        </>
      );
    case "desert":
      return (
        <>
          <rect x="18" y="40" width="60" height="32" fill="#E8C185" {...line} />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={18 + i * 15} y="34" width="9" height="8" fill="#E8C185" {...line} />
          ))}
          <rect x="10" y="30" width="18" height="42" fill="#DDB273" {...line} />
          <rect x="68" y="30" width="18" height="42" fill="#DDB273" {...line} />
          <path d="M10 30 h18 v-6 h-4 v3 h-4 v-3 h-4 v3 h-4 Z" fill="#DDB273" {...line} />
          <path d="M68 30 h18 v-6 h-4 v3 h-4 v-3 h-4 v3 h-4 Z" fill="#DDB273" {...line} />
          <rect x="40" y="54" width="16" height="18" rx="1" fill="#A87840" {...line} />
        </>
      );
    case "club":
      return (
        <>
          <rect x="16" y="34" width="64" height="38" fill="#3A2E46" {...line} />
          <rect x="12" y="28" width="72" height="8" rx="2" fill="#2E2438" {...line} />
          <circle cx="48" cy="18" r="9" fill="#B9BCD6" {...line} />
          {[-2, -1, 0, 1, 2].map((k) => (
            <path key={k} d={`M${48 + k * 3.4} 10 q${-k} 8 0 16`} fill="none" stroke="#8A8FB0" strokeWidth="0.9" />
          ))}
          <path d="M30 46 h36 M30 54 h24" stroke={LILAC} strokeWidth="3" strokeLinecap="round" />
          <rect x="40" y="56" width="16" height="16" rx="1.5" fill="#FF5FA8" {...line} />
        </>
      );
    default:
      // Corrugated metal, the traditional article.
      return (
        <>
          <path d="M12 70 L12 40 a36 26 0 0 1 72 0 L84 70 Z" fill="#B9C2C6" {...line} />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <path
              key={i}
              d={`M${20 + i * 9} 70 L${20 + i * 9} ${41 - Math.round((i - 3.5) ** 2 * 1.1)}`}
              stroke="#8E999E"
              strokeWidth="2"
              fill="none"
            />
          ))}
          <path d="M12 70 L12 40 a36 26 0 0 1 72 0 L84 70" fill="none" {...line} />
          <rect x="36" y="46" width="24" height="24" rx="2" fill="#5E4A42" {...line} />
          <rect x="8" y="68" width="80" height="6" rx="2" fill="#8A6A50" {...line} />
        </>
      );
  }
}

export function Hut({ kind, size = 72 }: { kind: HutKind; size?: number }) {
  return (
    <svg viewBox="0 0 96 80" width={size} height={(size * 80) / 96} className="block">
      <Shape kind={kind} />
    </svg>
  );
}

/**
 * Chain links laid along a line, each rotated to follow it.
 *
 * Every link is stroked twice — an ink pass under a steel one — because a
 * single grey stroke vanishes against a pale hut at hut size. Everything else
 * in the app is drawn with an outline; the chain shouldn't be the exception.
 */
function chain(sx: number, sy: number, cx: number, cy: number): ReactNode[] {
  const dx = cx - sx;
  const dy = cy - sy;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const links = Math.max(2, Math.round((length - 15) / 8.4));
  return Array.from({ length: links }, (_, i) => {
    const t = 2 + i * 8.4;
    const x = sx + ux * t;
    const y = sy + uy * t;
    const at = `rotate(${angle} ${x} ${y})`;
    return (
      <g key={i}>
        <ellipse cx={x} cy={y} rx="5" ry="3.4" fill="none" stroke={INK} strokeWidth="4.6" transform={at} />
        <ellipse cx={x} cy={y} rx="5" ry="3.4" fill="none" stroke="#C3C9D6" strokeWidth="2.2" transform={at} />
      </g>
    );
  });
}

/**
 * Two chains run in from either side of the hut and meet at a padlock hanging
 * over the middle of the door. Every hut is drawn with its door around
 * (48, 62), so one position serves all six.
 *
 * Nothing here is faded. Only the hut behind dims, so a locked sty reads as one
 * somebody chained shut rather than a picture somebody greyed out.
 */
export function ChainedLock({ size = 72 }: { size?: number }) {
  const doorX = 48;
  const doorY = 62;
  return (
    <svg
      viewBox="0 0 96 80"
      width={size}
      height={(size * 80) / 96}
      className="pointer-events-none absolute inset-0"
    >
      {chain(4, 42, doorX, doorY - 4)}
      {chain(92, 42, doorX, doorY - 4)}
      {/* Shackle first, so the body covers where it enters. */}
      <path
        d={`M${doorX - 7} ${doorY - 4}v-7a7 7 0 0 1 14 0v7`}
        fill="none"
        stroke={INK}
        strokeWidth="5.4"
        strokeLinecap="round"
      />
      <path
        d={`M${doorX - 7} ${doorY - 4}v-7a7 7 0 0 1 14 0v7`}
        fill="none"
        stroke="#C3C9D6"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <rect
        x={doorX - 13}
        y={doorY - 6}
        width="26"
        height="20"
        rx="4"
        fill={GOLD}
        stroke={INK}
        strokeWidth="2.8"
      />
      <circle cx={doorX} cy={doorY + 2} r="2.8" fill={INK} />
      <path d={`M${doorX} ${doorY + 4}v4`} stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

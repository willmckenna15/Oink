"use client";

/**
 * What a sty's pigs stand on — spec §6.6.
 *
 * Each ground is a floor first, with only enough scenery to place it: snow puts
 * mountains in a band at the very top, the beach puts sea along the bottom.
 * None of it may compete with the pigs, which are the point of the screen.
 *
 * The texture is a repeating tile living *inside* the panned layer, so it scales
 * with the zoom and never runs out however far you pull back — scenery placed as
 * fixed nodes ran past its own edge and left the field bare.
 *
 * The whole SVG is passed through encodeURIComponent rather than escaped by
 * hand: a raw `#` starts a fragment and truncates the data URI mid-attribute,
 * which fails silently — the element still paints, just with no image on it.
 */
import type { ReactNode } from "react";

export const GROUNDS = ["meadow", "beach", "snow", "lava", "desert", "club"] as const;
export type GroundKind = (typeof GROUNDS)[number];

export const GROUND_LABELS: Record<GroundKind, string> = {
  meadow: "flower meadow",
  beach: "beach",
  snow: "snow",
  lava: "lava",
  desert: "desert",
  club: "nightclub",
};

/** Deterministic, so a floor doesn't reshuffle between renders. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const PETALS: [number, number][] = [
  [15.0, 10.0], [11.55, 14.76], [5.95, 12.94], [5.95, 7.06], [11.55, 5.24],
];

const TILE = 340;

function tileFor(kind: GroundKind): string {
  const parts: string[] = [];
  const put = (s: string) => parts.push(s);

  for (let i = 0; i < 84; i++) {
    const h = hash(`${kind}-${i}`);
    const x = ((h % 1000) / 1000) * TILE;
    const y = (((h >> 10) % 1000) / 1000) * TILE;

    if (kind === "meadow") {
      if (i % 3 === 0) {
        const c = ["#E6D389", "#D8B5F7", "#F5BCC8", "#FFFDF6"][h % 4];
        put(PETALS.map(([px, py]) =>
          `<circle cx="${(x + px - 10).toFixed(1)}" cy="${(y + py - 10).toFixed(1)}" r="3.4" fill="${c}" stroke="#4D303F" stroke-width="1.4"/>`).join(""));
        put(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#CFA51F"/>`);
      } else {
        const r = ((h >> 20) % 24) - 12;
        put(`<g transform="rotate(${r} ${x.toFixed(1)} ${y.toFixed(1)})"><path d="M${(x - 4).toFixed(1)} ${(y + 5).toFixed(1)} Q${(x - 2.8).toFixed(1)} ${(y - 1).toFixed(1)} ${(x - 1).toFixed(1)} ${(y - 4).toFixed(1)} M${x.toFixed(1)} ${(y + 5).toFixed(1)} Q${(x + 0.4).toFixed(1)} ${(y - 1).toFixed(1)} ${(x + 1).toFixed(1)} ${(y - 4).toFixed(1)} M${(x + 4).toFixed(1)} ${(y + 5).toFixed(1)} Q${(x + 2.8).toFixed(1)} ${(y - 1).toFixed(1)} ${(x + 1).toFixed(1)} ${(y - 4).toFixed(1)}" fill="none" stroke="#7FA366" stroke-width="1.6" stroke-linecap="round"/></g>`);
      }
    } else if (kind === "beach") {
      if (i % 4 === 0) put(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="5" ry="3" fill="#D8BC8E" opacity=".7"/>`);
      else if (i % 4 === 1) put(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="#C9A87A" opacity=".6"/>`);
    } else if (kind === "snow") {
      // A few igloos, not a settlement — three to a tile. Big enough to read as
      // buildings the pigs stand between, and outlined like everything else.
      if (i % 28 === 5) {
        put(
          `<g transform="translate(${(x - 24).toFixed(1)} ${(y - 18).toFixed(1)})">` +
          `<ellipse cx="24" cy="35" rx="26" ry="5" fill="#C6D8E4" opacity=".7"/>` +
          `<path d="M0 34 a24 21 0 0 1 48 0 Z" fill="#FFFFFF" stroke="#4D303F" stroke-width="2.4"/>` +
          `<path d="M6 22 h36 M12 12 h24" fill="none" stroke="#CFE0EC" stroke-width="1.6"/>` +
          `<path d="M16 34 a8 9 0 0 1 16 0 Z" fill="#BBD2E0" stroke="#4D303F" stroke-width="2.4"/>` +
          `</g>`
        );
      } else if (i % 4 === 0) {
        put(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#FFFFFF" stroke="#CFE0EC" stroke-width="1.2"/>`);
      } else if (i % 4 === 2) {
        put(`<path d="M${(x - 4).toFixed(1)} ${y.toFixed(1)} h8 M${x.toFixed(1)} ${(y - 4).toFixed(1)} v8" stroke="#DCE9F2" stroke-width="1.4" stroke-linecap="round"/>`);
      }
    } else if (kind === "desert") {
      if (i % 5 === 0) put(`<path d="M${(x - 9).toFixed(1)} ${y.toFixed(1)} q9 -4 18 0" fill="none" stroke="#C9A16A" stroke-width="1.8"/>`);
    } else if (kind === "club") {
      // A table with a drink on it, seen from just above — a little round top,
      // a stem, and a glass catching the colour of whichever laser it's under.
      if (i % 26 === 7) {
        const drink = ["#39D6A0", "#FF5FA8", "#E6D389", "#D8B5F7"][h % 4];
        put(
          `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">` +
          `<ellipse cx="0" cy="6" rx="15" ry="5" fill="#1B1522" opacity=".55"/>` +
          `<rect x="-2" y="-4" width="4" height="10" fill="#3A2E46" stroke="#100C16" stroke-width="1.4"/>` +
          `<ellipse cx="0" cy="-5" rx="16" ry="6" fill="#4A3B58" stroke="#100C16" stroke-width="1.8"/>` +
          `<path d="M-4 -12 h8 l-2.4 6 h-3.2 Z" fill="${drink}" stroke="#100C16" stroke-width="1.4"/>` +
          `<path d="M-2 -6 v3 M-4 -3 h8" stroke="#100C16" stroke-width="1.4" stroke-linecap="round"/>` +
          `</g>`
        );
      } else if (i % 6 === 0) {
        put(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${["#39D6A0","#FF5FA8","#E6D389","#D8B5F7"][h % 4]}" opacity=".5"/>`);
      }
    }
  }

  // Lava is a brown floor with cracks of orange running *through* it — not a
  // lattice. A full grid of seams reads as crazy paving, so the cracks are
  // short runs along a jittered grid rather than every edge of it, and none of
  // them lies on the tile boundary, which would band the floor every 340px.
  if (kind === "lava") {
    const cols = 7;
    const rows = 7;
    const pt = (r: number, c: number): [number, number] => {
      // The outer ring keeps its position so the tile wraps; only the inside
      // wobbles.
      const h = hash(`lava-${r % rows}-${c % cols}`);
      const jx = c === 0 || c === cols ? 0 : ((h % 100) / 100) * 20 - 10;
      const jy = r === 0 || r === rows ? 0 : (((h >> 8) % 100) / 100) * 18 - 9;
      return [(c * TILE) / cols + jx, (r * TILE) / rows + jy];
    };
    const seg = (a: [number, number], b: [number, number]) =>
      `${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;

    /**
     * A crack is a short walk along the grid that may jog sideways as it goes,
     * so the runs don't meet at right angles and box the floor in. Purely
     * axis-aligned runs made rectangles, which read as paving again.
     */
    function walk(seed: string, r0: number, c0: number, down: boolean): string {
      const steps = 2 + (hash(seed) % 4);
      let r = r0;
      let c = c0;
      const p0 = pt(r, c);
      const d = [`M${p0[0].toFixed(1)} ${p0[1].toFixed(1)}`];
      for (let k = 0; k < steps; k++) {
        const h = hash(`${seed}-${k}`);
        if (down) {
          r += 1;
          if (h % 3 === 0 && c > 0) c -= 1;
          else if (h % 3 === 1 && c < cols) c += 1;
        } else {
          c += 1;
          if (h % 3 === 0 && r > 0) r -= 1;
          else if (h % 3 === 1 && r < rows) r += 1;
        }
        if (r < 0 || r > rows || c < 0 || c > cols) break;
        const q = pt(r, c);
        d.push(`L${q[0].toFixed(1)} ${q[1].toFixed(1)}`);
      }
      return d.join("");
    }

    const runs: { d: string; w: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const h = hash(`crackh-${i}`);
      runs.push({
        d: walk(`crackh-${i}`, 1 + (h % (rows - 2)), h % (cols - 3), false),
        w: 1.6 + ((h >> 5) % 4) * 0.5,
      });
    }
    for (let i = 0; i < 5; i++) {
      const h = hash(`crackv-${i}`);
      runs.push({
        d: walk(`crackv-${i}`, h % (rows - 3), 1 + (h % (cols - 2)), true),
        w: 1.6 + ((h >> 5) % 4) * 0.5,
      });
    }

    for (const { d, w } of runs) {
      // A wide dim pass under a narrow bright one: the rock either side of a
      // crack glows before the crack itself does.
      put(`<path d="${d}" fill="none" stroke="#E04A12" stroke-width="${(w * 2.6).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity=".3"/>`);
      put(`<path d="${d}" fill="none" stroke="#FF9A3C" stroke-width="${w.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }

    // Mottling, so the rock isn't a flat brown field between the cracks.
    for (let i = 0; i < 40; i++) {
      const h = hash(`rock-${i}`);
      const x = ((h % 1000) / 1000) * TILE;
      const y = (((h >> 10) % 1000) / 1000) * TILE;
      put(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${11 + (h % 9)}" ry="${7 + (h % 6)}" fill="#5A463D" opacity=".4"/>`);
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">` +
    parts.join("") +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const BASE: Record<GroundKind, string> = {
  meadow: "linear-gradient(#AECD8F, #8FB374)",
  beach: "linear-gradient(#F5E7CC, #E8CFA0)",
  snow: "linear-gradient(#F7FBFD, #E4EEF4)",
  lava: "linear-gradient(#4A3A33, #372A25)",
  desert: "linear-gradient(#F2D8A2, #D8A85E)",
  club: "linear-gradient(#2E2438, #241C2C)",
};

export type Ground = {
  /** Painted on the viewport, behind everything. */
  base: string;
  /** Repeating texture, inside the panned layer so it scales with the zoom. */
  tile: string;
  /** Scenery pinned to the viewport rather than the field — mountains stay at
   *  the top of the screen and the sea stays at the bottom, whatever the pan. */
  top?: ReactNode;
  bottom?: ReactNode;
  /** Dark floors need a light under each pig or a charcoal one disappears. */
  needsHalo: boolean;
};

export function ground(kind: GroundKind): Ground {
  const g: Ground = { base: BASE[kind], tile: tileFor(kind), needsHalo: kind === "lava" || kind === "club" };

  if (kind === "snow") {
    g.top = (
      <svg viewBox="0 0 400 52" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 h-[52px] w-full">
        <path d="M0 52 L52 8 L88 44 L132 4 L184 52 L236 16 L280 48 L332 10 L400 52 L400 0 L0 0 Z" fill="#9FB3C6" />
        <path d="M52 8 l9 12 -18 0 Z M132 4 l10 14 -20 0 Z M332 10 l9 12 -18 0 Z" fill="#FFFDF6" />
        <path d="M0 52 L52 8 L88 44 L132 4 L184 52 L236 16 L280 48 L332 10 L400 52" fill="none" stroke="#4D303F" strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "beach") {
    g.bottom = (
      <svg viewBox="0 0 400 60" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 h-[60px] w-full">
        <rect x="0" y="14" width="400" height="46" fill="#5FBFD8" />
        <path d="M0 14 q50 -8 100 0 t100 0 t100 0 t100 0" fill="none" stroke="#FFFDF6" strokeWidth="3.5" />
        <path d="M0 30 q50 -7 100 0 t100 0 t100 0 t100 0" fill="none" stroke="#FFFDF6" strokeWidth="2.4" opacity=".7" />
      </svg>
    );
  }
  if (kind === "club") {
    g.top = (
      <svg viewBox="0 0 400 90" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 h-[90px] w-full">
        <defs>
          {/* Each beam fades out along its length, so it reads as light rather
              than as a wedge with a shelf cut across the bottom. */}
          {[["#39D6A0", 0], ["#D8B5F7", 1], ["#FF5FA8", 2], ["#E6D389", 3]].map(([c, i]) => (
            <linearGradient key={i as number} id={`beam${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={c as string} stopOpacity="0.3" />
              <stop offset="1" stopColor={c as string} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[-150, -60, 40, 130].map((dx, i) => (
          <path key={i} d={`M200 34 L${200 + dx - 40} 90 L${200 + dx + 30} 90 Z`} fill={`url(#beam${i})`} />
        ))}
        <path d="M200 8 v10" stroke="#FFFDF6" strokeWidth="2.4" />
        <circle cx="200" cy="32" r="15" fill="#B9BCD6" stroke="#4D303F" strokeWidth="2.4" />
        <circle cx="194" cy="26" r="4" fill="#FFFDF6" opacity=".85" />
      </svg>
    );
  }
  if (kind === "desert") {
    g.top = (
      <svg viewBox="0 0 400 70" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 top-0 h-[70px] w-full">
        <circle cx="330" cy="26" r="20" fill="#CFA51F" opacity=".8" />
      </svg>
    );
  }
  return g;
}

/**
 * A ground as it appears in a picker: the real floor, texture and all, shrunk
 * into a chip. Flat base colours weren't enough to tell lava from nightclub —
 * both are simply dark until you can see what's drawn on them.
 */
export function GroundSwatch({ kind }: { kind: GroundKind }) {
  const g = ground(kind);
  return (
    <span
      className="block h-9 w-full overflow-hidden rounded border-2 border-ink"
      style={{ backgroundImage: `${g.tile}, ${g.base}`, backgroundSize: "150px, auto" }}
    />
  );
}

"use client";

/**
 * The user's avatar pig — spec §9.1.
 *
 * Reference style: warm brown outline (never black), blush cheeks, wide-set dot
 * eyes with a highlight, snub snout with nostrils, small upright ears, tiny
 * trotters. No tail — it read as a stray hair at avatar size.
 *
 * **Modelling, not just outline.** A flat fill inside a uniform stroke reads as
 * a die-cut sticker. Volume comes from three soft passes clipped inside each
 * form — a core shadow down the lower-right, a broad highlight on the upper
 * left, and a contact shadow where the head meets the body — all blurred, with
 * a thinner stroke so the line stops dominating. That's what makes it read as a
 * character rather than a decal.
 *
 * The avatar is deliberately **neutral**. It's an identity, not a mood; all the
 * expression lives in the reaction icons (ReactionPigs.tsx).
 *
 * Two variants:
 *   variant="face"  head only, for map pins and dense lists
 *   variant="full"  whole animal, used only on the feed and the profile
 *
 * The snout and its two nostrils are drawn at every size — the most
 * recognisably pig feature, and without them the avatar reads as a blob.
 */
import { Fragment, useId } from "react";
import Held from "@/components/pigs/Held";
import {
  PIG_BACKGROUNDS,
  SPECIES_COLORS,
  Species,
  PigConfig,
  TIER_SHAPE,
  fatnessTier,
  hidesEars,
  normalisePig,
} from "@/lib/pig";
import { costumeParts, faceItem } from "./Costume";
import { hairParts } from "./Hair";
import { companion, companionTransform } from "./Companion";

type Props = {
  config?: PigConfig | null;
  placesLogged?: number;
  /** Last logged place; the pig drops a tier per idle fortnight from here. */
  lastLoggedAt?: string | null;
  size?: number;
  variant?: "face" | "full";
  /** Drops the circular background — used inside map pins. */
  bare?: boolean;
  /** Puts a chef's knife in one trotter. The logo and the sign-in pig only. */
  /** Overrides the saved slot — the logo and sign-in pig use it. */
  holding?: string | null;
  className?: string;
};

const EYE = "#43262F";
const SPECIES_LABELS_ARIA: Record<Species, string> = { pig: "Pig", boar: "Boar", hog: "Hog" };
const STROKE = 2.1;

export default function PigAvatar({
  config,
  placesLogged = 0,
  lastLoggedAt = null,
  size = 44,
  variant = "face",
  bare = false,
  holding = null,
  className = "",
}: Props) {
  const uid = useId().replace(/:/g, "");
  const cfg = normalisePig(config);
  const species = cfg.species as Species;
  const p = SPECIES_COLORS[species][cfg.color];
  const OUTLINE = p.outline;
  const bg = PIG_BACKGROUNDS[cfg.background];
  const tier = fatnessTier(placesLogged, lastLoggedAt);
  // Starved out: her modelling is kept intact and simply drained of colour,
  // so a dead pig still reads as the same animal rather than a different one.
  const dead = tier === "dead";
  const shape = TIER_SHAPE[tier];
  // Washed out rather than greyed: the colour someone picked is still theirs,
  // just drained of life. Full greyscale threw the choice away entirely.
  const drained = dead
    ? { filter: "saturate(0.32) brightness(1.12)", opacity: 0.7 }
    : undefined;
  // Every pig has a soft blush already; the accessory turns it up, so picking
  // it reads as a decision rather than a barely-there tweak.
  const rosy = cfg.accessory === "blush";
  // Cap, beret, bucket, chef and the rest sit down over the ears; a party cone,
  // a crown and the flower crown perch between them and leave them showing.
  const earsHidden = hidesEars(cfg.hat);
  // Costume parts are drawn in normalised space and scaled about the body or
  // head centre; the garment shell comes off the real silhouette (below).
  const dress = costumeParts(cfg.costume, OUTLINE, p.mid);
  // Several at a time: specs, a moustache and a cigar sit on three different
  // parts of a face, so picking one shouldn't take the others off. Drawn in the
  // order they were chosen.
  const specs = cfg.face.length ? (
    <>
      {cfg.face.map((f) => (
        <Fragment key={f}>{faceItem(f, OUTLINE)}</Fragment>
      ))}
    </>
  ) : null;
  // Drawn in the same normalised head space as the costume headwear: the head
  // is an ellipse centred (65, 48), rx 27.5.
  const hair = hairParts(cfg.hair, cfg.hairColor, OUTLINE);
  // Drawn a size down from the head it sits on. At parity the styles with any
  // volume to them — the afro, the curls, anything long — stopped reading as
  // the pig's hair and started reading as a hat the pig was under.
  const HAIR_SCALE = 0.84;
  const faceHairT = `translate(60 62) scale(${1.2727 * HAIR_SCALE}) translate(-65 -48)`;
  const blushScale = rosy ? 1.35 : 1;
  const blushAlpha = rosy ? 0.82 : 0.5;

  const grad = `g-${uid}`;
  const blur = `b-${uid}`;
  const headClip = `hc-${uid}`;
  const bodyClip = `bc-${uid}`;
  const hairClip = `hp-${uid}`;
  const chestGrad = `cg-${uid}`;
  const bellyGrad = `bg-${uid}`;

  const defs = (
    <defs>
      <radialGradient id={grad} cx="34%" cy="24%" r="82%">
        <stop offset="0%" stopColor={p.light} />
        <stop offset="52%" stopColor={p.mid} />
        <stop offset="100%" stopColor={p.dark} />
      </radialGradient>
      <filter id={blur} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
  );

  if (variant === "face") {
    return (
      <svg width={size} height={size} viewBox="0 0 120 120" className={className} role="img" aria-label={SPECIES_LABELS_ARIA[species]}>
        {defs}
        <clipPath id={headClip}>
          <ellipse cx="60" cy="62" rx="35" ry="31" />
        </clipPath>

        {!bare && <circle cx="60" cy="60" r="60" fill={bg} />}

        {/* Cropped to the badge. The head fills most of a face avatar, so hair
            long enough to reach a full-body pig's shoulders would otherwise run
            off all four sides of a map pin. */}
        <clipPath id={hairClip}>
          <circle cx="60" cy="60" r="59" />
        </clipPath>
        {hair.back && (
          <g clipPath={`url(#${hairClip})`} transform={faceHairT}>
            {hair.back}
          </g>
        )}

        <g stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
          {!earsHidden && <Ears species={species} fill={p.ear} />}
          <ellipse cx="60" cy="62" rx="35" ry="31" fill={`url(#${grad})`} />
        </g>

        {/* Soft modelling, clipped inside the head */}
        <g clipPath={`url(#${headClip})`}>
          <ellipse cx="78" cy="86" rx="34" ry="26" fill={p.dark} opacity="0.5" filter={`url(#${blur})`} />
          <ellipse cx="42" cy="42" rx="22" ry="16" fill="#fff" opacity="0.34" filter={`url(#${blur})`} />
        </g>

        <ellipse cx="34" cy="69" rx={5.4 * blushScale} ry={3.4 * blushScale} fill={p.blush} opacity={blushAlpha} filter={`url(#${blur})`} />
        <ellipse cx="86" cy="69" rx={5.4 * blushScale} ry={3.4 * blushScale} fill={p.blush} opacity={blushAlpha} filter={`url(#${blur})`} />

        {/* Snout sits proud of the face — shadow above it, highlight on top */}
        <ellipse cx="60" cy="66" rx="14" ry="8" fill={p.dark} opacity="0.4" filter={`url(#${blur})`} />
        <ellipse cx="60" cy="71" rx="14" ry="10.5" fill={p.snout} stroke={OUTLINE} strokeWidth={STROKE} />
        <ellipse cx="57" cy="67" rx="7" ry="3" fill="#fff" opacity="0.28" filter={`url(#${blur})`} />

{dead ? (
          <g stroke={EYE} strokeWidth="2.4" strokeLinecap="round">
            <line x1={46 - 4} y1={55 - 4} x2={46 + 4} y2={55 + 4} />
            <line x1={46 + 4} y1={55 - 4} x2={46 - 4} y2={55 + 4} />
            <line x1={74 - 4} y1={55 - 4} x2={74 + 4} y2={55 + 4} />
            <line x1={74 + 4} y1={55 - 4} x2={74 - 4} y2={55 + 4} />
          </g>
        ) : (
          <>
            <ellipse cx="46" cy="55" rx="3.8" ry="4.6" fill={EYE} />
            <ellipse cx="74" cy="55" rx="3.8" ry="4.6" fill={EYE} />
            <circle cx="47.4" cy="53.4" r="1.4" fill="#fff" />
            <circle cx="75.4" cy="53.4" r="1.4" fill="#fff" />
          </>
        )}
        {/* nostrils — always drawn */}
        <ellipse cx="55" cy="71" rx="2.3" ry="3.2" fill={p.nostril} />
        <ellipse cx="65" cy="71" rx="2.3" ry="3.2" fill={p.nostril} />

        {specs && <g transform="translate(60 55) scale(1.27) translate(-65 -48)">{specs}</g>}
        {hair.front && (
          <g clipPath={`url(#${hairClip})`} transform={faceHairT}>
            {hair.front}
          </g>
        )}
        <Hat hat={cfg.hat} cx={60} topY={24} w={35} outline={OUTLINE} />
      </svg>
    );
  }

  // --- full body ---------------------------------------------------------
  const w = shape.waist;
  const headRx = shape.head;
  const headRy = headRx * 0.9;

  // Hunky is built, not ball-shaped: wide across the shoulders and drawn in
  // to the waist. Everything that hangs off the torso — the clip, the fill,
  // the arms, the legs — has to follow the same silhouette or the limbs end up
  // floating beside a shape that no longer reaches them.
  // There is no muscular tier any more — the top of the ladder is simply the
  // fattest pig. Held as a constant rather than ripped out, because the costume
  // geometry below is written around it and her work owns that.
  const lean = false;
  const topY = 82 - w * 0.9;
  const botY = 82 + w * 0.9;
  const hgt = botY - topY;
  const shoulder = lean ? w * 1.08 : w;   // half-width at the shoulders
  const waist = lean ? w * 0.64 : w;      // half-width at the hips
  const armX = shoulder;                  // arms hang off the shoulders
  const legX = lean ? waist * 0.72 : w * 0.55;

  // The lean torso is a function now, not a one-off string: a costume needs the
  // same silhouette at a smaller inset, and Hunky's drawn-in waist means an
  // ellipse-shaped garment would hang off a body that isn't there.
  const leanTorso = (sh: number, wa: number, ty: number, h: number) =>
    `M ${65 - sh} ${ty + h * 0.2}
     Q ${65 - sh} ${ty} ${65 - sh * 0.5} ${ty}
     L ${65 + sh * 0.5} ${ty}
     Q ${65 + sh} ${ty} ${65 + sh} ${ty + h * 0.2}
     C ${65 + sh} ${ty + h * 0.62} ${65 + wa} ${ty + h * 0.6} ${65 + wa} ${ty + h - h * 0.16}
     Q ${65 + wa} ${ty + h} ${65 + wa * 0.52} ${ty + h}
     L ${65 - wa * 0.52} ${ty + h}
     Q ${65 - wa} ${ty + h} ${65 - wa} ${ty + h - h * 0.16}
     C ${65 - wa} ${ty + h * 0.6} ${65 - sh} ${ty + h * 0.62} ${65 - sh} ${ty + h * 0.2} Z`;

  const torso = lean ? leanTorso(shoulder, waist, topY, hgt) : "";

  /** The garment shell: the body's own outline, pulled in so a rim of coat shows. */
  const Shell = ({ fill, k = 0.95 }: { fill: string; k?: number }) =>
    lean ? (
      <path
        d={leanTorso(shoulder * k, waist * k, 82 - (hgt / 2) * k, hgt * k)}
        fill={fill}
        stroke={OUTLINE}
        strokeWidth={STROKE}
        strokeLinejoin="round"
      />
    ) : (
      <ellipse cx={65} cy={82} rx={w * k} ry={w * 0.9 * k} fill={fill}
        stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round" />
    );

  // Interior detail stays in normalised space. X follows the shoulders so a
  // costume still reaches the edges on Hunky; Y follows the waist as before.
  const bodyT = `translate(65 82) scale(${(shoulder * 0.95) / 28.5} ${w / 30}) translate(-65 -82)`;
  const headT = `translate(65 48) scale(${headRx / 27.5}) translate(-65 -48)`;

  return (
    <svg
      width={size}
      height={(size * 134) / 130}
      viewBox="0 0 130 134"
      className={className}
      style={drained}
      role="img"
      aria-label={dead ? "Dead pig" : "Pig"}
    >
      {defs}
      <clipPath id={bodyClip}>
        {lean ? <path d={torso} /> : <ellipse cx="65" cy="82" rx={w} ry={w * 0.9} />}
      </clipPath>
      <clipPath id={headClip}>
        <ellipse cx="65" cy="48" rx={headRx} ry={headRy} />
      </clipPath>



      {/* ground shadow */}
      <ellipse cx="65" cy="122" rx={w * 0.8} ry="5" fill={p.dark} opacity="0.28" filter={`url(#${blur})`} />

      <g stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
        <rect x={65 - legX} y="100" width="14" height="19" rx="6.5" fill={p.snout} />
        <rect x={65 + legX - 14} y="100" width="14" height="19" rx="6.5" fill={p.snout} />
        {lean ? (
          <path d={torso} fill={`url(#${grad})`} />
        ) : (
          <ellipse cx="65" cy="82" rx={w} ry={w * 0.9} fill={`url(#${grad})`} />
        )}
      </g>

      {/* Body modelling */}
      <g clipPath={`url(#${bodyClip})`}>
        <ellipse cx={65 + w * 0.5} cy="104" rx={w * 1.1} ry={w * 0.7} fill={p.dark} opacity="0.48" filter={`url(#${blur})`} />
        <ellipse cx={65 - w * 0.4} cy="66" rx={w * 0.6} ry={w * 0.4} fill="#fff" opacity="0.3" filter={`url(#${blur})`} />
        {/* contact shadow cast by the head onto the body */}
        <ellipse cx="65" cy="62" rx={headRx * 0.95} ry="12" fill={p.dark} opacity="0.55" filter={`url(#${blur})`} />
      </g>

      {/* belly rolls — the fatness signal */}
      {Array.from({ length: shape.rolls }).map((_, i) => {
        const y = 86 + i * 13;
        const spread = w - 6 - i * 2;
        return (
          <path
            key={i}
            d={`M ${65 - spread} ${y} q ${spread} ${7 + i} ${spread * 2} 0`}
            fill="none"
            stroke={p.dark}
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.5"
          />
        );
      })}

      {/* Fat as volume rather than stripes: chest fat above, one big gut below,
          each lit from above and creased underneath so it hangs instead of
          floating. Clipped to the body so nothing escapes the silhouette. */}
      {(shape.moobs || shape.belly) && (
        <g clipPath={`url(#${bodyClip})`}>
          <defs>
            <linearGradient id={chestGrad} gradientUnits="userSpaceOnUse"
              x1="0" y1={82 - w * 0.6} x2="0" y2={82 + w * 0.02}>
              <stop offset="0%" stopColor="#fff" stopOpacity="0.26" />
              <stop offset="45%" stopColor="#fff" stopOpacity="0" />
              <stop offset="62%" stopColor={p.dark} stopOpacity="0" />
              <stop offset="100%" stopColor={p.dark} stopOpacity={0.34 + 0.34 * (shape.moobs ?? 0)} />
            </linearGradient>
            <linearGradient id={bellyGrad} gradientUnits="userSpaceOnUse"
              x1="0" y1={82 - w * 0.05} x2="0" y2={82 + w * 0.95}>
              <stop offset="0%" stopColor="#fff" stopOpacity={0.22 * (shape.belly ?? 0)} />
              <stop offset="34%" stopColor="#fff" stopOpacity="0" />
              <stop offset="56%" stopColor={p.dark} stopOpacity="0" />
              <stop offset="100%" stopColor={p.dark} stopOpacity={0.5 * (shape.belly ?? 0)} />
            </linearGradient>
          </defs>

          {!!shape.moobs &&
            [-1, 1].map((side) => (
              <ellipse
                key={side}
                cx={65 + side * w * 0.42}
                cy={82 - w * 0.3}
                rx={w * 0.5 * shape.moobs!}
                ry={w * 0.28 * shape.moobs!}
                fill={`url(#${chestGrad})`}
              />
            ))}

          {!!shape.belly && (
            <ellipse
              cx="65"
              cy={82 + w * 0.34}
              rx={w * 1.02}
              ry={w * 0.56 * (0.7 + shape.belly * 0.3)}
              fill={`url(#${bellyGrad})`}
            />
          )}
        </g>
      )}

      {dress.under && <g transform={bodyT}>{dress.under}</g>}
      {dress.shell && <Shell fill={dress.shell.fill} k={dress.shell.k} />}
      {dress.onBody && <g transform={bodyT}>{dress.onBody}</g>}

      {/* Arms sit ON TOP of the body edges in the darker ear tone, which is what
          makes them read as arms in front rather than limbs beside a ball.
          A sleeved costume recolours them, which is what stops a garment
          reading as a bib stuck on the front. */}
      <g stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
        {[-1, 1].map((side) => {
          // The wider the body, the further the arms are shoved off vertical: a
          // slim pig's hang straight down, a fat one's can't. Taken from the
          // waist so it scales with the tier rather than being set per tier.
          const splay = Math.max(0, (w - TIER_SHAPE.slim.waist) * 0.9);
          // Pivot is the shoulder, so a negative angle swings the hand away
          // from the body — which is what a belly does to the forearms. Hunky
          // goes the other way: the lats flare the shoulders and the forearms
          // come back in.
          const angle = (lean ? 1 : -1) * side * splay;
          const cx = 65 + side * (armX - 2.5);
          return (
            <g key={side} transform={`rotate(${angle} ${cx} 77)`}>
              <rect
                x={side < 0 ? 65 - armX - 4 : 65 + armX - 9}
                y="74"
                width="13"
                height="24"
                rx="6.5"
                fill={dress.sleeve ?? p.ear}
              />
              {dress.cuff && (
                <rect
                  x={side < 0 ? 65 - armX - 4 : 65 + armX - 9}
                  y="91"
                  width="13"
                  height="7"
                  rx="3.2"
                  fill={dress.cuff}
                />
              )}
            </g>
          );
        })}
      </g>

      {dress.overArms && <g transform={bodyT}>{dress.overArms}</g>}
      {dress.behindHead && <g transform={headT}>{dress.behindHead}</g>}

      {hair.back && <g transform={headT}>{hair.back}</g>}

      <g stroke={OUTLINE} strokeWidth={STROKE} strokeLinejoin="round">
        {!earsHidden && <BodyEars species={species} fill={p.ear} headRx={headRx} />}
        <ellipse cx="65" cy="48" rx={headRx} ry={headRy} fill={`url(#${grad})`} />
      </g>

      {/* Head modelling */}
      <g clipPath={`url(#${headClip})`}>
        <ellipse cx={65 + headRx * 0.5} cy="68" rx={headRx} ry={headRy * 0.8} fill={p.dark} opacity="0.48" filter={`url(#${blur})`} />
        <ellipse cx={65 - headRx * 0.42} cy="34" rx={headRx * 0.6} ry={headRy * 0.45} fill="#fff" opacity="0.32" filter={`url(#${blur})`} />
      </g>

      <ellipse cx={65 - headRx * 0.72} cy="56" rx={4.4 * blushScale} ry={2.8 * blushScale} fill={p.blush} opacity={blushAlpha} filter={`url(#${blur})`} />
      <ellipse cx={65 + headRx * 0.72} cy="56" rx={4.4 * blushScale} ry={2.8 * blushScale} fill={p.blush} opacity={blushAlpha} filter={`url(#${blur})`} />

      <ellipse cx="65" cy="53" rx="12" ry="6.5" fill={p.dark} opacity="0.38" filter={`url(#${blur})`} />
      <ellipse cx="65" cy="57" rx="12" ry="8.6" fill={p.snout} stroke={OUTLINE} strokeWidth={STROKE} />
      <Tusks species={species} outline={OUTLINE} cx={65} cy={57} scale={0.85} />
      <ellipse cx="62.5" cy="54" rx="6" ry="2.4" fill="#fff" opacity="0.26" filter={`url(#${blur})`} />

{dead ? (
        <g stroke={EYE} strokeWidth="2.4" strokeLinecap="round">
          <line x1={54 - 3.4} y1={44 - 3.4} x2={54 + 3.4} y2={44 + 3.4} />
          <line x1={54 + 3.4} y1={44 - 3.4} x2={54 - 3.4} y2={44 + 3.4} />
          <line x1={76 - 3.4} y1={44 - 3.4} x2={76 + 3.4} y2={44 + 3.4} />
          <line x1={76 + 3.4} y1={44 - 3.4} x2={76 - 3.4} y2={44 + 3.4} />
        </g>
      ) : (
        <>
          <ellipse cx="54" cy="44" rx="3.2" ry="3.9" fill={EYE} />
          <ellipse cx="76" cy="44" rx="3.2" ry="3.9" fill={EYE} />
          <circle cx="55.2" cy="42.6" r="1.2" fill="#fff" />
          <circle cx="77.2" cy="42.6" r="1.2" fill="#fff" />
        </>
      )}
      {/* nostrils — always drawn */}
      <ellipse cx="61" cy="57" rx="2" ry="2.8" fill={p.nostril} />
      <ellipse cx="69" cy="57" rx="2" ry="2.8" fill={p.nostril} />

      {/* A second chin is a fold, so it's drawn as the shadow one jaw casts on
          the next — never a lighter shape laid over the face, which reads as a
          panel stuck on rather than flesh. Clipped to the head so the soft edge
          can't bleed past the jawline. */}
      {shape.chin && (
        <g clipPath={`url(#${headClip})`}>
          <ellipse
            cx="65"
            cy={48 + headRy * 0.52}
            rx={headRx * 0.66}
            ry={headRy * 0.17}
            fill={p.dark}
            opacity="0.3"
            filter={`url(#${blur})`}
          />
          <ellipse
            cx="65"
            cy={48 + headRy * 0.78}
            rx={headRx * 0.5}
            ry={headRy * 0.16}
            fill="#fff"
            opacity="0.16"
            filter={`url(#${blur})`}
          />
        </g>
      )}


      {dress.headExtra && <g transform={headT}>{dress.headExtra}</g>}
      {specs && <g transform={headT}>{specs}</g>}
      {hair.front && <g transform={headT}>{hair.front}</g>}
      <Hat hat={cfg.hat} cx={65} topY={48 - headRy - 4} w={headRx} outline={OUTLINE} />
      {dress.front && <g transform={bodyT}>{dress.front}</g>}

      {/* Whatever they're holding, drawn last of all: in the trotter rather
          than behind it, and over every layer of costume — a lapel or a
          scabbard crossing in front of the thing being held is the one way to
          make it read as neither worn nor carried. Everything in Held is drawn
          below the chin for the same reason, since nothing crops it now.
          `holding` is the prop the logo and sign-in pig use; otherwise it comes
          from the saved avatar. */}
      {(holding ?? (cfg.held !== "none" ? cfg.held : null)) && (
        <Held item={(holding ?? cfg.held) as string} armX={armX} />
      )}

      {cfg.companion !== "none" && (
        <g transform={companionTransform(w)}>{companion(cfg.companion, uid, cfg.truffle)}</g>
      )}
    </svg>
  );
}

/** Two rounded lenses and a bridge, in her outline rather than a hard black. */
function Ears({ species, fill }: { species: Species; fill: string }) {
  if (species === "boar") {
    return (
      <>
        <path d="M31 40 L26 14 L49 28 Z" fill={fill} />
        <path d="M89 40 L94 14 L71 28 Z" fill={fill} />
      </>
    );
  }
  if (species === "hog") {
    return (
      <>
        <path d="M28 40 Q20 34 26 56 Q34 56 36 44 Z" fill={fill} />
        <path d="M92 40 Q100 34 94 56 Q86 56 84 44 Z" fill={fill} />
      </>
    );
  }
  return (
    <>
      <path d="M30 44 Q26 20 47 31 Z" fill={fill} />
      <path d="M90 44 Q94 20 73 31 Z" fill={fill} />
    </>
  );
}

function BodyEars({ species, fill, headRx }: { species: Species; fill: string; headRx: number }) {
  const l = 65 - headRx;
  const r = 65 + headRx;
  if (species === "boar") {
    return (
      <>
        <path d={`M ${l + 3} 40 L ${l - 2} 12 L ${l + 22} 26 Z`} fill={fill} />
        <path d={`M ${r - 3} 40 L ${r + 2} 12 L ${r - 22} 26 Z`} fill={fill} />
      </>
    );
  }
  if (species === "hog") {
    return (
      <>
        <path d={`M ${l + 2} 40 Q ${l - 7} 33 ${l} 58 Q ${l + 10} 58 ${l + 12} 45 Z`} fill={fill} />
        <path d={`M ${r - 2} 40 Q ${r + 7} 33 ${r} 58 Q ${r - 10} 58 ${r - 12} 45 Z`} fill={fill} />
      </>
    );
  }
  return (
    <>
      <path d={`M ${l + 3} 40 Q ${l - 3} 14 ${65 - 9} 27 Z`} fill={fill} />
      <path d={`M ${r - 3} 40 Q ${r + 3} 14 ${65 + 9} 27 Z`} fill={fill} />
    </>
  );
}

/** Boar tusks curve up from the snout; the hog's are smaller and lower. */
function Tusks({
  species,
  outline,
  cx = 60,
  cy = 71,
  scale = 1,
}: {
  species: Species;
  outline: string;
  cx?: number;
  cy?: number;
  scale?: number;
}) {
  if (species === "pig") return null;
  const s = scale;
  if (species === "boar") {
    return (
      <g stroke={outline} strokeWidth={2.2 * s} strokeLinejoin="round">
        <path d={`M ${cx - 15 * s} ${cy + 3 * s} q ${-3 * s} ${-12 * s} ${4 * s} ${-13 * s} q ${2 * s} ${7 * s} ${-1 * s} ${13 * s} Z`} fill="#F4EBD4" />
        <path d={`M ${cx + 15 * s} ${cy + 3 * s} q ${3 * s} ${-12 * s} ${-4 * s} ${-13 * s} q ${-2 * s} ${7 * s} ${1 * s} ${13 * s} Z`} fill="#F4EBD4" />
      </g>
    );
  }
  return (
    <g stroke={outline} strokeWidth={2 * s} strokeLinejoin="round">
      <path d={`M ${cx - 13 * s} ${cy + 8 * s} q ${-2 * s} ${-6 * s} ${2 * s} ${-7 * s} q ${1 * s} ${4 * s} ${0} ${7 * s} Z`} fill="#F4EBD4" />
      <path d={`M ${cx + 13 * s} ${cy + 8 * s} q ${2 * s} ${-6 * s} ${-2 * s} ${-7 * s} q ${-1 * s} ${4 * s} ${0} ${7 * s} Z`} fill="#F4EBD4" />
    </g>
  );
}

function Hat({ hat, cx, topY, w, outline }: { hat: string; cx: number; topY: number; w: number; outline: string }) {
  const s = { stroke: outline, strokeWidth: STROKE + 0.2, strokeLinejoin: "round" as const };
  switch (hat) {
    case "cap":
      return (
        <g {...s}>
          <path d={`M ${cx - w * 0.74} ${topY + 13} A ${w * 0.74} ${w * 0.68} 0 0 1 ${cx + w * 0.74} ${topY + 13} Z`} fill="#914E56" />
          <path d={`M ${cx + 2} ${topY + 13} L ${cx + w * 1.05} ${topY + 15} L ${cx + w * 1.05} ${topY + 10} L ${cx + 2} ${topY + 8} Z`} fill="#A9606A" />
        </g>
      );
    case "beret":
      // Tilted and off to one side — flat on the crown it reads as a helmet.
      return (
        <g {...s} transform={`rotate(-12 ${cx} ${topY + 10})`}>
          <ellipse cx={cx} cy={topY + 10} rx={w * 0.66} ry={w * 0.3} fill="#4D303F" />
          <circle cx={cx + w * 0.5} cy={topY + 4} r={w * 0.1} fill="#4D303F" />
        </g>
      );
    case "bucket":
      return (
        <g {...s}>
          <path d={`M ${cx - w * 0.6} ${topY + 13} L ${cx - w * 0.48} ${topY - 5} L ${cx + w * 0.48} ${topY - 5} L ${cx + w * 0.6} ${topY + 13} Z`} fill="#CFA51F" />
          <ellipse cx={cx} cy={topY + 14} rx={w * 0.92} ry={w * 0.17} fill="#B99118" />
        </g>
      );
    case "party":
      return (
        <g {...s}>
          <path d={`M ${cx} ${topY - 19} L ${cx + w * 0.44} ${topY + 13} L ${cx - w * 0.44} ${topY + 13} Z`} fill="#E6D389" />
          <circle cx={cx} cy={topY - 19} r={w * 0.13} fill="#914E56" />
        </g>
      );
    case "crown":
      return (
        <g {...s}>
          <path
            d={`M ${cx - w * 0.62} ${topY + 13} L ${cx - w * 0.62} ${topY - 5} L ${cx - w * 0.31} ${topY + 3}
                L ${cx} ${topY - 9} L ${cx + w * 0.31} ${topY + 3} L ${cx + w * 0.62} ${topY - 5}
                L ${cx + w * 0.62} ${topY + 13} Z`}
            fill="#CFA51F"
          />
          <circle cx={cx} cy={topY + 4} r={w * 0.09} fill="#914E56" stroke="none" />
        </g>
      );
    case "chef": {
      // A proper toque: a tall column that flares a little as it rises, gathered
      // into soft pleats across the top, over a stiff band. The old cloud of
      // three circles read as candyfloss at any size above a map pin.
      const bandY = topY + 5;
      // As tall as the head allows: the viewBox is fixed, so on a big head —
      // which sits higher — the crown is clamped rather than cropped.
      const h = Math.min(w * 0.95, bandY - 3);
      const bw = w * 0.42;             // half-width where it meets the band
      const tw = w * 0.54;             // half-width at the gathered top
      const capY = bandY - h;
      return (
        <g {...s}>
          <path
            d={`M ${cx - bw} ${bandY + 2}
                C ${cx - tw} ${bandY - h * 0.5} ${cx - tw} ${bandY - h * 0.62} ${cx - tw} ${capY + h * 0.14}
                Q ${cx - tw * 0.62} ${capY - h * 0.06} ${cx - tw * 0.3} ${capY + h * 0.08}
                Q ${cx} ${capY - h * 0.11} ${cx + tw * 0.3} ${capY + h * 0.08}
                Q ${cx + tw * 0.62} ${capY - h * 0.06} ${cx + tw} ${capY + h * 0.14}
                C ${cx + tw} ${bandY - h * 0.62} ${cx + tw} ${bandY - h * 0.5} ${cx + bw} ${bandY + 2} Z`}
            fill="#FFFDF6"
          />
          {/* Pleats — the vertical gathers that make it a toque and not a tube. */}
          <path
            d={`M ${cx - tw * 0.32} ${capY + h * 0.14} v ${h * 0.66}
                M ${cx + tw * 0.32} ${capY + h * 0.14} v ${h * 0.66}`}
            stroke={outline}
            strokeWidth="1.5"
            opacity="0.45"
            fill="none"
          />
          <rect x={cx - w * 0.5} y={bandY} width={w} height={w * 0.3} rx={w * 0.06} fill="#FFFDF6" />
        </g>
      );
    }
    case "tophat":
      // Tall crown, hard brim, and a band picked out in the gold so it doesn't
      // read as a solid black block at pin size.
      return (
        <g {...s}>
          <ellipse cx={cx} cy={topY + 13} rx={w * 0.95} ry={w * 0.17} fill="#3A2530" />
          <rect x={cx - w * 0.46} y={topY - 17} width={w * 0.92} height={w * 0.85} rx={w * 0.05} fill="#4D303F" />
          <rect x={cx - w * 0.46} y={topY + 2} width={w * 0.92} height={w * 0.16} fill="#CFA51F" stroke="none" />
        </g>
      );

    // --- costume headwear -------------------------------------------------
    // These are drawn against a nominal head radius of 27.5 and scaled to the
    // real one, so a slim pig's viking helmet doesn't swallow its face.
    default: {
      const k = w / 27.5;
      const inner = COSTUME_HATS[hat];
      if (!inner) return null;
      return (
        <g {...s} transform={`translate(${cx} ${topY + 4}) scale(${k}) translate(${-65} ${-24})`}>
          {inner}
        </g>
      );
    }
  }
}

/** Headwear drawn in normalised head space (centre 65, brim around y=30). */
const COSTUME_HATS: Record<string, React.ReactNode> = {
  bandana: (
    <>
      <path d="M40 30 q25 -14 50 0 q-25 10 -50 0 Z" fill="#A9503C" />
      <path d="M88 30 l12 6 -3 -9 Z" fill="#A9503C" />
    </>
  ),
  flowers: (
    <>
      {[0, 1, 2, 3, 4].map((i) => {
        const cols = ["#E6D389", "#D8B5F7", "#F5BCC8", "#A8DCC0", "#E6D389"];
        return (
          <g key={i} transform={`translate(${44 + i * 11} ${24 - Math.abs(i - 2) * 3})`}>
            {[0, 1, 2, 3, 4].map((a) => (
              <circle
                key={a}
                cx={4.5 * Math.cos(a * 1.2566)}
                cy={4.5 * Math.sin(a * 1.2566)}
                r="3.4"
                fill={cols[i]}
              />
            ))}
            <circle r="2.4" fill="#CFA51F" />
          </g>
        );
      })}
    </>
  ),
  beanie: (
    <>
      <path d="M40 32 q0 -22 25 -22 q25 0 25 22 Z" fill="#4E7FA8" />
      <rect x="38" y="27" width="54" height="8" rx="4" fill="#3E6A8E" />
      <circle cx="65" cy="9" r="5" fill="#FFFDF6" />
    </>
  ),
  pirate: (
    <>
      <path d="M36 30 q29 -16 58 0 q-29 8 -58 0 Z" fill="#4D303F" />
      <path d="M44 24 q21 -18 42 0 Z" fill="#4D303F" />
      <circle cx="65" cy="16" r="3" fill="#FFFDF6" stroke="none" />
      <path d="M60 21 l10 -6 M60 15 l10 6" stroke="#FFFDF6" strokeWidth="1.8" />
    </>
  ),
  sunhat: (
    <>
      <ellipse cx="65" cy="32" rx="36" ry="8" fill="#E6D389" />
      <path d="M48 30 q0 -18 17 -18 q17 0 17 18 Z" fill="#E6D389" />
      <path d="M48 26 q17 6 34 0" stroke="#914E56" strokeWidth="3.4" fill="none" />
    </>
  ),
  headphones: (
    <>
      <path d="M40 34 q0 -26 25 -26 q25 0 25 26" fill="none" stroke="#4D303F" strokeWidth="4" />
      <rect x="33" y="30" width="13" height="18" rx="5" fill="#39D6A0" />
      <rect x="84" y="30" width="13" height="18" rx="5" fill="#39D6A0" />
    </>
  ),
  viking: (
    <>
      <path d="M44 30 q21 -16 42 0 Z" fill="#9A9088" />
      <path d="M44 28 q-14 -6 -12 -20 q10 2 14 14 Z" fill="#FFFDF6" />
      <path d="M86 28 q14 -6 12 -20 q-10 2 -14 14 Z" fill="#FFFDF6" />
    </>
  ),
  flatcap: (
    <>
      <path d="M44 30 q21 -18 42 -2 Z" fill="#806B28" />
      <path d="M40 30 q22 6 46 -2 l4 4 q-25 8 -52 2 Z" fill="#806B28" />
    </>
  ),
  wizard: (
    <>
      <path d="M40 32 L65 -10 L90 32 Z" fill="#4A3E7A" />
      <ellipse cx="65" cy="32" rx="30" ry="6" fill="#3B3163" />
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${56 + i * 7} ${8 + i * 7} l1.6 4 4-1 -3 3 3 3 -4-1 -1.6 4 -1.6-4 -4 1 3-3 -3-3 4 1 Z`}
          fill="#E6D389"
          stroke="none"
        />
      ))}
    </>
  ),
  helmet: (
    <>
      <path d="M38 40 q0 -32 27 -32 q27 0 27 32 q-13 6 -27 6 q-14 0 -27 -6 Z" fill="#FFFDF6" />
      <path d="M40 34 q25 8 50 0" fill="none" opacity="0.5" />
      <rect x="60" y="4" width="10" height="8" rx="3" fill="#CFA51F" />
    </>
  ),
};

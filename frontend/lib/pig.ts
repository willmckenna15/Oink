/**
 * Pig system — spec §9.
 *
 * Two families, both drawn in the "Vinyl Toy" style: glossy gradient shading,
 * no outlines, upright bipedal stance.
 *  - the user avatar pig (customisable; gains belly rolls as you log places)
 *  - the price-tier pig (fixed set of four)
 *
 * Anatomy rule: every limb is drawn *before* the torso so the torso covers the
 * joint, and the head overlaps the torso top. Nothing floats, and the tail sits
 * on the lower back well clear of the arms.
 */

export type FatnessTier = "dead" | "slim" | "regular" | "chubby" | "fat" | "humungous";

export const FATNESS_TIERS: { tier: FatnessTier; min: number; label: string }[] = [
  { tier: "slim", min: 0, label: "Skinny" },
  { tier: "regular", min: 10, label: "Regular" },
  { tier: "chubby", min: 20, label: "Chubby" },
  { tier: "fat", min: 30, label: "Fat" },
  // No corner turned at the top — it just keeps going.
  { tier: "humungous", min: 40, label: "Humungous" },
];

/** Worst to best. Decay walks down this, and it bottoms out at the dead pig. */
export const TIER_ORDER: FatnessTier[] = ["dead", "slim", "regular", "chubby", "fat", "humungous"];

export const TIER_LABELS: Record<FatnessTier, string> = {
  dead: "Dead Pig",
  slim: "Skinny",
  regular: "Regular",
  chubby: "Chubby",
  fat: "Fat",
  humungous: "Humungous",
};

/** How long idleness costs a tier. A fortnight — long enough that a quiet
 *  couple of weeks isn't punished, short enough that the pig means something.
 *  Nothing is lost either way: a single log puts the whole ladder back. */
const DECAY_MS = 14 * 24 * 60 * 60 * 1000;

/** Tier from count alone, before any decay is applied. */
export function baseTier(placesLogged: number): FatnessTier {
  let current: FatnessTier = "slim";
  for (const t of FATNESS_TIERS) {
    if (placesLogged >= t.min) current = t.tier;
  }
  return current;
}

/** Whole decay periods elapsed since the last logged place. 0 if never. */
export function idlePeriods(lastLoggedAt?: string | null, now: number = Date.now()): number {
  if (!lastLoggedAt) return 0;
  const then = new Date(lastLoggedAt).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now - then) / DECAY_MS));
}

/**
 * The pig you actually get: earned tier, minus one step for every fortnight gone
 * by without logging anywhere, floored at the dead pig.
 *
 * Someone who has never logged anything doesn't rot — they start slim and stay
 * there until they log something, which is what starts the clock.
 */
export function fatnessTier(
  placesLogged: number,
  lastLoggedAt?: string | null,
  now: number = Date.now()
): FatnessTier {
  const index = TIER_ORDER.indexOf(baseTier(placesLogged));
  const decayed = index - idlePeriods(lastLoggedAt, now);
  return TIER_ORDER[Math.max(0, decayed)];
}

/** Days until the next tier is lost, or null when there's nothing left to lose. */
export function daysUntilDecay(
  placesLogged: number,
  lastLoggedAt?: string | null,
  now: number = Date.now()
): number | null {
  if (!lastLoggedAt) return null;
  if (fatnessTier(placesLogged, lastLoggedAt, now) === "dead") return null;
  const elapsed = now - new Date(lastLoggedAt).getTime();
  if (Number.isNaN(elapsed)) return null;
  return Math.max(0, Math.ceil((DECAY_MS - (elapsed % DECAY_MS)) / (24 * 60 * 60 * 1000)));
}

export function nextTier(placesLogged: number): { label: string; needed: number } | null {
  for (const t of FATNESS_TIERS) {
    if (placesLogged < t.min) return { label: t.label, needed: t.min - placesLogged };
  }
  return null;
}

/**
 * Per-tier build. `waist` is the torso half-width, `rolls` how many belly folds
 * are drawn, `head` the head radius. Fattening adds folds and pushes the arms
 * outward rather than just stretching the silhouette sideways.
 */
export type TierShape = {
  /** Half-width of the body ellipse — the whole silhouette hangs off this. */
  waist: number;
  /** Belly folds drawn as creases. Kept for the lean tiers only. */
  rolls: number;
  head: number;
  /** Chest fat, 0-1. Sits above the gut with a crease under it. */
  moobs?: number;
  /** Gut volume, 0-1. One big overhang rather than a ladder of stripes. */
  belly?: number;
  /** A second jaw under the first. */
  chin?: boolean;
};

export const TIER_SHAPE: Record<FatnessTier, TierShape> = {
  // Gaunt, and drawn drained of colour with X'd eyes (see PigAvatar).
  dead: { waist: 17, rolls: 0, head: 22 },
  slim: { waist: 20, rolls: 0, head: 24.5 },
  regular: { waist: 25, rolls: 1, head: 26, belly: 0.5 },
  chubby: { waist: 30, rolls: 0, head: 27.5, moobs: 0.68, belly: 0.8, chin: true },
  // Fat is volume, not stripes: chest and gut both full, and a second chin.
  fat: { waist: 35, rolls: 0, head: 29, moobs: 1.1, belly: 1, chin: true },
  // The end of the road: as wide as the frame takes, chest and gut both maxed,
  // and a head that's stopped keeping up with the body.
  humungous: { waist: 41, rolls: 0, head: 30, moobs: 1.35, belly: 1.3, chin: true },
};

// --- Avatar customisation (spec §9.1) -------------------------------------

export type PigPalette = {
  light: string;
  mid: string;
  dark: string;
  ear: string;
  snout: string;
  nostril: string;
  blush: string;
  /** Each coat carries its own line colour — one shared brown suited none of them. */
  outline: string;
};

/**
 * One shared set of coats, available to every species. Naturalistic browns and
 * greys sit alongside the playful ones, so a mint boar and a lilac hog are as
 * possible as a pink pig — the species is the silhouette, the coat is taste.
 */
export const COAT_COLORS: Record<string, PigPalette> = {
  pink:      { light: "#FCD8DF", mid: "#F5BCC8", dark: "#E3A2B0", ear: "#EFAAB8", snout: "#EDA0B0", nostril: "#8A5460", blush: "#F08FA6", outline: "#8A5460" },
  rose:      { light: "#FFC9C9", mid: "#F3A3A6", dark: "#DC8489", ear: "#EC9498", snout: "#EA9195", nostril: "#7A3E44", blush: "#F0808C", outline: "#8A4650" },
  peach:     { light: "#FFDCC2", mid: "#F7BE99", dark: "#E0A177", ear: "#F1AE86", snout: "#EFAB82", nostril: "#8A543A", blush: "#F09A76", outline: "#8A5A3C" },
  butter:    { light: "#FBEBBE", mid: "#F0D68F", dark: "#D8BB6A", ear: "#E6C97E", snout: "#E4C67A", nostril: "#8A6F26", blush: "#E0B57A", outline: "#8A7130" },
  mint:      { light: "#D3EEDA", mid: "#AEDCBB", dark: "#8CC29C", ear: "#9DD1AC", snout: "#9ACEA9", nostril: "#4A7A56", blush: "#A8CFA0", outline: "#4E7E5C" },
  seafoam:   { light: "#CFE9EC", mid: "#A6D3D9", dark: "#82B5BD", ear: "#93C4CB", snout: "#8FC1C8", nostril: "#3E6A70", blush: "#9CC8C2", outline: "#446E76" },
  lilac:     { light: "#E8D6FA", mid: "#CDB0EC", dark: "#B192D6", ear: "#C0A0E2", snout: "#BD9CE0", nostril: "#5B3E84", blush: "#C994D8", outline: "#63478C" },
  slate:     { light: "#DCDCE8", mid: "#BCBCD0", dark: "#9C9CB4", ear: "#ACACC2", snout: "#A8A8BE", nostril: "#4E4E66", blush: "#B79ACB", outline: "#565672" },
  sand:      { light: "#E8CDAE", mid: "#D3B08C", dark: "#B78F6B", ear: "#C39C77", snout: "#C09A76", nostril: "#6B4A34", blush: "#D0A98A", outline: "#6B4A34" },
  cocoa:     { light: "#E8C4AE", mid: "#D2A183", dark: "#B58165", ear: "#C79274", snout: "#C48E70", nostril: "#6E442F", blush: "#D08A6A", outline: "#6E4632" },
  ginger:    { light: "#D69A63", mid: "#BC7C48", dark: "#9C6236", ear: "#A96C3D", snout: "#9A6134", nostril: "#5A3418", blush: "#C68A55", outline: "#5E3A1E" },
  umber:     { light: "#9C7A5E", mid: "#7E6049", dark: "#5F4636", ear: "#6B513D", snout: "#54402F", nostril: "#241812", blush: "#8A6A50", outline: "#3E2C22" },
  charcoal:  { light: "#7C7A78", mid: "#605E5D", dark: "#464544", ear: "#514F4E", snout: "#403E3D", nostril: "#1C1B1B", blush: "#6E6A68", outline: "#2A2928" },
};

/** Kept as an alias so nothing downstream has to care about the rename. */
export const PIG_COLORS = COAT_COLORS;

export const PIG_BACKGROUNDS: Record<string, string> = {
  oat:    "#F4EEDC",
  gold:   "#F6EDC8",
  lemon:  "#E6D389",
  plum:   "#D9BAC0",
  lilac:  "#EFE2FF",
  cream:  "#FFFDF6",
};

/**
 * Avatar species. Pig is the default and nobody has to choose — but species is
 * the only avatar attribute still legible at 24px on a map pin, which is
 * exactly where telling friends apart matters.
 */
export const PIG_SPECIES = ["pig", "boar", "hog"] as const;
export type Species = (typeof PIG_SPECIES)[number];

export const SPECIES_LABELS: Record<Species, string> = {
  pig: "Pig",
  boar: "Boar",
  hog: "Hog",
};

/** Every species draws from the same coats; only the starting point differs. */
export const SPECIES_COLORS: Record<Species, Record<string, PigPalette>> = {
  pig: COAT_COLORS,
  boar: COAT_COLORS,
  hog: COAT_COLORS,
};

export const SPECIES_DEFAULT_COLOR: Record<Species, string> = {
  pig: "pink",
  boar: "umber",
  hog: "sand",
};

export const PIG_HATS = [
  "none", "cap", "beret", "bucket", "party", "crown", "chef",
  "bandana", "flowers", "beanie", "pirate", "sunhat", "headphones", "viking",
  "flatcap", "wizard", "helmet", "tophat",
] as const;

/**
 * Hats whose brim or crown sits down over the ears. Those ears are then not
 * drawn at all rather than poked through the hat — a cap with two ears sticking
 * out the sides of it reads as a mistake, not a style.
 *
 * The party cone, crown, bandana and flower crown perch on top instead, so they
 * leave the ears showing.
 */
export const EAR_COVERING_HATS = new Set([
  "cap", "beret", "bucket", "chef", "tophat", "beanie", "pirate",
  "sunhat", "viking", "helmet", "flatcap", "wizard", "headphones",
]);

export function hidesEars(hat: string | undefined): boolean {
  return !!hat && EAR_COVERING_HATS.has(hat);
}
export const PIG_ACCESSORIES = ["none", "blush", "sunglasses"] as const;

/**
 * Hair — its own slot, so it stacks with a hat rather than competing for the
 * head. Each style is drawn in two passes (behind the head and over it), which
 * is what stops long hair looking like a wig laid on the face.
 */
export const PIG_HAIR = [
  "none", "short", "long", "bob", "mohican",
  "afro", "curly", "braids", "locs", "bun", "ponytail", "buzz",
] as const;
export type Hair = (typeof PIG_HAIR)[number];

export const HAIR_LABELS: Record<string, string> = {
  none: "none",
  long: "long",
  short: "short",
  bob: "bob",
  mohican: "mohican",
  afro: "afro",
  curly: "curly",
  braids: "braids",
  locs: "locs",
  bun: "bun",
  ponytail: "ponytail",
  buzz: "buzz cut",
};

/** `mid` is the hair itself; `dark` shades the underside of it. */
export const HAIR_COLORS: Record<string, { mid: string; dark: string }> = {
  blonde: { mid: "#E7C46B", dark: "#C9A245" },
  platinum: { mid: "#EFE6CD", dark: "#D3C5A4" },
  ginger: { mid: "#C8642C", dark: "#A44C1E" },
  brown: { mid: "#7E4E2E", dark: "#5E381F" },
  black: { mid: "#332A33", dark: "#211B22" },
  silver: { mid: "#BDB6AE", dark: "#9A938B" },
  pink: { mid: "#E8709F", dark: "#C94E85" },
  blue: { mid: "#5B87AC", dark: "#43678A" },
  green: { mid: "#5E9A72", dark: "#457755" },
  lilac: { mid: "#B98FD6", dark: "#9770B4" },
};

/**
 * Costumes (spec §9.3). Club Penguin's memorable items were never garments, they
 * were characters — so three everyday tops sit alongside nine costumes.
 *
 * `hat` is the headwear each costume implies. Picking a costume fills an empty
 * hat slot with it but never overrides a hat already chosen: the slots stay
 * independent, and a viking helmet over a princess gown is a legitimate outcome.
 */
export const PIG_COSTUMES = [
  "none",
  "hoodie", "puffer", "dungarees",
  "princess", "pirate", "raver", "astronaut", "superhero", "ninja",
  "dinosaur", "rockstar", "chef",
  // Invitation only — see SUIT_WEARERS.
  "suit", "suitopen",
] as const;
export type Costume = (typeof PIG_COSTUMES)[number];

export const COSTUME_LABELS: Record<Costume, string> = {
  none: "none", hoodie: "hoodie", puffer: "puffer", dungarees: "dungarees",
  princess: "princess", pirate: "pirate", raver: "raver", astronaut: "astronaut",
  superhero: "superhero", ninja: "ninja", dinosaur: "dinosaur",
  rockstar: "rockstar", chef: "chef",
  // Both read as "suit" in the picker — nobody is offered a choice between
  // them, they just get the one that's theirs.
  suit: "suit", suitopen: "suit",
};

/**
 * The suit is not on general release. These four wear it; everyone else never
 * sees the option. Matched on the saved display name, folded and trimmed, so
 * capitalisation doesn't lock anyone out of their own suit.
 *
 * Sir Piggiam's is the open-necked one, which is why the value differs — the
 * costume he's offered *is* the unbuttoned shirt, rather than a variant he has
 * to go and find.
 */
const SUIT_WEARERS: Record<string, Costume> = {
  "look sharp": "suit",
  "princess ceo piggy": "suit",
  "glorious chairman oink": "suit",
  "sir piggiam": "suitopen",
};

/** Which suit this display name is entitled to, if any. */
export function suitFor(displayName?: string | null): Costume | null {
  return SUIT_WEARERS[(displayName ?? "").trim().toLowerCase()] ?? null;
}

/**
 * The costume list to *offer* someone. Everything already saved still draws —
 * this only gates the picker, so a suit can't be lost by someone else opening
 * their profile.
 */
export function costumesFor(displayName?: string | null): Costume[] {
  const suit = suitFor(displayName);
  return PIG_COSTUMES.filter((c) => (c === "suit" || c === "suitopen" ? c === suit : true));
}

/** The hat each costume suggests, applied only when the hat slot is empty. */
export const COSTUME_HAT: Partial<Record<Costume, string>> = {
  princess: "crown", pirate: "pirate", raver: "headphones", astronaut: "helmet",
  rockstar: "bandana", chef: "chef", dinosaur: "none",
};

/** Face items are their own slot so they stack with a hat. */
export const PIG_FACES = [
  "shades",
  "specs",
  "monocle",
  "eyepatch",
  "moustache",
  "cigar",
] as const;

/**
 * Companions (spec §9.4) — the puffle role, and deliberately just the one. A
 * menagerie of pets dilutes the joke; the truffle is the thing a pig is actually
 * hunting, so it carries the slot alone. Its varieties are the real ones, which
 * means the variety picker doubles as the companion picker.
 */
export const PIG_COMPANIONS = ["none", "truffle"] as const;

/** Things a pig can be brandishing. Its own slot, so it stacks with everything. */
export const PIG_HELD = [
  "none", "knife", "guitar", "sax", "trumpet", "briefcase", "pistol", "wine", "pint", "whisky",
  "coffee", "rollingpin", "pan", "baguette", "umbrella", "balloon",
  "bouquet", "camera", "trophy", "joint", "crackpipe", "bacon",
] as const;
export type Held = (typeof PIG_HELD)[number];

export const HELD_LABELS: Record<string, string> = {
  none: "nothing",
  knife: "knife",
  guitar: "guitar",
  sax: "saxophone",
  trumpet: "trumpet",
  briefcase: "briefcase",
  pistol: "pistol",
  wine: "wine glass",
  pint: "pint",
  whisky: "whisky",
  coffee: "coffee",
  rollingpin: "rolling pin",
  pan: "frying pan",
  baguette: "baguette",
  umbrella: "umbrella",
  balloon: "balloon",
  bouquet: "bouquet",
  camera: "camera",
  trophy: "trophy",
  joint: "joint",
  crackpipe: "crack pipe",
  bacon: "bacon",
};
export type Companion = (typeof PIG_COMPANIONS)[number];

export type TrufflePalette = {
  fill: string;
  dark: string;
  line: string;
  blush: string;
  /** The pentagonal warts. Separate from `dark` because on a pale coat the two
   *  are nearly the same value, and the warts turn to noise instead of reading
   *  as structure — they need a tone that stays dark whatever the fill is. */
  facet: string;
};

/** The four real ones. A white alba really is a different-looking object from a
 *  black périgord, so these carry more variety than four tints would. */
const REAL_TRUFFLES: Record<string, TrufflePalette> = {
  burgundy:  { fill: "#7E5B44", dark: "#5A3F2E", line: "#3A281E", blush: "#D4808C", facet: "#5A3F2E" },
  perigord:  { fill: "#4A3A30", dark: "#2B2019", line: "#191210", blush: "#B06A78", facet: "#2B2019" },
  alba:      { fill: "#E4D3AE", dark: "#C4AE83", line: "#7E6A48", blush: "#E08A94", facet: "#A08A5E" },
  summer:    { fill: "#9C7A4E", dark: "#75563A", line: "#4A3527", blush: "#D4808C", facet: "#75563A" },
};

/**
 * The coats double as truffle colours. Deriving them rather than hand-picking a
 * second palette means the two sets can't drift apart, and it makes the useful
 * case free: a truffle that matches your animal.
 */
const COAT_TRUFFLES: Record<string, TrufflePalette> = Object.fromEntries(
  Object.entries(COAT_COLORS).map(([name, c]) => [
    name,
    { fill: c.mid, dark: c.dark, line: c.outline, blush: c.blush, facet: c.outline },
  ])
);

/** Real varieties first, then the playful ones — naturalistic reads as the
 *  default and the fun colours as a departure from it. */
export const TRUFFLE_VARIETIES: Record<string, TrufflePalette> = {
  ...REAL_TRUFFLES,
  ...COAT_TRUFFLES,
};

/** Only the varieties whose key isn't already what a person should read. */
export const TRUFFLE_LABELS: Record<string, string> = {
  perigord: "black périgord",
  alba: "white alba",
};

export const truffleLabel = (name: string): string => TRUFFLE_LABELS[name] ?? name;

export type PigConfig = {
  species?: string;
  color?: string;
  hat?: string;
  accessory?: string;
  background?: string;
  costume?: string;
  /** Several at once. A lone string is still read, for configs saved before
   *  the slot took more than one. */
  face?: string | string[];
  companion?: string;
  truffle?: string;
  held?: string;
  hair?: string;
  hairColor?: string;
};

export const DEFAULT_PIG: NormalisedPig = {
  species: "pig",
  color: "pink",
  hat: "none",
  accessory: "none",
  background: "oat",
  costume: "none",
  face: [],
  companion: "none",
  truffle: "burgundy",
  held: "none",
  hair: "none",
  hairColor: "blonde",
};

/** A config with every slot filled in — face as the list it really is. */
export type NormalisedPig = Omit<Required<PigConfig>, "face"> & { face: string[] };

export function normalisePig(config: PigConfig | undefined | null): NormalisedPig {
  const c = config ?? {};
  const species = ((PIG_SPECIES as readonly string[]).includes(c.species ?? "")
    ? c.species
    : DEFAULT_PIG.species) as Species;
  // Coats are per-species, so switching animal falls back to that animal's
  // default rather than leaving an unrenderable colour behind.
  const coats = SPECIES_COLORS[species];
  return {
    species,
    color: c.color && coats[c.color] ? c.color : SPECIES_DEFAULT_COLOR[species],
    hat: c.hat ?? DEFAULT_PIG.hat,
    accessory: c.accessory ?? DEFAULT_PIG.accessory,
    background:
      c.background && PIG_BACKGROUNDS[c.background] ? c.background : DEFAULT_PIG.background,
    // Unknown slot values fall back rather than throwing, so a config saved by a
    // newer build still renders on an older one instead of blanking the avatar.
    costume: pick(c.costume, PIG_COSTUMES, DEFAULT_PIG.costume),
    face: faces(c.face),
    companion: pick(c.companion, PIG_COMPANIONS, DEFAULT_PIG.companion),
    held: pick(c.held, PIG_HELD, DEFAULT_PIG.held),
    hair: pick(c.hair, PIG_HAIR, DEFAULT_PIG.hair),
    hairColor: c.hairColor && HAIR_COLORS[c.hairColor] ? c.hairColor : DEFAULT_PIG.hairColor,
    truffle: c.truffle && TRUFFLE_VARIETIES[c.truffle] ? c.truffle : DEFAULT_PIG.truffle,
  };
}

function pick(value: string | undefined, allowed: readonly string[], fallback: string): string {
  return value && allowed.includes(value) ? value : fallback;
}

/**
 * The face slot, however it was saved. Older configs hold a single string and
 * used "none" to mean nothing, so both are read; anything unrecognised is
 * dropped rather than throwing, so a config written by a newer build still
 * renders on an older one instead of blanking the avatar.
 */
function faces(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const known = new Set<string>(PIG_FACES);
  return [...new Set(list.filter((f) => known.has(f)))];
}

// --- Price tiers (spec §9.2) ----------------------------------------------

export type Budget = "$" | "$$" | "$$$" | "$$$$";

export const BUDGETS: Budget[] = ["$", "$$", "$$$", "$$$$"];

/**
 * How a budget is written. The values themselves stay as dollars — they're the
 * stored column and a literal in the API — so this is the one place that turns
 * them into the currency people here actually spend.
 */
export const budgetSymbol = (budget: Budget): string => "\u00A3".repeat(budget.length);

export const BUDGET_LABELS: Record<Budget, string> = {
  $: "Peasant",
  $$: "Casual",
  $$$: "Smart",
  $$$$: "Posh",
};

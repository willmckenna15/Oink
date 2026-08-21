"use client";

/**
 * Profile — spec §6.5. Along with the feed, this is one of only two places
 * that show the full-body pig; everywhere else uses the face.
 */
import { Children, use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { PlaceSummary, User } from "@/lib/types";
import {
  TIER_LABELS,
  TIER_ORDER,
  baseTier,
  PIG_ACCESSORIES,
  PIG_BACKGROUNDS,
  PIG_HATS,
  PIG_HELD,
  HELD_LABELS,
  PIG_HAIR,
  HAIR_LABELS,
  HAIR_COLORS,
  daysUntilDecay,
  PIG_SPECIES,
  SPECIES_COLORS,
  SPECIES_DEFAULT_COLOR,
  costumesFor,
  PIG_FACES,
  COSTUME_LABELS,
  COSTUME_HAT,
  TRUFFLE_VARIETIES,
  truffleLabel,
  type Costume,
  SPECIES_LABELS,
  Species,
  fatnessTier,
  nextTier,
  normalisePig,
} from "@/lib/pig";
import PigAvatar from "@/components/pigs/PigAvatar";
import HowItWorks from "@/components/HowItWorks";
import PlaceListCard from "@/components/PlaceListCard";
import BottomTabBar, { TabBarSpacer } from "@/components/BottomTabBar";
import { EmptyState, PageHeader, Sheet, Spinner } from "@/components/ui";

export default function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [places, setPlaces] = useState<PlaceSummary[] | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // The place pending removal from this person's log, if any.
  const [unlogging, setUnlogging] = useState<PlaceSummary | null>(null);
  const [unlogBusy, setUnlogBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.user(username).then(setUser).catch((e) => setError(e.message));
    api.userPlaces(username).then(setPlaces).catch(() => setPlaces([]));
    api.me().then(setMe).catch(() => setMe(null));
  }, [username]);

  useEffect(load, [load]);

  if (error) return <EmptyState title="no such animal" body={error} />;
  if (!user) return <Spinner />;

  const isMe = me?.id === user.id;
  const tier = fatnessTier(user.places_logged, user.last_logged_at);
  const tierLabel = TIER_LABELS[tier];
  const next = nextTier(user.places_logged);
  const dead = tier === "dead";
  const decayDays = daysUntilDecay(user.places_logged, user.last_logged_at);
  // What the place count alone has earned, before any starving is applied.
  // Tiers are never actually lost — a single log restores the lot — so a
  // decayed pig must be told that, not handed the count-based target, which
  // reads as though the whole climb has to be done again.
  const earned = baseTier(user.places_logged);
  const hasDecayed = TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(earned);

  return (
    <>
      <PageHeader
        title={isMe ? "you" : user.display_name}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHelpOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-cream font-display text-sm font-extrabold italic"
              aria-label="how oink works"
              title="how oink works"
            >
              i
            </button>
            {isMe && (
              <button
                onClick={async () => {
                  await api.logout();
                  window.location.href = "/sign-in";
                }}
                className="btn bg-cream px-3 py-2 text-xs"
              >
                Sign out
              </button>
            )}
          </div>
        }
      />

      <main className="mx-auto max-w-[760px] space-y-4 px-3 pb-4">
        {/* Lemon is used on exactly two surfaces — here and empty states —
            where there's no photography for it to fight. */}
        <section className="flex flex-col items-center gap-2 rounded-card border-2 border-ink bg-lemon p-4">
          <PigAvatar
            config={user.pig_avatar_config}
            placesLogged={user.places_logged}
            lastLoggedAt={user.last_logged_at}
            size={120}
            variant="full"
          />
          <h2 className="text-2xl leading-tight">{user.display_name}</h2>
          <p className="micro">@{user.username}</p>

          <div className="rule-dashed my-1 w-3/5" />

          <div className="flex items-center gap-2">
            <span className="sticker bg-cream text-ink">
              {user.places_logged} {user.places_logged === 1 ? "place" : "places"}
            </span>
            {/* Being first to put somewhere on the map is its own thing — the
                feed hands the card to whoever writes the place up, so the
                credit for finding it lives here instead. */}
            {!!user.og_oinks && (
              <span className="sticker bg-lilac text-ink">
                {/* One inline run inside the flex sticker — separate children
                    would drop the spaces between them. OG stays uppercase: the
                    app speaks in lowercase, but an initialism read as a word
                    isn't lowercase, it's just wrong. */}
                <span>
                  {user.og_oinks} <span className="uppercase">og</span>{" "}
                  {user.og_oinks === 1 ? "oink" : "oinks"}
                </span>
              </span>
            )}
              <span className={`sticker ${dead ? "bg-ink-deep text-oat" : "bg-plum text-oat"}`}>
                {dead ? "dead pig" : `${tierLabel.toLowerCase()} pig`}
              </span>
            </div>

            {/* What the group made of the places this person found. Its own row
                under the counts, because it isn't one: the two above are things
                you did, these two are things that were done back. */}
            <div className="flex items-center gap-2">
              <span className="sticker bg-gold text-ink">
                {user.og_oinks_received ?? 0}{" "}
                {(user.og_oinks_received ?? 0) === 1 ? "oink" : "oinks"} received
              </span>
              <span className="sticker bg-rust text-oat">
                {user.og_shames_received ?? 0}{" "}
                {(user.og_shames_received ?? 0) === 1 ? "shame" : "shames"} received
              </span>
            </div>

            {/* A dead pig needs the way out spelled out; a live one needs to know
                what it's about to lose, which the place count alone never says. */}
            {dead ? (
              <p className="text-center text-xs font-bold text-ink-soft">
                feed to revive — log anywhere and {isMe ? "your" : "their"} pig comes straight back.
            </p>
          ) : (
            <>
              {hasDecayed ? (
                <p className="text-center text-xs font-bold text-ink-soft">
                  gone quiet. log anywhere and {isMe ? "you're" : "they're"} straight back to{" "}
                  {TIER_LABELS[earned].toLowerCase()} — nothing has to be earned twice.
                </p>
              ) : (
                next && (
                  <p className="text-center text-xs text-ink-soft">
                    {next.needed} more {next.needed === 1 ? "place" : "places"} until you're a{" "}
                    {next.label.toLowerCase()} pig.
                  </p>
                )
              )}
              {decayDays !== null && decayDays <= 3 && (
                <p className="text-center text-xs font-bold text-rust">
                  {decayDays === 0
                    ? "losing a tier today — log somewhere."
                    : `drops a tier in ${decayDays} ${decayDays === 1 ? "day" : "days"}.`}
                </p>
              )}
            </>
          )}

          {isMe && (
            <div className="flex w-full gap-2 pt-2">
              <button onClick={() => setEditOpen(true)} className="btn-primary flex-1 text-sm">
                Customise
              </button>
              <Link href="/profile/me/wishlist" className="btn-plain flex-1 text-center text-sm">
                Wishlist
              </Link>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="px-1 text-lg">
            {isMe ? "places you've logged" : `${user.display_name}'s places`}
          </h3>
          {!places && <Spinner label="loading…" />}
          {places?.length === 0 && (
            <EmptyState
              title="nothing logged yet"
              body={isMe ? "go find somewhere on discover" : undefined}
            />
          )}
          {places?.map((p) => (
            <PlaceListCard
              key={p.id}
              place={p}
              action={
                isMe ? (
                  <button
                    onClick={(e) => {
                      // The whole card is a link to the place; removing it isn't
                      // visiting it.
                      e.preventDefault();
                      e.stopPropagation();
                      setUnlogging(p);
                    }}
                    className="-my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-cream text-xs font-bold"
                    aria-label={`remove ${p.name} from your log`}
                    title="remove from your log"
                  >
                    ✕
                  </button>
                ) : undefined
              }
            />
          ))}
        </section>
      </main>

      <TabBarSpacer />
      <BottomTabBar />

      {isMe && (
        <PigCustomiser
          open={editOpen}
          onClose={() => setEditOpen(false)}
          user={user}
          onSaved={(updated) => {
            setUser(updated);
            setEditOpen(false);
          }}
        />
      )}

      <Sheet
        open={!!unlogging}
        onClose={() => setUnlogging(null)}
        title="remove from your log?"
      >
        <div className="space-y-3 pb-4">
          <p className="text-sm text-ink-soft">
            Your oink, write-up and shame for <strong className="text-ink">{unlogging?.name}</strong>{" "}
            all go. The place stays on the map — other people may have logged it.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setUnlogging(null)} className="btn-plain flex-1" disabled={unlogBusy}>
              Keep it
            </button>
            <button
              className="btn flex-1 bg-rust text-oat"
              disabled={unlogBusy}
              onClick={async () => {
                if (!unlogging) return;
                setUnlogBusy(true);
                try {
                  await api.unlog(unlogging.id);
                  const [refreshedUser, refreshedPlaces] = await Promise.all([
                    api.user(username),
                    api.userPlaces(username),
                  ]);
                  setUser(refreshedUser);
                  setPlaces(refreshedPlaces);
                  setUnlogging(null);
                } finally {
                  setUnlogBusy(false);
                }
              }}
            >
              {unlogBusy ? "removing…" : "remove"}
            </button>
          </div>
        </div>
      </Sheet>

      <HowItWorks open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

function PigCustomiser({
  open,
  onClose,
  user,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
  onSaved: (u: User) => void;
}) {
  const [cfg, setCfg] = useState(normalisePig(user.pig_avatar_config));
  const [displayName, setDisplayName] = useState(user.display_name);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCfg(normalisePig(user.pig_avatar_config));
      setDisplayName(user.display_name);
    }
  }, [open, user]);

  async function save() {
    setSaving(true);
    try {
      onSaved(
        await api.updateMe({
          display_name: displayName.trim() || user.display_name,
          pig_avatar_config: cfg,
        })
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="your animal">
      <div className="space-y-4 pb-4">
        {/* The pig stays put and the controls move under it. Stacked
            vertically, every choice past the first two was made blind — you
            scrolled the thing you were dressing off the screen to reach the
            control that dressed it. */}
        <div className="sticky top-0 z-10 flex justify-center bg-oat pb-1">
          <PigAvatar
            config={cfg}
            placesLogged={user.places_logged}
            lastLoggedAt={user.last_logged_at}
            size={130}
            variant="full"
          />
        </div>

        <label className="block">
          <span className="font-display text-sm font-bold">display name</span>
          <input className="field mt-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>

        <Pages>
        <section>
          <p className="mb-1.5 font-display text-sm font-bold">animal</p>
          <div className="flex gap-2">
            {PIG_SPECIES.map((sp) => (
              <button
                key={sp}
                onClick={() =>
                  // Coats are per-species, so carry the colour over only if the
                  // new animal has it; otherwise take its default.
                  setCfg({
                    ...cfg,
                    species: sp,
                    color: SPECIES_COLORS[sp as Species][cfg.color]
                      ? cfg.color
                      : SPECIES_DEFAULT_COLOR[sp as Species],
                  })
                }
                className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border-2 border-ink p-2 ${
                  cfg.species === sp ? "bg-plum text-oat" : "bg-cream text-ink"
                }`}
              >
                <PigAvatar config={{ ...cfg, species: sp }} placesLogged={user.places_logged} size={46} variant="full" />
                <span className="micro" style={{ color: cfg.species === sp ? "#F4EEDC" : undefined }}>
                  {SPECIES_LABELS[sp as Species]}
                </span>
              </button>
            ))}
          </div>
          <p className="micro mt-1.5">pig by default — boar and hog are opt-in</p>
        </section>

        <Picker
          label="coat"
          options={Object.keys(SPECIES_COLORS[cfg.species as Species])}
          value={cfg.color}
          onChange={(v) => setCfg({ ...cfg, color: v })}
          swatch={(v) => SPECIES_COLORS[cfg.species as Species][v].mid}
        />
        <Picker
          label="hair"
          options={[...PIG_HAIR]}
          value={cfg.hair}
          onChange={(v) => setCfg({ ...cfg, hair: v })}
          format={(v) => HAIR_LABELS[v] ?? v}
        />
        <Picker
          label="hair colour"
          options={Object.keys(HAIR_COLORS)}
          value={cfg.hairColor}
          onChange={(v) => setCfg({ ...cfg, hairColor: v })}
          swatch={(v) => HAIR_COLORS[v].mid}
        />
        <Picker
          label="costume"
          // Off the saved name rather than the field above it, so the suit
          // can't be unlocked by typing someone else's name into the box.
          options={costumesFor(user.display_name)}
          value={cfg.costume}
          onChange={(v) =>
            setCfg({
              ...cfg,
              costume: v,
              // A costume fills an empty hat slot with the one it implies, but
              // never overrides a hat already chosen — the slots stay
              // independent, so a viking helmet on a princess gown is allowed.
              hat: cfg.hat === "none" ? COSTUME_HAT[v as Costume] ?? "none" : cfg.hat,
            })
          }
          format={(v) => COSTUME_LABELS[v as Costume]}
        />
        {/* The one slot you can wear several of at once — specs, a moustache
            and a cigar are three different parts of a face. */}
        <MultiPicker
          label="face"
          hint="pick as many as you like"
          options={[...PIG_FACES]}
          value={cfg.face}
          onChange={(v) => setCfg({ ...cfg, face: v })}
        />
        {/* The truffle is the only companion, so its varieties and the on/off
            choice are one control rather than two stacked pickers. */}
        <Picker
          label="truffle"
          options={["none", ...Object.keys(TRUFFLE_VARIETIES)]}
          value={cfg.companion === "truffle" ? cfg.truffle : "none"}
          onChange={(v) =>
            setCfg(
              v === "none"
                ? { ...cfg, companion: "none" }
                : { ...cfg, companion: "truffle", truffle: v }
            )
          }
          swatch={(v) => (v === "none" ? "transparent" : TRUFFLE_VARIETIES[v].fill)}
          format={(v) => (v === "none" ? "none" : truffleLabel(v))}
        />

        <Picker
          label="holding"
          options={[...PIG_HELD]}
          value={cfg.held}
          onChange={(v) => setCfg({ ...cfg, held: v })}
          format={(v) => HELD_LABELS[v] ?? v}
        />
        <Picker
          label="background"
          options={Object.keys(PIG_BACKGROUNDS)}
          value={cfg.background}
          onChange={(v) => setCfg({ ...cfg, background: v })}
          swatch={(v) => PIG_BACKGROUNDS[v]}
        />
        <Picker
          label="hat"
          options={[...PIG_HATS]}
          value={cfg.hat}
          onChange={(v) => setCfg({ ...cfg, hat: v })}
          format={(v) => (v === "tophat" ? "top hat" : v)}
        />
        <Picker
          label="accessory"
          options={[...PIG_ACCESSORIES]}
          value={cfg.accessory}
          onChange={(v) => setCfg({ ...cfg, accessory: v })}
        />
        </Pages>

        <button onClick={save} className="btn-primary w-full text-lg" disabled={saving}>
          {saving ? "saving…" : "save pig"}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The customiser's controls, paged sideways two at a time.
 *
 * The pig is pinned above this, so whatever you're changing is always in
 * shot — which it wasn't when the controls were a single tall column and
 * everything past the second one was chosen blind.
 */
function Pages({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children);
  const groups: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += 2) groups.push(items.slice(i, i + 2));
  const [at, setAt] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  return (
    <div>
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / (el.clientWidth || 1)));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {groups.map((group, i) => (
          <div key={i} className="w-full shrink-0 snap-center space-y-4 pb-1">
            {group}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-center gap-1.5">
        {groups.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`page ${i + 1} of ${groups.length}`}
            onClick={() => {
              const el = track.current;
              if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
            }}
            className={`h-1.5 rounded-full transition-all ${
              i === at ? "w-5 bg-plum" : "w-1.5 bg-ink/25"
            }`}
          />
        ))}
      </div>
      <p className="micro mt-1 text-center">swipe for more</p>
    </div>
  );
}

/**
 * A Picker that keeps a set rather than a single choice. Tapping a chosen item
 * takes it off again, and `none` is the empty set rather than an option of its
 * own — an explicit "none" chip in a multi-select is a thing you can tick
 * alongside the others, which reads as a contradiction.
 */
function MultiPicker({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);

  return (
    <section>
      <p className="mb-1.5 font-display text-sm font-bold">
        {label}
        {hint && <span className="micro ml-1.5 font-normal">{hint}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onChange([])}
          className={`tag lowercase ${value.length === 0 ? "bg-plum text-oat" : ""}`}
        >
          none
        </button>
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            aria-pressed={value.includes(opt)}
            className={`tag lowercase ${value.includes(opt) ? "bg-plum text-oat" : ""}`}
          >
            {opt}
          </button>
        ))}
      </div>
    </section>
  );
}

function Picker({
  label,
  options,
  value,
  onChange,
  swatch,
  format,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  swatch?: (v: string) => string;
  /** For values whose raw key isn't what a person should read. */
  format?: (v: string) => string;
}) {
  return (
    <section>
      <p className="mb-1.5 font-display text-sm font-bold">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`tag lowercase ${value === opt ? "bg-plum text-oat" : ""}`}
          >
            {swatch && (
              <span
                className="inline-block h-3.5 w-3.5 rounded-full"
                style={{ background: swatch(opt) }}
              />
            )}
            {format ? format(opt) : opt}
          </button>
        ))}
      </div>
    </section>
  );
}

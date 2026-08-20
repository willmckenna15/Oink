"use client";

/**
 * Making a sty — spec §6.6.
 *
 * Anyone can start one, and whoever starts it is its first admin. Pigs are
 * added outright rather than invited: this is a closed friend group, and an
 * invite queue between friends is ceremony nobody asked for. Getting in from
 * the *outside* is what needs approval, which is the join request.
 */
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { StyDetail, User } from "@/lib/types";
import PigAvatar from "@/components/pigs/PigAvatar";
import { Sheet } from "@/components/ui";
import { HUTS, HUT_LABELS, Hut } from "@/components/pigs/Huts";
import { GROUNDS, GROUND_LABELS, GroundSwatch } from "@/components/pigs/Grounds";

export default function NewStySheet({
  open,
  onClose,
  onMade,
}: {
  open: boolean;
  onClose: () => void;
  onMade: (sty: StyDetail) => void;
}) {
  const [name, setName] = useState("");
  const [hut, setHut] = useState<string>("meadow");
  const [floor, setFloor] = useState<string>("meadow");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pigs, setPigs] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api.users().then(setPigs).catch(() => {});
  }, [open]);

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function make() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const sty = await api.createSty({
        name: name.trim(),
        hut,
        ground: floor,
        member_ids: [...picked],
      });
      setName("");
      setPicked(new Set());
      onMade(sty);
    } catch (e) {
      setError(e instanceof Error ? e.message : "that didn't work");
    } finally {
      setBusy(false);
    }
  }

  const needle = q.trim().toLowerCase();
  const shown = pigs.filter(
    (p) =>
      !needle ||
      p.display_name.toLowerCase().includes(needle) ||
      p.username.toLowerCase().includes(needle)
  );

  return (
    <Sheet open={open} onClose={onClose} title="a new sty">
      <div className="grid gap-4 pb-2">
        <label className="grid gap-1">
          <span className="micro">what it's called</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
            placeholder="the sunday roast club" className="field w-full text-sm" />
        </label>

        <section className="grid gap-1.5">
          <span className="micro">the hut, on the farm</span>
          <div className="grid grid-cols-3 gap-1.5">
            {HUTS.map((h) => (
              <button key={h} type="button" onClick={() => setHut(h)}
                className={`grid justify-items-center gap-0.5 rounded-card border-2 p-1.5 ${
                  hut === h ? "border-plum bg-cream" : "border-ink bg-oat"}`}>
                <Hut kind={h} size={52} />
                <span className="micro">{HUT_LABELS[h]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-1.5">
          <span className="micro">the ground, inside</span>
          <div className="grid grid-cols-3 gap-1.5">
            {GROUNDS.map((g) => (
              <button key={g} type="button" onClick={() => setFloor(g)}
                className={`grid justify-items-center gap-1 rounded-card border-2 p-1.5 ${
                  floor === g ? "border-plum bg-cream" : "border-ink bg-oat"}`}>
                <GroundSwatch kind={g} />
                <span className="micro">{GROUND_LABELS[g]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="grid gap-1.5">
          <span className="micro">who's in it {picked.size > 0 && `· ${picked.size} picked`}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="find a pig…"
            className="field w-full text-sm" aria-label="find a pig" />
          <div className="max-h-56 overflow-y-auto rounded-card border-2 border-ink">
            {shown.map((p) => (
              <button key={p.id} type="button" onClick={() => toggle(p.id)}
                className="flex w-full items-center gap-2 border-b-2 border-oat-deep px-2 py-1.5 last:border-b-0">
                <PigAvatar config={p.pig_avatar_config} placesLogged={p.places_logged}
                  lastLoggedAt={p.last_logged_at} size={28} variant="face" />
                <span className="min-w-0 flex-1 truncate text-left text-sm">{p.display_name}</span>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-ink text-[11px] ${
                  picked.has(p.id) ? "bg-plum text-oat" : "bg-oat"}`}>
                  {picked.has(p.id) ? "✓" : ""}
                </span>
              </button>
            ))}
          </div>
        </section>

        {error && <p className="micro text-plum">{error}</p>}

        <button onClick={make} disabled={busy || !name.trim()} className="btn-primary w-full disabled:opacity-50">
          {busy ? "building…" : "build it"}
        </button>
      </div>
    </Sheet>
  );
}

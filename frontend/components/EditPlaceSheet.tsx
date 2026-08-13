"use client";

/**
 * Editing a place you added.
 *
 * Everything the add-place form collects about the place itself is editable
 * here: what it's called, what kind of thing it is, its subtypes, how pricey,
 * and where to find it. Details get typed in a hurry the first time — usually
 * standing outside the place — and until now none of it could be corrected.
 *
 * What isn't here is the pin and Google's id for it. Those are the two halves
 * of the same fact, and that id is the whole of how duplicates are prevented:
 * two people adding the same restaurant bring the same id, and the second lands
 * on the first's entry. Letting it be edited would be letting the guarantee be
 * edited.
 *
 * Only the person who added the place ever sees this, and the API refuses
 * anyone else regardless — the button is a courtesy, not the rule.
 */
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Kind, PlaceDetail } from "@/lib/types";
import { BUDGETS, Budget } from "@/lib/pig";
import { BudgetTag } from "@/components/pigs/PricePig";
import CategoryPicker from "@/components/CategoryPicker";
import { ErrorNote, KIND_LABELS, Sheet } from "@/components/ui";

export default function EditPlaceSheet({
  open,
  onClose,
  place,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  place: PlaceDetail;
  onSaved: (updated: PlaceDetail) => void;
}) {
  const [name, setName] = useState(place.name);
  const [kind, setKind] = useState<Kind>(place.kind);
  const [category, setCategory] = useState<string[]>(place.category);
  const [budget, setBudget] = useState<Budget>(place.budget);
  const [address, setAddress] = useState(place.address ?? "");
  const [city, setCity] = useState(place.city ?? "");
  const [area, setArea] = useState(place.area ?? "");
  const [postcode, setPostcode] = useState(place.postcode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed each time it opens, so cancelling really does discard.
  useEffect(() => {
    if (!open) return;
    setName(place.name);
    setKind(place.kind);
    setCategory(place.category);
    setBudget(place.budget);
    setAddress(place.address ?? "");
    setCity(place.city ?? "");
    setArea(place.area ?? "");
    setPostcode(place.postcode ?? "");
    setError(null);
  }, [open, place]);

  async function save() {
    if (!name.trim()) {
      setError("It needs a name.");
      return;
    }
    // Same rule as adding: the subtype is what the map filters on, so a place
    // can't be edited into having none.
    if (!category.length) {
      setError(kind === "bar" ? "Pick at least one type of bar." : "Pick at least one cuisine.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await api.updatePlace(place.id, {
          name: name.trim(),
          kind,
          category,
          budget,
          address: address.trim() || null,
          city: city.trim() || null,
          area: area.trim() || null,
          postcode: postcode.trim().toUpperCase() || null,
        })
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="edit this place">
      <div className="space-y-4 pb-4">
        <label className="block">
          <span className="font-display text-sm font-bold">name</span>
          <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <div>
          <p className="mb-1.5 font-display text-sm font-bold">type</p>
          <div className="flex gap-2">
            {(["restaurant", "bar", "cafe"] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  // Subtypes belong to a type, so a leftover cuisine on a bar
                  // would filter it away entirely.
                  if (k !== kind) setCategory([]);
                }}
                className={`btn flex-1 text-xs ${kind === k ? "bg-plum text-oat" : "bg-cream"}`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 font-display text-sm font-bold">
            {kind === "bar" ? "What kind of bar?" : "Cuisine"}
            <span className="ml-1 font-normal text-ink-soft">(pick at least one)</span>
          </p>
          <CategoryPicker kind={kind} value={category} onChange={setCategory} />
        </div>

        <div>
          <p className="mb-1.5 font-display text-sm font-bold">how pricey?</p>
          <div className="grid grid-cols-4 gap-1.5">
            {BUDGETS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBudget(b)}
                className={`btn flex items-center justify-center px-1 py-2 ${
                  budget === b ? "bg-lemon" : "bg-cream"
                }`}
              >
                <BudgetTag budget={b} size={30} />
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="font-display text-sm font-bold">where</p>
          <input
            className="field"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="street address"
          />
          <div className="flex gap-1.5">
            <input
              className="field flex-1"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="area"
            />
            <input
              className="field flex-1"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="city"
            />
          </div>
          <input
            className="field"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            placeholder="postcode"
            autoCapitalize="characters"
          />
          <p className="micro">
            the pin itself can&apos;t be moved — it&apos;s tied to the Google listing, which is
            what stops the same place going on twice
          </p>
        </div>

        {error && <ErrorNote message={error} />}

        <button onClick={save} disabled={saving} className="btn-primary w-full text-lg">
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </Sheet>
  );
}

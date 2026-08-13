"use client";

/**
 * Add-place flow — spec §6.3, revised.
 *
 * A Google Maps link is **optional**. There are four ways to place a pin:
 *   1. search by name (keyless, via the backend's place search)
 *   2. type an address — it geocodes and the pin drops from it
 *   3. use your current location
 *   4. drop a pin on the map
 * Pasting a Maps link is a fifth shortcut. Whenever a link, a search result or
 * a typed address resolves, the pin drops automatically at that spot.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api";
import { BUDGETS, Budget } from "@/lib/pig";
import { BudgetTag } from "@/components/pigs/PricePig";
import CategoryPicker from "@/components/CategoryPicker";
import PhotoPicker from "@/components/PhotoPicker";
import { ErrorNote, KIND_LABELS, Sheet } from "@/components/ui";
import type { Kind, PlaceCandidate } from "@/lib/types";

type Props = {
  open: boolean;
  /** Bumped by the parent to blank the form for a genuinely new place. */
  resetKey?: number;
  onClose: () => void;
  pickedPoint: { lat: number; lng: number } | null;
  /** The map's current centre, used to bias place search to the visible area. */
  near?: { lat: number; lng: number } | null;
  onRequestPick: () => void;
  onPointResolved: (lat: number, lng: number) => void;
  onCreated: () => void;
};

export default function AddPlaceSheet({
  open,
  resetKey = 0,
  onClose,
  pickedPoint,
  near = null,
  onRequestPick,
  onPointResolved,
  onCreated,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("restaurant");
  const [category, setCategory] = useState<string[]>([]);
  const [budget, setBudget] = useState<Budget>("$$");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [postcode, setPostcode] = useState("");
  const [link, setLink] = useState("");
  const [showLink, setShowLink] = useState(false);
  // Google's id for the place, when the pin came from Google. Stored so the
  // listing photo can be fetched later — photo URLs themselves can't be kept.
  const [googlePlaceId, setGooglePlaceId] = useState<string | null>(null);

  // Your write-up, optional — the same fields as the review sheet, so a place
  // can be logged and reviewed in one go rather than two round trips.
  const [review, setReview] = useState("");
  const [dishes, setDishes] = useState<string[]>([]);
  const [dishDraft, setDishDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // Survives a failed review step so retrying doesn't add the place twice.
  const createdIdRef = useRef<string | null>(null);

  const [results, setResults] = useState<PlaceCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  // Swallowing this was the reason a broken search looked identical to a search
  // that simply found nothing: "Searching…", then silence.
  const [searchError, setSearchError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Set once a location is pinned, which also suppresses further name search.
  const [located, setLocated] = useState(false);
  // Only geocode an address the user actually typed. Autofill and search
  // results write to this field too, and re-geocoding their output would be
  // wasted calls at best and could shunt an already-correct pin at worst.
  const [addressTouched, setAddressTouched] = useState(false);
  // Prefilled kind/cuisine must never overwrite a choice the user has made.
  const [kindTouched, setKindTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [addressMatch, setAddressMatch] = useState<PlaceCandidate | null>(null);
  const [locating, setLocating] = useState(false);

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-current pin position, so the debounced address lookup can read it
  // without listing it as a dependency (which would re-fire the lookup the
  // instant the pin lands).
  const pinRef = useRef(pickedPoint);
  pinRef.current = pickedPoint;
  // A dropped pin is a sharper hint than the map centre; fall back to the map.
  const biasRef = useRef(pickedPoint ?? near);
  biasRef.current = pickedPoint ?? near;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAddressTouched(false);
    setAddressMatch(null);
    setKindTouched(false);
    setCategoryTouched(false);
  }, [open]);

  /**
   * Blank the whole form when the parent signals a new place.
   *
   * The sheet's contents unmount when it closes but this component doesn't, so
   * its state survives — without this, adding a second place starts with the
   * first one's name, cuisine and address still filled in. Keyed off an
   * explicit signal rather than `open`, because the drop-a-pin flow closes and
   * reopens the sheet mid-entry and must keep what's been typed.
   */
  useEffect(() => {
    setName("");
    setKind("restaurant");
    setCategory([]);
    setBudget("$$");
    setAddress("");
    setCity("");
    setArea("");
    setPostcode("");
    setLink("");
    setShowLink(false);
    setResults([]);
    setNote(null);
    setError(null);
    setLocated(false);
    setAddressTouched(false);
    setAddressMatch(null);
    setKindTouched(false);
    setCategoryTouched(false);
  }, [resetKey]);

  // A pin dropped on the map counts as locating the place.
  useEffect(() => {
    if (pickedPoint) setLocated(true);
  }, [pickedPoint]);

  // Type-ahead place search — skipped once we already have a location.
  useEffect(() => {
    if (!open || located || name.trim().length < 3) {
      setResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api.searchPlaces(name.trim(), undefined, biasRef.current));
        setSearchError(null);
      } catch (e) {
        setResults([]);
        setSearchError(e instanceof ApiError ? e.message : "Couldn't reach the search service");
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [name, open, located]);

  /**
   * Geocode a hand-typed address so the pin can drop from it.
   *
   * The pin is only placed automatically when there isn't one yet — if a pin
   * already exists, moving it silently under the user would be worse than
   * offering the move, so it surfaces as a button instead.
   */
  useEffect(() => {
    const hasAddress = address.trim().length >= 6;
    const hasPostcode = postcode.trim().length >= 5;
    if (!open || !addressTouched || (!hasAddress && !hasPostcode)) {
      setAddressMatch(null);
      return;
    }
    if (addressDebounce.current) clearTimeout(addressDebounce.current);
    addressDebounce.current = setTimeout(async () => {
      // Postcode first: it narrows a street to one block, where a city alone
      // leaves "12 High Street" ambiguous across the whole country.
      const query = [address.trim(), postcode.trim(), city.trim()]
        .filter(Boolean)
        .join(", ");
      setLocating(true);
      try {
        const [best] = await api.searchPlaces(query, postcode.trim(), biasRef.current);
        if (!best) {
          setAddressMatch(null);
          return;
        }
        const pin = pinRef.current;
        // ~10m. Editing the city after the address re-runs this lookup, and
        // without the check it would offer to move the pin to where it already
        // is — the note and the button contradicting each other.
        const alreadyThere =
          pin && Math.abs(pin.lat - best.lat) < 1e-4 && Math.abs(pin.lng - best.lng) < 1e-4;

        if (!pin) {
          setLocated(true);
          onPointResolved(best.lat, best.lng);
          if (!city && best.city) setCity(best.city);
          if (!area && best.area) setArea(best.area);
          if (!postcode && best.postcode) setPostcode(best.postcode);
          setAddressMatch(null);
          setNote("Pin dropped from the address — nudge it on the map if it's off.");
        } else {
          setAddressMatch(alreadyThere ? null : best);
        }
      } catch {
        setAddressMatch(null);
      } finally {
        setLocating(false);
      }
    }, 700);
    return () => {
      if (addressDebounce.current) clearTimeout(addressDebounce.current);
    };
    // `pickedPoint` is deliberately read fresh rather than tracked: adding it
    // would re-run this the moment the pin lands and immediately re-geocode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, city, area, postcode, open, addressTouched]);

  /**
   * Fill in kind and cuisine from a lookup, but only where the user hasn't
   * already decided. Someone who picked "bar" shouldn't have it flipped back
   * to "restaurant" because OSM disagrees.
   */
  function applyClassification(k: Kind | null, cats: string[]) {
    if (k && !kindTouched) setKind(k);
    if (cats?.length && !categoryTouched) {
      // A kind change clears categories, so set them after the kind lands.
      setCategory(cats);
    }
  }

  function movePinToAddress() {
    if (!addressMatch) return;
    onPointResolved(addressMatch.lat, addressMatch.lng);
    setAddressMatch(null);
    setNote("Pin moved to the address.");
  }

  function choose(c: PlaceCandidate) {
    setName(c.name);
    setGooglePlaceId(c.place_id ?? null);
    if (!c.place_id) {
      // An OpenStreetMap fallback result: fine for placing the pin, but it
      // carries no Google id, so it can't be what a place is added from.
      setNote("That result isn't a Google listing — paste the Maps link to add it.");
    }
    // These fill the address field programmatically, so clear the typed flag —
    // otherwise the geocode effect fires on our own output.
    setAddressTouched(false);
    setAddressMatch(null);
    if (c.address) setAddress(c.address);
    if (c.city) setCity(c.city);
    if (c.area) setArea(c.area);
    if (c.postcode) setPostcode(c.postcode);
    applyClassification(c.kind, c.category);
    setResults([]);
    setLocated(true);
    onPointResolved(c.lat, c.lng);   // drops the pin automatically
    setNote("Pin dropped — nudge it on the map if it's off.");
  }

  async function useCurrentLocation() {
    setError(null);
    if (!navigator.geolocation) {
      setError("This browser won't share a location — search or drop a pin instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocated(true);
        onPointResolved(pos.coords.latitude, pos.coords.longitude);
        setNote("Using your current location.");
      },
      () => setError("Couldn't get your location — search or drop a pin instead.")
    );
  }

  async function autofillFromLink() {
    const url = link.trim();
    if (!url) return;
    setParsing(true);
    setError(null);
    setNote(null);
    try {
      const parsed = await api.parseMapsLink(url);
      if (!parsed.resolved) {
        setNote("Couldn't read that link — try searching the name instead.");
        return;
      }
      setAddressTouched(false);
      setAddressMatch(null);
      setGooglePlaceId(parsed.place_id ?? null);
      if (parsed.name) setName(parsed.name);
      if (parsed.address) setAddress(parsed.address);
      if (parsed.city) setCity(parsed.city);
      if (parsed.area) setArea(parsed.area);
      if (parsed.postcode) setPostcode(parsed.postcode);
      applyClassification(parsed.kind, parsed.category);
      if (parsed.lat != null && parsed.lng != null) {
        setLocated(true);
        onPointResolved(parsed.lat, parsed.lng);  // drops the pin automatically
        setNote("Autofilled from the link — pin dropped, check it over.");
      } else {
        setNote("Got the name from the link, but not a location — drop a pin.");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't read that link");
    } finally {
      setParsing(false);
    }
  }

  function addDish() {
    const value = dishDraft.trim();
    if (value && !dishes.includes(value)) setDishes((d) => [...d, value]);
    setDishDraft("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Give it a name.");
      return;
    }
    if (!pickedPoint) {
      setError("Pick a location — search the name, use your current spot, or drop a pin.");
      return;
    }
    // The subtype is what the map filters on, so a place without one only ever
    // turns up under "all". Asked for here rather than chased later.
    if (!category.length) {
      setError(kind === "bar" ? "Pick at least one type of bar." : "Pick at least one cuisine.");
      return;
    }

    setSaving(true);
    try {
      // A retry after the review step failed must not create the place twice,
      // so reuse the id from the first attempt if there was one.
      let createdId = createdIdRef.current;
      if (!createdId) {
        const place = await api.createPlace({
          name: name.trim(),
          kind,
          category,
          budget,
          lat: pickedPoint.lat,
          lng: pickedPoint.lng,
          // Only a hand-pasted link is stored; the API derives one otherwise.
          google_maps_url: link.trim() || null,
          google_place_id: googlePlaceId,
          address: address || null,
          city: city || null,
          area: area || null,
          postcode: postcode.trim().toUpperCase() || null,
        });
        createdId = place.id;
        createdIdRef.current = place.id;
      }

      for (const file of files) {
        await api.uploadImage(createdId, file);
      }
      // The review is optional — adding a place already counts as an oink.
      if (review.trim()) {
        await api.recommend(createdId, review.trim(), dishes);
      }

      createdIdRef.current = null;
      onCreated();
      router.push(`/restaurant/${createdId}`);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Couldn't save that";
      setError(
        createdIdRef.current
          ? `The place was added, but your write-up wasn't saved: ${message}`
          : message
      );
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="add a place">
      <form onSubmit={submit} className="space-y-4 pb-4">
        {/* Name + type-ahead search */}
        <section className="space-y-2">
          <label className="block font-display text-sm font-bold">what's it called?</label>
          <input
            className="field"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setLocated(false);   // typing again means re-searching
            }}
            placeholder="start typing to search…"
            required
          />
          {searching && <p className="text-xs text-ink-soft">searching…</p>}
          {!searching && searchError && (
            <p className="rounded-lg bg-rust/15 px-3 py-2 text-xs font-bold text-rust">
              Search failed: {searchError}
            </p>
          )}
          {!searching && !searchError && !located && name.trim().length >= 3 && results.length === 0 && (
            <p className="text-xs text-ink-soft">
              No matches. Type an address or postcode below, or drop a pin.
            </p>
          )}
          {results.length > 0 && (
            <ul className="overflow-hidden rounded-xl bg-cream shadow-lift">
              {results.map((c, i) => (
                <li key={`${c.lat}-${c.lng}-${i}`}>
                  <button
                    type="button"
                    onClick={() => choose(c)}
                    className="w-full px-3.5 py-2.5 text-left hover:bg-oat"
                  >
                    <span className="block text-sm font-bold">{c.name}</span>
                    {c.address && (
                      <span className="block truncate text-xs text-ink-soft">{c.address}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Location */}
        <section className="space-y-2">
          <p className="font-display text-sm font-bold">where is it?</p>
          <div className="flex gap-2">
            <button type="button" onClick={useCurrentLocation} className="btn-secondary flex-1 text-sm">
              I'm here now
            </button>
            <button type="button" onClick={onRequestPick} className="btn-plain flex-1 text-sm">
              Drop a pin
            </button>
          </div>
          {pickedPoint ? (
            <p className="rounded-lg bg-gold-pale px-3 py-2 text-xs font-bold text-[#7A6212]">
              Pin dropped at {pickedPoint.lat.toFixed(4)}, {pickedPoint.lng.toFixed(4)}
              {!googlePlaceId && " — still needs a Google match"}
            </p>
          ) : (
            <p className="text-xs text-ink-soft">
              Pick a result above, or paste a Google Maps link. Dropping a pin or typing an
              address moves the marker, but the place itself has to come from Google.
            </p>
          )}
          {note && <p className="rounded-lg bg-oat-deep px-3 py-2 text-xs">{note}</p>}
        </section>

        {/* Optional Google Maps link */}
        <section className="space-y-2">
          {!showLink ? (
            <button
              type="button"
              onClick={() => setShowLink(true)}
              className="text-sm font-bold text-plum underline underline-offset-2"
            >
              Or paste a Google Maps link (optional)
            </button>
          ) : (
            <>
              <label className="block font-display text-sm font-bold">
                Google Maps link <span className="font-normal text-ink-soft">— optional</span>
              </label>
              <input
                className="field"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onBlur={autofillFromLink}
                placeholder="paste a Google Maps link…"
                inputMode="url"
              />
              <button
                type="button"
                onClick={autofillFromLink}
                className="btn-plain w-full text-sm"
                disabled={parsing || !link.trim()}
              >
                {parsing ? "Reading…" : "Autofill from link"}
              </button>
            </>
          )}
        </section>

        {/* Details */}
        <section className="space-y-3">
          <div className="flex gap-2">
            {(["restaurant", "bar", "cafe"] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setKindTouched(true);
                  setCategory([]);
                }}
                className={`btn flex-1 text-xs ${
                  kind === k ? "bg-plum text-oat" : "bg-cream"
                }`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>

          <div>
            <p className="mb-1.5 font-display text-sm font-bold">
              {kind === "bar" ? "What kind of bar?" : "Cuisine"}
              <span className="ml-1 font-normal text-ink-soft">(pick at least one)</span>
            </p>
            <CategoryPicker
              kind={kind}
              value={category}
              onChange={(next) => {
                setCategory(next);
                setCategoryTouched(true);
              }}
            />
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
            <input
              className="field"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setAddressTouched(true);
              }}
              placeholder="street address"
            />
            {locating && <p className="text-xs text-ink-soft">looking up that address…</p>}
            {addressMatch && (
              <button
                type="button"
                onClick={movePinToAddress}
                className="btn-plain w-full text-xs"
              >
                Move pin to this address
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <input
              className="field flex-1"
              value={postcode}
              onChange={(e) => {
                setPostcode(e.target.value);
                setAddressTouched(true);
              }}
              placeholder="postcode"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
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
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="area (optional)"
          />
        </section>

        {/* Your take — optional. Adding a place already counts as an oink, so
            nobody is forced to write something to log somewhere. */}
        <section className="space-y-3 border-t border-oat-deep pt-4">
          <div>
            <p className="font-display text-sm font-bold">
              Your take <span className="font-normal text-ink-soft">— optional</span>
            </p>
            <p className="text-xs text-ink-soft">say it now, or add it later from the place page.</p>
          </div>

          <textarea
            className="field min-h-[90px]"
            value={review}
            onChange={(e) => setReview(e.target.value)}
            placeholder="what's it like? who should go?"
          />

          <div className="space-y-2">
            <p className="font-display text-sm font-bold">dishes worth ordering</p>
            <div className="flex gap-2">
              <input
                className="field flex-1"
                value={dishDraft}
                onChange={(e) => setDishDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDish();
                  }
                }}
                placeholder="e.g. monkfish curry"
              />
              <button type="button" onClick={addDish} className="btn-plain px-4">+</button>
            </div>
            {dishes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {dishes.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDishes((prev) => prev.filter((x) => x !== d))}
                    className="dish-tag"
                  >
                    {d} ✕
                  </button>
                ))}
              </div>
            )}
          </div>

          <PhotoPicker files={files} onChange={setFiles} />
        </section>

        {error && <ErrorNote message={error} />}

        {!googlePlaceId && (
          <p className="rounded-card border-2 border-ink bg-gold px-3 py-2 text-sm font-bold text-ink-deep">
            Pick the place from the search results above, or paste its Google Maps link. That&apos;s
            what stops the same place going on twice.
          </p>
        )}

        <button
          type="submit"
          className="btn-primary w-full text-lg"
          disabled={saving || !googlePlaceId}
        >
          {saving ? "Saving…" : review.trim() ? "Add it & post your take" : "Add it"}
        </button>
      </form>
    </Sheet>
  );
}

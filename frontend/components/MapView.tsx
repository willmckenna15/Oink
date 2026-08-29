"use client";

/**
 * Discover map — spec §6.3.
 *
 * Pins carry the recommenders' pig **faces** (full bodies are reserved for the
 * feed and profile). Where several people rate a place, one face leads and a
 * count chip carries the rest.
 * Places with only shame still get a pin, greyed out.
 *
 * Uses Leaflet directly rather than a React wrapper because the pins are custom
 * HTML — a divIcon holding the same pig SVG the rest of the app uses.
 *
 * Nearby pins cluster into a single counted marker so faces never stack into
 * an unreadable pile; clusters break apart as you zoom in. No API key needed.
 */
import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Map as LeafletMap, Marker } from "leaflet";
import type { PlaceSummary, User } from "@/lib/types";
import PigAvatar from "@/components/pigs/PigAvatar";
import { ShamePig } from "@/components/pigs/ReactionPigs";
// Safe as a static import — this component is only loaded via next/dynamic
// with ssr:false.
import "leaflet/dist/leaflet.css";

// Carto moved their free raster basemaps behind an API key: the tiles still
// return 200, but every one comes back stamped "API KEY REQUIRED" across the
// middle, so there is nothing to configure our way out of. Esri's street
// basemap is the closest keyless match to the Voyager styling this was built
// around — clean and low-clutter, but warm and with enough contrast to
// navigate by, where a grey canvas washes out against the app's own ground.
//
// Set NEXT_PUBLIC_CARTO_API_KEY to go back to Voyager, or point
// NEXT_PUBLIC_MAP_TILE_URL / _ATTRIBUTION at any other provider.
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILE_URL ||
  (CARTO_KEY
    ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?api_key=${CARTO_KEY}`
    : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}");

const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ||
  (CARTO_KEY
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : 'Tiles &copy; <a href="https://www.esri.com">Esri</a>');

// Esri serves this basemap to zoom 19; past that Leaflet upscales the last
// real tile rather than requesting one that comes back blank.
const TILE_MAX_NATIVE_ZOOM = CARTO_KEY ? 20 : 19;

// Pins closer together than this (screen pixels at the current zoom) collapse
// into one cluster, so faces stop stacking into an unreadable pile.
const CLUSTER_RADIUS_PX = 52;

// Pin width. Wide enough that the faces behind the leader stay legible instead
// of being swallowed by it — they carry real information now that shamers can
// appear among them.
const PIN_W = 76;

// Central London — a sensible opening view before any places load.
import { CITY_ZOOM, LONDON, ME_SPAN_M, spanAround } from "@/lib/map";

const DEFAULT_CENTER: [number, number] = [51.5127, -0.1345];
const DEFAULT_ZOOM = 13;

// Roughly "the city you're standing in" — close enough to read street names,
// wide enough to take in the places across town.

type Props = {
  places: PlaceSummary[];
  onSelect: (place: PlaceSummary) => void;
  /** Fires as the map settles, so search can be biased to the visible area —
   *  and so the view can be remembered across a trip to a place page. */
  onCenterChange?: (lat: number, lng: number, zoom: number) => void;
  /** Where the map was when you last left this screen. Overrides the opening
   *  framing entirely: coming back should put you where you were, not where
   *  you happen to be standing. */
  initialView?: { lat: number; lng: number; zoom: number } | null;
  /** Also as it settles: what's actually on screen, so the list can show only
   *  the places you're looking at rather than every pin in the country. */
  onBoundsChange?: (b: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
  /** Set to move the map somewhere. `span` frames that many metres across —
   *  used for "where I am", where a zoom level would cover twice the ground on
   *  a tablet as on a phone. Without it the map goes to a city's worth. */
  focusPoint?: { lat: number; lng: number; span?: number } | null;
  /** The viewer, so "you are here" can be their own pig rather than a dot. */
  me?: User | null;
  /** Enables tap-to-drop-a-pin while adding a new place. */
  pickMode?: boolean;
  onPick?: (lat: number, lng: number) => void;
  pickedPoint?: { lat: number; lng: number } | null;
  className?: string;
};

type Voter = { user: PlaceSummary["recommenders"][number]; shamed: boolean };

function faceMarkup(voter: Voter | undefined, size: number): string {
  return renderToStaticMarkup(
    <PigAvatar
      config={voter?.user.pig_avatar_config}
      placesLogged={voter?.user.places_logged ?? 0}
      lastLoggedAt={voter?.user.last_logged_at}
      size={size}
      bare
    />
  );
}

/** How many faces a pin will carry — drives which pin wins an overlap. */
function voterCount(place: PlaceSummary): number {
  const endorsers = place.recommenders ?? [];
  return endorsers.length ? endorsers.length + (place.shamers ?? []).length : 0;
}

function pinHtml(place: PlaceSummary): string {
  // Endorsers first — the leader is whoever backed the place first — then
  // anyone who shamed it, so a divided place shows both verdicts on one pin
  // rather than reading as unanimous.
  // Defaulted rather than assumed: the map is the first screen, and it should
  // not blank out if an older API build omits either list.
  const endorsers = place.recommenders ?? [];
  const shamers = place.shamers ?? [];

  // Shamers join the fan only where somebody also oinked, so a split verdict
  // shows both sides. With nothing but shame the pin stays the greyed-out angry
  // pig — the whole pin is desaturated there, which would drain the colour out
  // of a shame badge and leave it less readable than the pig it replaced.
  const voters: Voter[] = endorsers.length
    ? [
        ...endorsers.map((user) => ({ user, shamed: false })),
        ...shamers.map((user) => ({ user, shamed: true })),
      ]
    : [];
  const count = voters.length;
  const shamed = place.shamed_only;
  const ring = shamed ? "#8E8478" : "#4D303F";
  const bg = shamed ? "#DCD5C6" : "#FFFDF6";

  // A greyed face alone doesn't say "shamed" at pin size, so a shamer's face
  // carries the angry pig as a badge — the same mark used on the reaction
  // buttons and the feed, so the verdict reads without a legend.
  const shameBadge = (size: number) => `
    <div style="
      position:absolute; right:-3px; bottom:-3px;
      width:${size}px; height:${size}px; border-radius:50%;
      background:#A9503C; border:2px solid #FFFDF6;
      box-shadow:0 2px 6px rgba(77,48,63,.28);
      display:flex; align-items:center; justify-content:center; overflow:hidden;
    ">${renderToStaticMarkup(<ShamePig size={size - 3} active />)}</div>`;

  const disc = (inner: string, size: number, offset: string, dissenter = false) => `
    <div style="position:absolute; ${offset} width:${size}px; height:${size}px;">
      <div style="
        width:100%; height:100%; border-radius:50%;
        background:${bg}; border:2.5px solid ${dissenter ? "#FF8A00" : ring};
        box-shadow:0 2px 8px rgba(43,27,61,.28);
        display:flex; align-items:center; justify-content:center; overflow:hidden;
        ${dissenter ? "filter:grayscale(1);" : ""}
      ">${inner}</div>
      ${dissenter ? shameBadge(Math.max(14, Math.round(size * 0.44))) : ""}
    </div>`;

  const face = (i: number, size: number, discSize: number, offset: string) =>
    disc(faceMarkup(voters[i], size), discSize, offset, voters[i]?.shamed ?? false);

  // Fan the extra faces out behind the leader, furthest first so the front one
  // ends up on top.
  const fan = Math.min(count, 3);
  let layers = "";
  if (count === 0) {
    // Logged but unendorsed — the angry pig, not a generic emoji. Every icon in
    // the app is a pig.
    layers = disc(renderToStaticMarkup(<ShamePig size={34} active />), 42, "left:9px; top:0;");
  } else {
    if (fan >= 3) layers += face(2, 24, 30, "left:0; top:14px;");
    if (fan >= 2) layers += face(1, 26, 32, "right:0; top:12px;");
    layers += face(0, 36, 42, "left:17px; top:0;");
  }

  const chip =
    count > 3
      ? `<div style="
           position:absolute; right:-4px; top:-4px;
           min-width:20px; height:20px; padding:0 5px; border-radius:10px;
           background:#914E56; color:#F4EEDC; border:2px solid #4D303F;
           font-family:var(--font-display),system-ui; font-size:11px; font-weight:800;
           display:flex; align-items:center; justify-content:center;
           box-shadow:none;
         ">${count}</div>`
      : "";

  return `
    <div style="position:relative; width:${PIN_W}px; height:54px; ${shamed ? "filter:grayscale(1);opacity:.85;" : ""}">
      ${layers}${chip}
      <div style="
        position:absolute; left:50%; bottom:-7px; transform:translateX(-50%);
        width:0; height:0;
        border-left:6px solid transparent; border-right:6px solid transparent;
        border-top:9px solid ${shamed ? "#8E8478" : "#4D303F"};
        filter:none;
      "></div>
    </div>`;
}

function clusterHtml(group: PlaceSummary[]): string {
  // Show a couple of faces so a cluster still reads as "your friends' places",
  // with the count doing the real work. Shamers count as faces here exactly as
  // they do on a pin: a place someone only shamed was contributing nothing, so
  // a cluster of two could show a single face and look broken.
  const faces = group
    .flatMap((p) => [...(p.recommenders ?? []), ...(p.shamers ?? [])])
    .slice(0, 2)
    .map(
      (u, i) => `<div style="position:absolute; ${i === 0 ? "left:4px" : "right:4px"}; top:6px;
          width:26px; height:26px; border-radius:50%; overflow:hidden; background:#FFFDF6;">
          ${renderToStaticMarkup(
            <PigAvatar
              config={u.pig_avatar_config}
              placesLogged={u.places_logged}
              lastLoggedAt={u.last_logged_at}
              size={26}
              bare
            />
          )}</div>`
    )
    .join("");

  return `
    <div style="position:relative; width:56px; height:56px;">
      <div style="
        position:absolute; inset:0; border-radius:50%;
        background:#FFFDF6; border:3px solid #4D303F;
        box-shadow:0 3px 10px rgba(77,48,63,.24);
      "></div>
      ${faces}
      <div style="
        position:absolute; left:0; right:0; bottom:5px;
        text-align:center; font-family:var(--font-display),system-ui;
        font-size:15px; font-weight:800; color:#914E56; line-height:1;
      ">${group.length}</div>
    </div>`;
}

export default function MapView({
  places,
  onSelect,
  onCenterChange,
  onBoundsChange,
  initialView,
  me,
  focusPoint,
  pickMode = false,
  onPick,
  pickedPoint,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const pickMarkerRef = useRef<Marker | null>(null);
  const meMarkerRef = useRef<Marker | null>(null);
  const framedRef = useRef(false);
  // Leaflet is imported dynamically, so the map exists only after an async
  // tick. The marker effects key off this so they re-run once it's actually
  // ready rather than silently bailing out on first render.
  const [ready, setReady] = useState(false);
  // Bumped to force a rebuild — see the hot-reload guard below.
  const [generation, setGeneration] = useState(0);
  // Clusters depend on the current zoom, so re-run the marker effect when it
  // changes; without this, groups stay welded together as you zoom in.
  const [zoomTick, setZoomTick] = useState(0);
  const [myPoint, setMyPoint] = useState<{ lat: number; lng: number } | null>(null);
  // Kept in a ref so the click handler, bound once, always sees current values.
  const centerCb = useRef(onCenterChange);
  centerCb.current = onCenterChange;
  const boundsCb = useRef(onBoundsChange);
  boundsCb.current = onBoundsChange;
  // Read once, at mount: it's the opening position, and re-reading it later
  // would fight whatever the user has done to the map since.
  const viewRef = useRef(initialView);
  const pickHandlers = useRef({ pickMode, onPick });
  pickHandlers.current = { pickMode, onPick };

  // Init once
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
        // Quarter steps rather than whole ones. fitBounds has to floor to a
        // permitted zoom, so on whole steps "fit London" could land a full
        // level short and show twice the ground — the Home Counties top and
        // bottom, London a band through the middle. A quarter is close enough
        // to fit properly and coarse enough that raster tiles stay sharp.
        zoomSnap: 0.25,
      });
      // No zoom control — pinch and double-tap are the gestures people actually
      // use on a phone, and the buttons only crowd the corner.
      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: 20,
        maxNativeZoom: TILE_MAX_NATIVE_ZOOM,
      }).addTo(map);

      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        const { pickMode: active, onPick: pick } = pickHandlers.current;
        if (active && pick) pick(e.latlng.lat, e.latlng.lng);
      });

      map.on("zoomend", () => setZoomTick((t) => t + 1));
      // Kept in a ref so binding once doesn't freeze a stale callback.
      const report = () => {
        const c = map.getCenter();
        centerCb.current?.(c.lat, c.lng, map.getZoom());
        // A hidden map has no viewport to report. On a phone the list replaces
        // the map with `display:none`, which collapses the container to 0x0;
        // the resize observer then calls invalidateSize, Leaflet fires moveend,
        // and getBounds comes back as a single point. Anything scoped to those
        // bounds sees nothing — which is how switching to the list emptied it.
        // Saying nothing leaves the last real viewport standing, which is what
        // the list should be showing anyway.
        const size = map.getSize();
        if (!size.x || !size.y) return;
        const b = map.getBounds();
        boundsCb.current?.({
          minLat: b.getSouth(),
          minLng: b.getWest(),
          maxLat: b.getNorth(),
          maxLng: b.getEast(),
        });
      };
      map.on("moveend", report);
      report();

      // Back from a place page: straight to where you were, and nothing else
      // gets to move the view. `framedRef` is what stops a late location fix
      // arriving a second later and throwing it away.
      const remembered = viewRef.current;
      if (remembered) {
        framedRef.current = true;
        map.setView([remembered.lat, remembered.lng], remembered.zoom, { animate: false });
      } else {
        // London is where the map rests when it has nothing better: it's on
        // screen from the first paint, so a refused or slow location fix needs
        // no fallback of its own — this is already the fallback.
        map.fitBounds(LONDON, { padding: [12, 12], animate: false });
      }

      // Then, if the browser will say where you are, your own kilometre.
      // Framing every pin instead was the old behaviour and it opened uselessly
      // wide, since the pins can span the country.
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            // Something deliberate may have happened while we waited — a city
            // searched, a pin dropped. A late fix must not yank the view back.
            if (cancelled || framedRef.current || pickHandlers.current.pickMode) return;
            framedRef.current = true;
            map.fitBounds(spanAround(pos.coords.latitude, pos.coords.longitude, ME_SPAN_M), {
              animate: false,
            });
          },
          () => {},
          { timeout: 8000, maximumAge: 5 * 60 * 1000 }
        );
      }

      mapRef.current = map;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [generation]);

  /**
   * Rebuild the map if a hot reload has orphaned it.
   *
   * Leaflet holds imperative DOM state that Fast Refresh can't hot-swap: when
   * this module is replaced, React re-runs the component but the init effect
   * doesn't, leaving `mapRef` pointing at a map whose container was thrown
   * away. The map then looks broken until a full page reload — which is a poor
   * thing to ask of anyone editing the file. Development only; there are no
   * hot reloads in production, so this never runs there.
   */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const timer = setInterval(() => {
      const map = mapRef.current;
      if (map && !map.getContainer().isConnected) {
        map.remove();
        mapRef.current = null;
        markersRef.current = [];
        pickMarkerRef.current = null;
        framedRef.current = false;
        setReady(false);
        setGeneration((g) => g + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Leaflet doesn't recompute its size when the container changes behind an
  // overlay (opening/closing the add-place sheet), which paints the map grey.
  // A resize observer keeps it in step.
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    if (ready) setTimeout(() => mapRef.current?.invalidateSize(), 0);
  }, [ready, pickMode]);

  // Redraw pins when the filtered set changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    (async () => {
      const L = (await import("leaflet")).default;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      // Group anything that would overlap at this zoom. Recomputed on every
      // zoom change, so clusters break apart as you zoom in.
      const zoom = map.getZoom();
      const projected = places.map((p) => ({ place: p, pt: map.project([p.lat, p.lng], zoom) }));
      const taken = new Set<number>();
      const groups: PlaceSummary[][] = [];

      projected.forEach((a, i) => {
        if (taken.has(i)) return;
        taken.add(i);
        const group = [a.place];
        projected.forEach((b, j) => {
          if (taken.has(j) || i === j) return;
          if (a.pt.distanceTo(b.pt) < CLUSTER_RADIUS_PX) {
            taken.add(j);
            group.push(b.place);
          }
        });
        groups.push(group);
      });

      groups.forEach((group) => {
        if (group.length === 1) {
          const place = group[0];
          const icon = L.divIcon({
            className: "oink-pin",
            html: pinHtml(place),
            iconSize: [PIN_W, 61],
            iconAnchor: [PIN_W / 2, 61],
          });
          markersRef.current.push(
            L.marker([place.lat, place.lng], { icon, zIndexOffset: voterCount(place) * 1000 })
              .addTo(map)
              .on("click", () => onSelect(place))
          );
          return;
        }

        const bounds = L.latLngBounds(group.map((p) => [p.lat, p.lng] as [number, number]));
        const icon = L.divIcon({
          className: "oink-pin",
          html: clusterHtml(group),
          iconSize: [56, 56],
          iconAnchor: [28, 28],
        });
        markersRef.current.push(
          L.marker(bounds.getCenter(), { icon })
            .addTo(map)
            // Zooming in is the right response while it can still separate the
            // pins. Two places on the same corner never separate, though, and
            // the cluster then swallowed every tap — so once zooming would gain
            // nothing, open the first place instead of doing nothing at all.
            .on("click", () => {
              const canSeparate = map.getBoundsZoom(bounds, false) > map.getZoom();
              if (canSeparate) {
                map.fitBounds(bounds, { padding: [70, 70], maxZoom: 18 });
              } else {
                onSelect(group[0]);
              }
            })
        );
      });

    })();
  }, [places, onSelect, ready, zoomTick]);

  // Jump to a city picked from search. Claims the framing slot so a late
  // geolocation fix or the pin-fit fallback can't yank the view back.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusPoint) return;
    framedRef.current = true;
    if (focusPoint.span) {
      map.fitBounds(spanAround(focusPoint.lat, focusPoint.lng, focusPoint.span));
    } else {
      map.setView([focusPoint.lat, focusPoint.lng], CITY_ZOOM);
    }
  }, [focusPoint, ready]);

  /**
   * Where you are, followed rather than sampled once — the map's init already
   * takes a fix to choose the opening city, but that's a single reading and
   * this marker has to keep up as you walk.
   */
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (pos) => setMyPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      // Silent: the map already surfaces a locate failure through its own
      // button, and a second complaint about it helps nobody.
      () => {},
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  // You are here — your own pig, in a ring, with a soft halo for the fix.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    (async () => {
      const L = (await import("leaflet")).default;
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      if (!myPoint) return;

      const pig = renderToStaticMarkup(
        <PigAvatar
          config={me?.pig_avatar_config}
          placesLogged={me?.places_logged ?? 0}
          lastLoggedAt={me?.last_logged_at}
          size={52}
          variant="full"
        />
      );
      // Standing on the spot rather than cropped into a badge — a full body in
      // a circle loses its legs, which is most of what makes it a pig. The
      // halo under its feet is the fix; the anchor sits at the centre of that,
      // so the pig stands on the point rather than over it.
      const icon = L.divIcon({
        className: "oink-me",
        html: `<div style="position:relative;width:60px;height:66px">
                 <div style="position:absolute;left:9px;bottom:0;width:42px;height:18px;
                             border-radius:50%;background:rgba(145,78,86,.22)"></div>
                 <div style="position:absolute;left:11px;bottom:5px;width:38px;height:9px;
                             border-radius:50%;background:rgba(145,78,86,.45)"></div>
                 <div style="position:absolute;left:4px;top:0;width:52px;
                             filter:drop-shadow(0 2px 3px rgba(77,48,63,.35))">${pig}</div>
               </div>`,
        iconSize: [60, 66],
        iconAnchor: [30, 57],
      });

      // Over every pin, and untappable. A pin's z comes from how many people
      // have backed it (voterCount * 1000), so this needs an offset no crowd
      // can reach; `interactive: false` puts pointer-events off the icon, so
      // being in front costs nothing — taps still land on the pin underneath.
      meMarkerRef.current = L.marker([myPoint.lat, myPoint.lng], {
        icon,
        zIndexOffset: 1_000_000,
        interactive: false,
      }).addTo(map);
    })();
  }, [myPoint, ready, me]);

  // The dropped pin while adding a place
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    (async () => {
      const L = (await import("leaflet")).default;
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      if (!pickedPoint) return;

      const icon = L.divIcon({
        className: "oink-pin",
        html: `<div style="
            width:34px;height:34px;border-radius:50%;
            background:#914E56;border:3px solid #4D303F;
            box-shadow:0 3px 10px rgba(77,48,63,.26);
            display:flex;align-items:center;justify-content:center;
            color:#F4EEDC;font-family:var(--font-display),system-ui;font-weight:800;font-size:20px;
          ">+</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
      });
      pickMarkerRef.current = L.marker([pickedPoint.lat, pickedPoint.lng], { icon }).addTo(map);
      map.setView([pickedPoint.lat, pickedPoint.lng], Math.max(map.getZoom(), 15));
    })();
  }, [pickedPoint, ready]);

  // The pick-mode classes go on a wrapper, never on the map element itself.
  // Leaflet adds `leaflet-container` (and `leaflet-touch`, `leaflet-fade-anim`
  // …) to that element imperatively after mount; React rewriting its className
  // on a later render strips them all off, which silently destroys the map's
  // styling — it blanks the moment you switch into pin-dropping.
  return (
    <div
      className={`${className} ${pickMode ? "oink-picking cursor-crosshair" : ""}`}
      aria-label="Map of recommended places"
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

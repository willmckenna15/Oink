/**
 * Map framing.
 *
 * These live here rather than in MapView because DiscoverScreen decides where
 * to point the map and MapView does the pointing, so both need them — and
 * MapView is loaded with `ssr: false`, so importing from it statically would
 * drag Leaflet onto the server.
 */

/**
 * How much ground to show when opening on your own position: a kilometre
 * across, which is a walk rather than a city.
 *
 * Expressed in metres rather than as a zoom level on purpose. A zoom is a
 * scale, not an area — the same number covers twice the ground on a tablet as
 * on a phone — so "show me a kilometre" has to be fitted, not zoomed to.
 */
export const ME_SPAN_M = 1000;

/** A city picked from search. Here you do want the whole city. */
export const CITY_ZOOM = 13;

/**
 * London, for when there's no location to open on.
 *
 * Inner London rather than the full Greater London sprawl. The boroughs run
 * about 60km east to west, and fitting that across a portrait phone puts
 * Stevenage at the top and Sevenoaks at the bottom with London a band through
 * the middle — technically all of it on screen, and useless. This is Ealing to
 * the Isle of Dogs, Ally Pally to Clapham: about 26km, which fills the frame
 * and holds everywhere anyone is realistically logging.
 */
export const LONDON: [[number, number], [number, number]] = [
  [51.42, -0.33],
  [51.6, 0.06],
];

/** A square of `metres` a side, centred on a point, as [[s,w],[n,e]]. */
export function spanAround(
  lat: number,
  lng: number,
  metres: number
): [[number, number], [number, number]] {
  const dLat = metres / 2 / 111_320;
  // Lines of longitude converge toward the poles, so a metre is worth more
  // degrees the further north you are.
  const dLng = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  return [
    [lat - dLat, lng - dLng],
    [lat + dLat, lng + dLng],
  ];
}

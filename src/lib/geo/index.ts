/**
 * Lightweight geo helpers for client-side turf / proximity checks.
 * Planar math on lat/lng — accurate enough at neighbourhood scale, and cheap
 * enough to run offline on a $150 phone (no turf.js dependency).
 */

/** Great-circle distance in metres (Haversine). */
export function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const a =
    s1 * s1 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray-casting point-in-ring test. Ring is an array of [lng, lat] pairs. */
function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Is the point inside a GeoJSON Polygon? `coordinates` is the Polygon's
 * coordinates array: [ outerRing, ...holes ] where each ring is [[lng,lat],…].
 * Holes are ignored (fine for turf polygons).
 */
export function pointInPolygon(
  lat: number,
  lng: number,
  coordinates: number[][][] | null | undefined,
): boolean {
  if (!coordinates || coordinates.length === 0) return false;
  return pointInRing(lat, lng, coordinates[0]);
}

/** Inside any of the given polygons (rep may hold several turfs). */
export function pointInAnyPolygon(
  lat: number,
  lng: number,
  polygons: number[][][][],
): boolean {
  return polygons.some((poly) => pointInPolygon(lat, lng, poly));
}

/**
 * Google Maps "get directions" URL for a field visit. Opens turn-by-turn
 * navigation from the device's current location to the destination — no origin
 * needed (Google fills it from GPS), works in the Maps app on Android and on
 * the web. Prefers precise GPS coordinates; falls back to the address label.
 * Returns null when we have neither.
 */
export function directionsUrl(
  lat: number | null | undefined,
  lng: number | null | undefined,
  address?: string | null,
): string | null {
  let destination: string;
  if (lat != null && lng != null) {
    destination = `${lat},${lng}`;
  } else if (address && address.trim()) {
    destination = address.trim();
  } else {
    return null;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

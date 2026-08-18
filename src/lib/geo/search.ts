'use client';

/**
 * Forward geocoding (typed text → places with coordinates).
 *
 * The mirror of reverse.ts, same provider and same escape hatch: Nominatim by
 * default, no key, and NEXT_PUBLIC_GEOCODE_SEARCH_URL to point at a keyed
 * provider that accepts `?q=&format=jsonv2`.
 *
 * Results are biased to Abidjan — a rep typing "pharmacie" wants the one down
 * the road, not one in another country — but the bias is a preference, not a
 * fence, so a lookup outside the box still returns.
 */
const BASE =
  process.env.NEXT_PUBLIC_GEOCODE_SEARCH_URL ?? 'https://nominatim.openstreetmap.org/search';

/** Greater Abidjan, generously drawn: west, south, east, north. */
const VIEWBOX = '-4.30,5.15,-3.75,5.55';

export interface PlaceHit {
  label: string;
  lat: number;
  lng: number;
}

interface NominatimHit {
  display_name?: string;
  lat?: string;
  lon?: string;
  name?: string;
}

/** Trim Nominatim's very long display_name to something readable on a phone. */
function shorten(displayName: string): string {
  const parts = displayName.split(',').map((p) => p.trim());
  // Drop the country and postcode tail; keep the first few meaningful parts.
  return parts.slice(0, 3).join(', ');
}

const VIA_SERVER = process.env.NEXT_PUBLIC_GEOCODE_PROVIDER === 'google';

export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  if (VIA_SERVER) {
    try {
      const res = await fetch(`/api/geocode?mode=search&q=${encodeURIComponent(q)}`, { signal });
      if (!res.ok) return [];
      const { hits } = (await res.json()) as { hits: PlaceHit[] };
      return hits ?? [];
    } catch {
      return [];
    }
  }
  try {
    const url =
      `${BASE}?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1` +
      `&limit=6&accept-language=fr&viewbox=${VIEWBOX}&bounded=0`;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 6000);
    const res = await fetch(url, {
      signal: signal ?? timeout.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return [];
    const rows = (await res.json()) as NominatimHit[];
    return rows
      .filter((r) => r.lat && r.lon && r.display_name)
      .map((r) => ({
        label: shorten(r.display_name!),
        lat: Number(r.lat),
        lng: Number(r.lon),
      }))
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  } catch {
    return [];
  }
}

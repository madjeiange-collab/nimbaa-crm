'use client';

/**
 * Best-effort reverse geocoding (lat/lng → short address label).
 *
 * Uses OpenStreetMap Nominatim by default (no key, fair-use limited). For
 * production scale set NEXT_PUBLIC_GEOCODE_URL to a keyed provider that accepts
 * `?lat=&lon=&format=jsonv2`. Always returns null on any failure — the caller
 * must treat the address as optional (offline / dead zones / no coverage).
 */
const BASE =
  process.env.NEXT_PUBLIC_GEOCODE_URL ?? 'https://nominatim.openstreetmap.org/reverse';

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city?: string;
  town?: string;
  village?: string;
}

/** Build a compact "Road, Neighbourhood, City" label from address parts. */
function toLabel(a: NominatimAddress | undefined, displayName: string | undefined): string | null {
  if (a) {
    const road = a.road ?? a.pedestrian;
    const area = a.neighbourhood ?? a.suburb ?? a.quarter;
    const city = a.city ?? a.town ?? a.village;
    const parts = [road, area, city].filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }
  if (displayName) return displayName.split(',').slice(0, 3).join(',').trim();
  return null;
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `${BASE}?lat=${lat}&lon=${lng}&format=jsonv2&zoom=18&addressdetails=1&accept-language=fr`;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 6000);
    const res = await fetch(url, {
      signal: signal ?? timeout.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data = (await res.json()) as {
      address?: NominatimAddress;
      display_name?: string;
    };
    return toLabel(data.address, data.display_name);
  } catch {
    return null;
  }
}

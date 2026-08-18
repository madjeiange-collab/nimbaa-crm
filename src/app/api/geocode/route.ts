import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';

/**
 * Server-side geocoding, so a billable Google key never reaches the browser.
 *
 * Google's Geocoding and Places are web-service APIs: a key sent from the
 * client is readable by anyone with devtools, and a leaked billable key gets
 * scraped and drained. It stays here, in GOOGLE_MAPS_API_KEY (no NEXT_PUBLIC_
 * prefix, so Next never inlines it into the bundle).
 *
 * Signed-in callers only — otherwise this is an open geocoding proxy on
 * someone else's bill.
 *
 * Returns the same shapes the client already speaks:
 *   ?mode=reverse&lat=&lng=  →  { label: string | null }
 *   ?mode=search&q=          →  { hits: { label, lat, lng }[] }
 */
export const maxDuration = 15;

/** Greater Abidjan — results are biased here, not fenced to it. */
const ABIDJAN = { latitude: 5.348, longitude: -4.008 };
const BIAS_RADIUS_M = 40000;

function shorten(formatted: string): string {
  const parts = formatted.split(',').map((p) => p.trim());
  return parts.slice(0, 3).join(', ');
}

async function reverse(key: string, lat: string, lng: string) {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
    `&language=fr&key=${key}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status?: string;
    results?: { formatted_address?: string }[];
  };
  if (data.status !== 'OK') {
    // ZERO_RESULTS is ordinary; the rest is worth seeing in the logs.
    if (data.status !== 'ZERO_RESULTS') console.error('[geocode] reverse', data.status);
    return null;
  }
  const first = data.results?.[0]?.formatted_address;
  return first ? shorten(first) : null;
}

async function search(key: string, q: string) {
  // Places API (New) — the one that knows business names, which is the reason
  // for using Google at all. Field mask is required and is what you pay for.
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({
      textQuery: q,
      languageCode: 'fr',
      maxResultCount: 6,
      locationBias: { circle: { center: ABIDJAN, radius: BIAS_RADIUS_M } },
    }),
  });
  if (!res.ok) {
    console.error('[geocode] search', res.status, (await res.text()).slice(0, 200));
    return [];
  }
  const data = (await res.json()) as {
    places?: {
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    }[];
  };
  return (data.places ?? [])
    .map((p) => {
      const name = p.displayName?.text;
      const addr = p.formattedAddress ? shorten(p.formattedAddress) : null;
      return {
        // "Pharmacie Les Palmiers, Cocody" reads better than either alone.
        label: name && addr ? `${name}, ${addr}` : (name ?? addr ?? ''),
        lat: p.location?.latitude,
        lng: p.location?.longitude,
      };
    })
    .filter(
      (h): h is { label: string; lat: number; lng: number } =>
        !!h.label && typeof h.lat === 'number' && typeof h.lng === 'number',
    );
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');

  try {
    if (mode === 'reverse') {
      const lat = searchParams.get('lat');
      const lng = searchParams.get('lng');
      if (!lat || !lng) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
      return NextResponse.json({ label: await reverse(key, lat, lng) });
    }
    if (mode === 'search') {
      const q = (searchParams.get('q') ?? '').trim();
      if (q.length < 3) return NextResponse.json({ hits: [] });
      return NextResponse.json({ hits: await search(key, q) });
    }
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  } catch (e) {
    console.error('[geocode]', e);
    return NextResponse.json({ error: 'provider_error' }, { status: 502 });
  }
}

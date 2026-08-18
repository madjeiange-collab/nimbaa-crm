'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { MapPin, Crosshair, Map as MapIcon, Loader2, X } from 'lucide-react';
import { useGeolocation } from '@/hooks/use-geolocation';
import { reverseGeocode } from '@/lib/geo/reverse';
import { searchPlaces, type PlaceHit } from '@/lib/geo/search';
import { Input } from '@/components/ui/input';

const PinMap = dynamic(() => import('@/components/map/pin-map'), {
  ssr: false,
  loading: () => <div className="h-[260px] w-full animate-pulse rounded-md bg-muted" />,
});

/**
 * Three ways to put an address on a fiche, because a rep is in one of three
 * situations: standing at the door, remembering a name, or looking at a map.
 *
 *  1. Standing there  — the GPS position, reverse-geocoded, offered to confirm.
 *  2. Remembering     — type and pick from search results (biased to Abidjan).
 *  3. Neither         — open the map and drop the pin.
 *
 * Whichever route, coordinates come with the label, so the contact lands on the
 * coverage map instead of being an address nobody can navigate to. Typing
 * freely still works: the text is the address, simply without coordinates.
 */
export function AddressPicker({
  value,
  lat,
  lng,
  onChange,
}: {
  value: string;
  lat: number | null;
  lng: number | null;
  onChange: (address: string, lat: number | null, lng: number | null) => void;
}) {
  const t = useTranslations('address');
  const geo = useGeolocation(true);
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [hereLabel, setHereLabel] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
  /** Set while we write into the box ourselves, so it does not re-search. */
  const quiet = useRef(false);

  const hasFix = geo.status === 'ready' && geo.lat != null && geo.lng != null;

  // Name the current position once, so "use my position" can show what it is.
  useEffect(() => {
    if (!hasFix) return;
    let cancelled = false;
    reverseGeocode(geo.lat!, geo.lng!).then((a) => {
      if (!cancelled) setHereLabel(a);
    });
    return () => {
      cancelled = true;
    };
  }, [hasFix, geo.lat, geo.lng]);

  // Debounced search on what the rep types.
  useEffect(() => {
    if (quiet.current) {
      quiet.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchPlaces(q, ctrl.signal);
      setHits(found);
      setSearching(false);
    }, 450);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
      setSearching(false);
    };
  }, [value]);

  function commit(label: string, la: number | null, ln: number | null) {
    quiet.current = true;
    setHits([]);
    onChange(label, la, ln);
  }

  function useHere() {
    if (!hasFix) return;
    commit(hereLabel ?? t('atMyPosition'), geo.lat!, geo.lng!);
  }

  /** The pin moved: name wherever it landed. */
  async function onPin(la: number, ln: number) {
    setPinning(true);
    const label = await reverseGeocode(la, ln);
    setPinning(false);
    commit(label ?? t('pinned'), la, ln);
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          id="nc-address"
          value={value}
          onChange={(e) => onChange(e.target.value, null, null)}
          placeholder={t('placeholder')}
          autoComplete="off"
        />
        {searching && (
          <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Search results */}
      {hits.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-md border">
          {hits.map((h, i) => (
            <button
              key={`${h.lat},${h.lng},${i}`}
              type="button"
              onClick={() => commit(h.label, h.lat, h.lng)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{h.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={useHere}
          disabled={!hasFix}
          className="inline-flex min-h-touch items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          <Crosshair className="h-3.5 w-3.5" />
          {hasFix ? (hereLabel ? t('useHereNamed', { place: hereLabel }) : t('useHere')) : t('noFix')}
        </button>
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          className="inline-flex min-h-touch items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium"
        >
          {showMap ? <X className="h-3.5 w-3.5" /> : <MapIcon className="h-3.5 w-3.5" />}
          {showMap ? t('closeMap') : t('pickOnMap')}
        </button>
      </div>

      {showMap && (
        <div className="space-y-1">
          <PinMap
            lat={lat ?? (hasFix ? geo.lat : null)}
            lng={lng ?? (hasFix ? geo.lng : null)}
            onPick={onPin}
          />
          <p className="text-xs text-muted-foreground">
            {pinning ? t('naming') : t('mapHint')}
          </p>
        </div>
      )}

      {lat != null && lng != null && (
        <p className="text-xs text-muted-foreground">
          {t('located', { lat: lat.toFixed(5), lng: lng.toFixed(5) })}
        </p>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Polygon,
  Marker,
  Popup,
  useMap,
} from 'react-leaflet';
import { useTranslations } from 'next-intl';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Link } from '@/i18n/navigation';
import {
  dispositionCssColor,
  colorForDisposition,
  type DispositionColor,
} from '@/lib/visits/dispositions';
import { haversineMeters } from '@/lib/geo';
import type { DispositionType } from '@/types/database';

const ABIDJAN: [number, number] = [5.348, -4.008];

/**
 * "Ma position" control: centers on the rep's live GPS with a distinct marker
 * and accuracy circle. Keeps the current zoom so a wide view (hundreds of km)
 * is preserved when the map is zoomed out.
 */
function LocateControl() {
  const map = useMap();
  const markerRef = useRef<L.CircleMarker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    const control = new L.Control({ position: 'topright' });
    control.onAdd = () => {
      const btn = L.DomUtil.create('button', 'leaflet-bar') as HTMLButtonElement;
      btn.type = 'button';
      btn.title = 'Ma position';
      btn.setAttribute('aria-label', 'Ma position');
      btn.style.cssText =
        'width:36px;height:36px;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;border:none;';
      btn.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', () => {
        if (!navigator.geolocation) return;
        btn.style.opacity = '0.5';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            const ll = L.latLng(latitude, longitude);
            if (markerRef.current) map.removeLayer(markerRef.current);
            if (circleRef.current) map.removeLayer(circleRef.current);
            markerRef.current = L.circleMarker(ll, {
              radius: 8,
              color: '#fff',
              weight: 2,
              fillColor: '#1d4ed8',
              fillOpacity: 1,
            }).addTo(map);
            circleRef.current = L.circle(ll, {
              radius: accuracy,
              color: '#1d4ed8',
              weight: 1,
              fillColor: '#1d4ed8',
              fillOpacity: 0.1,
            }).addTo(map);
            // Center on the rep; keep current zoom so a wide (up to ~500 km) view stays.
            map.setView(ll, map.getZoom());
            btn.style.opacity = '1';
          },
          () => {
            btn.style.opacity = '1';
          },
          { enableHighAccuracy: true, timeout: 10000 },
        );
      });
      return btn;
    };
    control.addTo(map);
    return () => {
      control.remove();
      if (markerRef.current) map.removeLayer(markerRef.current);
      if (circleRef.current) map.removeLayer(circleRef.current);
    };
  }, [map]);

  return null;
}

export interface TurfKnock {
  id: string;
  lat: number;
  lng: number;
  disposition: DispositionType | null;
  /** Linked contact id — makes the spot popup entry a link to the contact. */
  contactId?: string | null;
  /** Linked contact name (may be null for a nameless lead). */
  name?: string | null;
  /** Linked contact lifecycle: 'lead' | 'customer' | 'lost'. */
  lifecycle?: string | null;
}

/** An installation job plotted on the map (square 🔧 marker, status colour). */
export interface InstallPoint {
  id: string;
  lat: number;
  lng: number;
  status: string;
  /** Pre-translated status label (rendered in the popup). */
  statusLabel: string;
  title?: string | null;
  contactId?: string | null;
  name?: string | null;
}

const INSTALL_COLORS: Record<string, string> = {
  pending: '#9ca3af',
  scheduled: '#3b82f6',
  in_progress: '#f59e0b',
  needs_revisit: '#f97316',
  done: '#16a34a',
};

/** Square wrench marker — visually distinct from the round knock dots. */
function installIcon(p: InstallPoint): L.DivIcon {
  const c = INSTALL_COLORS[p.status] ?? '#9ca3af';
  return L.divIcon({
    className: '',
    html: `<div style="width:24px;height:24px;border-radius:6px;background:${c};display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">🔧</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/** GeoJSON Polygon coords ([lng,lat]) → Leaflet positions ([lat,lng]). */
function toLatLngRing(coordinates: number[][][]): [number, number][] {
  return (coordinates[0] ?? []).map(([lng, lat]) => [lat, lng]);
}

type NamedContact = { contactId: string | null; name: string | null; lifecycle: string | null };

type Spot = {
  lat: number;
  lng: number;
  total: number;
  counts: Record<DispositionColor, number>;
  /** Distinct linked contacts (leads/customers) at this spot. */
  named: NamedContact[];
};

const COLOR_ORDER: DispositionColor[] = ['green', 'yellow', 'red', 'grey'];

/** Group knocks landing on the same spot (~11 m grid) for per-spot counts. */
function groupBySpot(knocks: TurfKnock[]): Spot[] {
  const map = new Map<
    string,
    {
      lat: number;
      lng: number;
      total: number;
      counts: Record<DispositionColor, number>;
      contacts: Map<string, NamedContact>;
    }
  >();
  for (const k of knocks) {
    if (k.lat == null || k.lng == null) continue;
    const key = `${k.lat.toFixed(4)},${k.lng.toFixed(4)}`;
    let g = map.get(key);
    if (!g) {
      g = {
        lat: k.lat,
        lng: k.lng,
        total: 0,
        counts: { grey: 0, red: 0, yellow: 0, green: 0 },
        contacts: new Map(),
      };
      map.set(key, g);
    }
    g.counts[colorForDisposition(k.disposition)]++;
    g.total++;
    // Any knock that links a contact contributes a popup entry (even nameless).
    const cid = k.contactId ?? null;
    const nm = k.name?.trim() || null;
    if (cid || nm) {
      const dedupe = cid ?? `name:${nm}`;
      if (!g.contacts.has(dedupe))
        g.contacts.set(dedupe, { contactId: cid, name: nm, lifecycle: k.lifecycle ?? null });
    }
  }
  return [...map.values()].map((g) => ({
    lat: g.lat,
    lng: g.lng,
    total: g.total,
    counts: g.counts,
    named: [...g.contacts.values()],
  }));
}

/** Pin colour for a contact's lifecycle (customer = won, lead = in-progress). */
function lifecycleColor(lifecycle: string | null): DispositionColor {
  if (lifecycle === 'customer') return 'green';
  if (lifecycle === 'lead') return 'yellow';
  if (lifecycle === 'lost') return 'red';
  return 'grey';
}

/** Dominant (most frequent) disposition colour, ties broken toward best outcome. */
function dominantColor(counts: Record<DispositionColor, number>): DispositionColor {
  let best: DispositionColor = 'grey';
  let bestN = -1;
  for (const c of COLOR_ORDER) {
    if (counts[c] > bestN) {
      bestN = counts[c];
      best = c;
    }
  }
  return best;
}

/** A numbered dot: count inside, coloured by the spot's dominant outcome. */
function spotIcon(spot: Spot): L.DivIcon {
  const color = dominantColor(spot.counts);
  const size = Math.round(22 + Math.min(spot.total - 1, 14) * 1.6);
  const text = color === 'yellow' ? '#111' : '#fff';
  const fs = Math.min(13, Math.round(9 + size / 6));
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${dispositionCssColor(
      color,
    )};color:${text};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${fs}px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${spot.total}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const FOCUS_RADIUS_KM = 15;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Bounds that frame the *main cluster* of points, ignoring far-flung outliers
 * (e.g. a knock logged with a stray GPS fix in another country). Without this,
 * a single distant point drags the auto-fit out to a whole-world view and the
 * map opens unfocused. Keeps points within 4× the median distance from the
 * median centre (min 3 km), so a real neighbourhood stays intact.
 */
function focusBounds(pts: [number, number][]): L.LatLngBounds | null {
  if (pts.length === 0) return null;
  if (pts.length <= 3) return L.latLngBounds(pts);
  const medLat = median(pts.map((p) => p[0]));
  const medLng = median(pts.map((p) => p[1]));
  const dists = pts.map((p) => haversineMeters(medLat, medLng, p[0], p[1]));
  const threshold = Math.max(median(dists) * 4, 3000);
  const inliers = pts.filter((_, i) => dists[i] <= threshold);
  return L.latLngBounds(inliers.length >= 2 ? inliers : pts);
}

/** A ~15 km-radius view box around a centre point. */
function focusBox(center: L.LatLng): L.LatLngBounds {
  const latDelta = FOCUS_RADIUS_KM / 111;
  const lngDelta =
    FOCUS_RADIUS_KM / (111 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)));
  return L.latLngBounds(
    [center.lat - latDelta, center.lng - lngDelta],
    [center.lat + latDelta, center.lng + lngDelta],
  );
}

/**
 * Opening view: frames the DATA (turfs, knocks, installations) at a ~15 km
 * minimum view — never the device position, so the map always opens on the
 * work, not on wherever the viewer happens to be. Outlier-robust (a stray GPS
 * fix can't drag the view out to world zoom); widens beyond 15 km when the
 * data itself is wider. The "Ma position" button recentres on live GPS on
 * demand. Runs once.
 */
function InitialView({
  polygons,
  knocks,
  installs = [],
}: {
  polygons: number[][][][];
  knocks: TurfKnock[];
  installs?: InstallPoint[];
}) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const pts: [number, number][] = [];
    polygons.forEach((poly) => toLatLngRing(poly).forEach((p) => pts.push(p)));
    knocks.forEach((k) => {
      if (k.lat != null && k.lng != null) pts.push([k.lat, k.lng]);
    });
    installs.forEach((p) => {
      if (p.lat != null && p.lng != null) pts.push([p.lat, p.lng]);
    });

    const bounds = focusBounds(pts);
    if (bounds) {
      // At least the 15 km box around the data's centre; wider if data is wider.
      map.fitBounds(focusBox(bounds.getCenter()).extend(bounds.pad(0.1)));
    } else {
      map.fitBounds(focusBox(L.latLng(ABIDJAN[0], ABIDJAN[1])));
    }
  }, [map, polygons, knocks, installs]);

  return null;
}

export default function TurfMap({
  polygons,
  knocks,
  installs = [],
  showLocate = true,
}: {
  polygons: number[][][][];
  knocks: TurfKnock[];
  installs?: InstallPoint[];
  showLocate?: boolean;
}) {
  const t = useTranslations('turf');
  const tLife = useTranslations('lifecycle');
  const tC = useTranslations('contacts');
  const spots = useMemo(() => groupBySpot(knocks), [knocks]);

  return (
    <div className="relative h-full w-full">
      <MapContainer center={ABIDJAN} zoom={13} minZoom={3} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {showLocate && <LocateControl />}
        {polygons.map((poly, i) => (
          <Polygon
            key={i}
            positions={toLatLngRing(poly)}
            pathOptions={{ color: 'hsl(var(--primary))', weight: 2, fillOpacity: 0.06 }}
          />
        ))}
        {spots.map((s, i) => (
          <Marker key={i} position={[s.lat, s.lng]} icon={spotIcon(s)}>
            <Popup>
              <div className="space-y-0.5 text-xs">
                <p className="font-semibold">{t('knocks', { count: s.total })}</p>
                {s.counts.green > 0 && <p>🟢 {t('legendGreen')}: {s.counts.green}</p>}
                {s.counts.yellow > 0 && <p>🟡 {t('legendYellow')}: {s.counts.yellow}</p>}
                {s.counts.red > 0 && <p>🔴 {t('legendRed')}: {s.counts.red}</p>}
                {s.counts.grey > 0 && <p>⚫ {t('legendGrey')}: {s.counts.grey}</p>}
                {s.named.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-t pt-1">
                    {s.named.map((n, j) => {
                      const dot = (
                        <span
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{ background: dispositionCssColor(lifecycleColor(n.lifecycle)) }}
                        />
                      );
                      const label = n.name ?? tC('noName');
                      const life = n.lifecycle ? (
                        <span className="text-[10px] text-gray-500">{tLife(n.lifecycle)}</span>
                      ) : null;
                      return n.contactId ? (
                        <Link
                          key={j}
                          href={`/contacts/${n.contactId}`}
                          className="flex items-center gap-1.5 text-primary"
                        >
                          {dot}
                          <span className="font-medium underline">{label}</span>
                          {life}
                        </Link>
                      ) : (
                        <p key={j} className="flex items-center gap-1.5">
                          {dot}
                          <span className="font-medium">{label}</span>
                          {life}
                        </p>
                      );
                    })}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        {installs.map((p) => (
          <Marker key={`ins-${p.id}`} position={[p.lat, p.lng]} icon={installIcon(p)}>
            <Popup>
              <div className="space-y-0.5 text-xs">
                <p className="font-semibold">🔧 {p.title || '—'}</p>
                <p className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: INSTALL_COLORS[p.status] ?? '#9ca3af' }}
                  />
                  {p.statusLabel}
                </p>
                {p.contactId ? (
                  <Link
                    href={`/contacts/${p.contactId}`}
                    className="font-medium text-primary underline"
                  >
                    {p.name ?? tC('noName')}
                  </Link>
                ) : (
                  p.name && <p className="font-medium">{p.name}</p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        <InitialView polygons={polygons} knocks={knocks} installs={installs} />
      </MapContainer>
    </div>
  );
}

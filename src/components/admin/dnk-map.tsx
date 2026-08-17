'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const ABIDJAN: [number, number] = [5.348, -4.008];

export interface DnkPoint {
  id: string;
  lat: number;
  lng: number;
  address: string | null;
  reason: string | null;
}

const dnkIcon = L.divIcon({
  className: '',
  html: '<div style="width:26px;height:26px;border-radius:50%;background:#dc2626;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">🚫</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

const pendingIcon = L.divIcon({
  className: '',
  html: '<div style="width:26px;height:26px;border-radius:50%;background:#f59e0b;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">＋</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function ClickCatcher({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

function InitialView({ entries }: { entries: DnkPoint[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (entries.length > 0) {
      map.fitBounds(L.latLngBounds(entries.map((e) => [e.lat, e.lng])).pad(0.3));
    } else {
      map.setView(ABIDJAN, 12);
    }
  }, [map, entries]);
  return null;
}

/** Admin map: existing DNK points (red, 20 m circles) + click to place a new one. */
export default function DnkMap({
  entries,
  pending,
  onPick,
}: {
  entries: DnkPoint[];
  pending: { lat: number; lng: number } | null;
  onPick: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer center={ABIDJAN} zoom={12} minZoom={3} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickCatcher onPick={onPick} />
      {entries.map((e) => (
        <Marker key={e.id} position={[e.lat, e.lng]} icon={dnkIcon}>
          <Popup>
            <div className="text-xs">
              <p className="font-semibold">🚫 {e.address ?? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`}</p>
              {e.reason && <p>{e.reason}</p>}
            </div>
          </Popup>
        </Marker>
      ))}
      {entries.map((e) => (
        <Circle
          key={`c-${e.id}`}
          center={[e.lat, e.lng]}
          radius={20}
          pathOptions={{ color: '#dc2626', weight: 1, fillOpacity: 0.15 }}
        />
      ))}
      {pending && <Marker position={[pending.lat, pending.lng]} icon={pendingIcon} />}
      <InitialView entries={entries} />
    </MapContainer>
  );
}

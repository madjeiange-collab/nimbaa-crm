'use client';

import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const ABIDJAN: [number, number] = [5.348, -4.008];

/** Leaflet's default icon URLs break under bundlers; draw our own pin. */
const PIN = L.divIcon({
  className: '',
  html:
    '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;' +
    'background:#3E7B27;border:3px solid #fff;transform:rotate(-45deg);' +
    'box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

/** Keeps the view on the pin when the parent moves it (search, my position). */
function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const last = useRef<string>('');
  useEffect(() => {
    const key = `${lat},${lng}`;
    if (key === last.current) return;
    last.current = key;
    map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }, [lat, lng, map]);
  return null;
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/**
 * Drop a pin on the map: tap anywhere, or drag the pin. The parent turns the
 * coordinates into an address — this component only reports where.
 */
export default function PinMap({
  lat,
  lng,
  onPick,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
}) {
  const center: [number, number] = lat != null && lng != null ? [lat, lng] : ABIDJAN;
  return (
    <MapContainer
      center={center}
      zoom={lat != null ? 16 : 13}
      style={{ height: 260, width: '100%', borderRadius: 8 }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickToPlace onPick={onPick} />
      {lat != null && lng != null && (
        <>
          <Recenter lat={lat} lng={lng} />
          <Marker
            position={[lat, lng]}
            icon={PIN}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const p = (e.target as L.Marker).getLatLng();
                onPick(p.lat, p.lng);
              },
            }}
          />
        </>
      )}
    </MapContainer>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { Polygon as GeoJSONPolygon } from 'geojson';

// Abidjan — default map center.
const ABIDJAN: [number, number] = [5.348, -4.008];

type DrawApi = { start: () => void; clear: () => void };

/**
 * Drives leaflet-draw polygon drawing imperatively so we can trigger it from
 * our own big French buttons (the default toolbar is a tiny English icon —
 * unusable on a phone in the field). Draws a single polygon; drawing again
 * replaces it.
 */
function DrawLayer({
  onChange,
  apiRef,
  onDrawnChange,
}: {
  onChange: (geometry: GeoJSONPolygon | null) => void;
  apiRef: React.MutableRefObject<DrawApi | null>;
  onDrawnChange: (hasPolygon: boolean) => void;
}) {
  const map = useMap();

  useEffect(() => {
    // French prompts during drawing.
    L.drawLocal.draw.handlers.polygon.tooltip.start = 'Touchez la carte pour commencer.';
    L.drawLocal.draw.handlers.polygon.tooltip.cont = 'Touchez pour ajouter un coin.';
    L.drawLocal.draw.handlers.polygon.tooltip.end =
      'Touchez le premier point pour fermer le secteur.';
    L.drawLocal.draw.toolbar.finish.text = 'Terminer';
    L.drawLocal.draw.toolbar.undo.text = 'Effacer le dernier point';
    L.drawLocal.draw.toolbar.actions.text = 'Annuler';

    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);
    let handler: L.Draw.Polygon | null = null;

    const emit = () => {
      const layers = drawnItems.getLayers();
      if (layers.length > 0) {
        const gj = (layers[0] as L.Polygon).toGeoJSON();
        onChange(gj.geometry as GeoJSONPolygon);
        onDrawnChange(true);
      } else {
        onChange(null);
        onDrawnChange(false);
      }
    };

    const onCreated = (e: L.LeafletEvent) => {
      const layer = (e as unknown as { layer: L.Layer }).layer;
      drawnItems.clearLayers(); // single polygon only
      drawnItems.addLayer(layer);
      emit();
    };

    map.on(L.Draw.Event.CREATED, onCreated);
    map.on(L.Draw.Event.EDITED, emit);
    map.on(L.Draw.Event.DELETED, emit);

    apiRef.current = {
      start() {
        handler?.disable();
        handler = new L.Draw.Polygon(map as L.DrawMap, {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: '#1d4ed8', weight: 3 },
        });
        handler.enable();
      },
      clear() {
        handler?.disable();
        handler = null;
        drawnItems.clearLayers();
        emit();
      },
    };

    return () => {
      map.off(L.Draw.Event.CREATED, onCreated);
      map.off(L.Draw.Event.EDITED, emit);
      map.off(L.Draw.Event.DELETED, emit);
      handler?.disable();
      map.removeLayer(drawnItems);
      apiRef.current = null;
    };
  }, [map, onChange, apiRef, onDrawnChange]);

  return null;
}

export default function LeafletDrawMap({
  onChange,
}: {
  onChange: (geometry: GeoJSONPolygon | null) => void;
}) {
  const apiRef = useRef<DrawApi | null>(null);
  const [hasPolygon, setHasPolygon] = useState(false);

  return (
    <div className="relative h-full w-full">
      <MapContainer center={ABIDJAN} zoom={12} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <DrawLayer onChange={onChange} apiRef={apiRef} onDrawnChange={setHasPolygon} />
      </MapContainer>

      {/* Big, obvious, French controls overlaid on the map */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-col gap-2 p-2">
        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            onClick={() => apiRef.current?.start()}
            className="min-h-touch flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md active:opacity-90"
          >
            ✏️ Dessiner le secteur
          </button>
          <button
            type="button"
            onClick={() => apiRef.current?.clear()}
            className="min-h-touch rounded-lg bg-background/95 px-4 py-2 text-sm font-semibold text-foreground shadow-md active:opacity-90"
          >
            🗑️ Effacer
          </button>
        </div>
        <p className="pointer-events-auto self-start rounded-md bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow">
          {hasPolygon
            ? '✅ Secteur dessiné. Nommez-le et enregistrez, ou « Effacer » pour recommencer.'
            : 'Touchez « Dessiner le secteur », posez chaque coin sur la carte, puis fermez sur le premier point.'}
        </p>
      </div>
    </div>
  );
}

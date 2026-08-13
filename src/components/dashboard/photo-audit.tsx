'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';
import { RepMultiFilter, TerritoryFilter } from '@/components/dashboard/rep-multi-filter';
import { pointInAnyPolygon } from '@/lib/geo';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface PhotoItem {
  id: string;
  url: string;
  repId: string;
  repName: string;
  disposition: string | null;
  at: string;
  lat: number | null;
  lng: number | null;
}

export interface PhotoTerritory {
  id: string;
  name: string;
  coordinates: number[][][];
}

function fmt(s: string) {
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(s),
    );
  } catch {
    return s;
  }
}

export function PhotoAudit({
  items,
  territories,
}: {
  items: PhotoItem[];
  territories: PhotoTerritory[];
}) {
  const t = useTranslations('dashboard');
  const tDisp = useTranslations('dispositions');
  const [repIds, setRepIds] = useState<string[]>([]);
  const [terrIds, setTerrIds] = useState<string[]>([]);

  const reps = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((i) => m.set(i.repId, i.repName));
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [items]);

  const selectedPolys = useMemo(
    () =>
      territories
        .filter((tr) => terrIds.length === 0 || terrIds.includes(tr.id))
        .map((tr) => tr.coordinates),
    [territories, terrIds],
  );

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          (repIds.length === 0 || repIds.includes(i.repId)) &&
          (terrIds.length === 0 ||
            (i.lat != null && i.lng != null && pointInAnyPolygon(i.lat, i.lng, selectedPolys))),
      ),
    [items, repIds, terrIds, selectedPolys],
  );

  function exportCsv() {
    downloadCsv('audit-photos.csv', [
      ['Commercial', 'Date', 'Résultat'],
      ...filtered.map((i) => [i.repName, fmt(i.at), i.disposition ?? '']),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <RepMultiFilter reps={reps} selected={repIds} onChange={setRepIds} />
          <TerritoryFilter territories={territories} selected={terrIds} onChange={setTerrIds} />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="self-end"
          onClick={exportCsv}
          disabled={filtered.length === 0}
        >
          <Download className="h-4 w-4" /> {t('exportCsv')}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{t('noPhotos')}</Card>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filtered.map((i) => (
            <a key={i.id} href={i.url} target="_blank" rel="noreferrer" className="block">
              <Card className="overflow-hidden">
                <div className="aspect-square w-full bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </div>
                <div className="p-2 text-xs">
                  <p className="truncate font-medium">{i.repName}</p>
                  <p className="text-muted-foreground">{fmt(i.at)}</p>
                  {i.disposition && (
                    <p className="text-muted-foreground">{tDisp(i.disposition as never)}</p>
                  )}
                </div>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

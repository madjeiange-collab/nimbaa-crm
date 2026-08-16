'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, ChevronDown } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';
import { RepMultiFilter, TechMultiFilter, TerritoryFilter } from '@/components/dashboard/rep-multi-filter';
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
  /** Optional caption (e.g. the customer name for installation photos). */
  subtitle?: string | null;
}

export interface PhotoTerritory {
  id: string;
  name: string;
  coordinates: number[][][];
}

type GroupBy = 'day' | 'month' | 'rep';

function fmt(s: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(s),
    );
  } catch {
    return s;
  }
}

/** Group key + display label + sortable string for a photo under a grouping. */
function groupOf(i: PhotoItem, mode: GroupBy, locale: string): { key: string; label: string; sort: string } {
  if (mode === 'rep') {
    return { key: i.repId || '—', label: i.repName || '—', sort: (i.repName || '').toLowerCase() };
  }
  const d = new Date(i.at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  if (mode === 'month') {
    const key = `${y}-${m}`;
    const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d);
    return { key, label, sort: key };
  }
  const day = String(d.getDate()).padStart(2, '0');
  const key = `${y}-${m}-${day}`;
  const label = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
  return { key, label, sort: key };
}

export function PhotoAudit({
  items,
  territories,
  variant = 'commercial',
}: {
  items: PhotoItem[];
  territories: PhotoTerritory[];
  /** 'technician' swaps the person filter + labels for installation photos. */
  variant?: 'commercial' | 'technician';
}) {
  const t = useTranslations('dashboard');
  const tDisp = useTranslations('dispositions');
  const locale = useLocale();
  const isTech = variant === 'technician';
  const [repIds, setRepIds] = useState<string[]>([]);
  const [terrIds, setTerrIds] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; sort: string; items: PhotoItem[] }>();
    for (const i of filtered) {
      const { key, label, sort } = groupOf(i, groupBy, locale);
      let g = m.get(key);
      if (!g) {
        g = { label, sort, items: [] };
        m.set(key, g);
      }
      g.items.push(i);
    }
    const arr = [...m.entries()].map(([key, g]) => ({ key, ...g }));
    // Dates: newest first. Reps: alphabetical.
    arr.sort((a, b) => (groupBy === 'rep' ? a.sort.localeCompare(b.sort) : b.sort.localeCompare(a.sort)));
    return arr;
  }, [filtered, groupBy, locale]);

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportCsv() {
    downloadCsv('audit-photos.csv', [
      isTech ? ['Technicien', 'Client', 'Date'] : ['Commercial', 'Date', 'Résultat'],
      ...filtered.map((i) =>
        isTech
          ? [i.repName, i.subtitle ?? '', fmt(i.at, locale)]
          : [i.repName, fmt(i.at, locale), i.disposition ?? ''],
      ),
    ]);
  }

  const modes: { key: GroupBy; label: string }[] = [
    { key: 'day', label: t('groupByDay') },
    { key: 'month', label: t('groupByMonth') },
    { key: 'rep', label: isTech ? t('groupByTechnician') : t('groupByRep') },
  ];

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          {isTech ? (
            <TechMultiFilter technicians={reps} selected={repIds} onChange={setRepIds} />
          ) : (
            <RepMultiFilter reps={reps} selected={repIds} onChange={setRepIds} />
          )}
          <TerritoryFilter territories={territories} selected={terrIds} onChange={setTerrIds} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('groupBy')}</span>
          <div className="flex gap-1">
            {modes.map((mo) => (
              <button
                key={mo.key}
                onClick={() => setGroupBy(mo.key)}
                className={`min-h-touch whitespace-nowrap rounded-lg px-3 text-sm font-medium ${
                  groupBy === mo.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground'
                }`}
              >
                {mo.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="h-4 w-4" /> {t('exportCsv')}
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{t('noPhotos')}</Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const open = !collapsed.has(g.key);
            return (
              <div key={g.key} className="space-y-2">
                <button
                  onClick={() => toggle(g.key)}
                  className="sticky top-14 z-[1] flex w-full items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-left backdrop-blur"
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
                  />
                  <span className="font-semibold capitalize">{g.label}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {t('photosCount', { n: g.items.length })}
                  </span>
                </button>
                {open && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {g.items.map((i) => (
                      <a key={i.id} href={i.url} target="_blank" rel="noreferrer" className="block">
                        <Card className="overflow-hidden">
                          <div className="aspect-square w-full bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={i.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                          </div>
                          <div className="p-2 text-xs">
                            <p className="truncate font-medium">{i.repName}</p>
                            {i.subtitle && <p className="truncate text-muted-foreground">{i.subtitle}</p>}
                            <p className="text-muted-foreground">{fmt(i.at, locale)}</p>
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
          })}
        </div>
      )}
    </div>
  );
}

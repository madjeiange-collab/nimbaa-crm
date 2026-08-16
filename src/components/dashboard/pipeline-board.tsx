'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { DealStatus } from '@/types/database';
import { downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { RepMultiFilter, TerritoryFilter } from '@/components/dashboard/rep-multi-filter';

export interface PipelineDeal {
  id: string;
  contactId: string;
  name: string | null; // customer
  title: string | null; // free-text label
  product: string | null; // portfolio product name
  value: number | null;
  stageId: string | null;
  status: DealStatus;
  wonAt: string | null; // when the deal was won (for the won-date filter)
  repId: string | null;
  repName: string | null;
  territoryId: string | null;
}

export type WonPeriod = 'all' | 'week' | 'month';
export interface PipelineStage {
  id: string;
  name: string;
}
export interface PipelineRep {
  id: string;
  name: string;
}
export interface PipelineTerritory {
  id: string;
  name: string;
}

type StatusFilter = 'all' | DealStatus;

export function PipelineBoard({
  deals,
  stages,
  reps,
  territories,
  initialStatus = 'all',
  initialRepIds = [],
  initialTerrIds = [],
  initialWonPeriod = 'all',
}: {
  deals: PipelineDeal[];
  stages: PipelineStage[];
  reps: PipelineRep[];
  territories: PipelineTerritory[];
  initialStatus?: StatusFilter;
  initialRepIds?: string[];
  initialTerrIds?: string[];
  initialWonPeriod?: WonPeriod;
}) {
  const t = useTranslations('dashboard');
  const tD = useTranslations('deals');
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [repIds, setRepIds] = useState<string[]>(initialRepIds);
  const [terrIds, setTerrIds] = useState<string[]>(initialTerrIds);
  const [wonPeriod, setWonPeriod] = useState<WonPeriod>(initialWonPeriod);

  const filtered = useMemo(() => {
    // Won-date cutoff (only constrains won deals; open/lost are unaffected).
    const cutoff =
      wonPeriod === 'week'
        ? Date.now() - 7 * 864e5
        : wonPeriod === 'month'
          ? Date.now() - 30 * 864e5
          : null;
    return deals.filter(
      (d) =>
        (status === 'all' || d.status === status) &&
        (repIds.length === 0 || (!!d.repId && repIds.includes(d.repId))) &&
        (terrIds.length === 0 || (!!d.territoryId && terrIds.includes(d.territoryId))) &&
        (cutoff === null ||
          d.status !== 'won' ||
          (!!d.wonAt && new Date(d.wonAt).getTime() >= cutoff)),
    );
  }, [deals, status, repIds, terrIds, wonPeriod]);

  const byStage = useMemo(() => {
    const m = new Map<string, PipelineDeal[]>();
    for (const s of stages) m.set(s.id, []);
    for (const d of filtered) if (d.stageId && m.has(d.stageId)) m.get(d.stageId)!.push(d);
    return m;
  }, [filtered, stages]);

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: tD('filterAll') },
    { key: 'open', label: tD('status_open') },
    { key: 'won', label: tD('status_won') },
    { key: 'lost', label: tD('status_lost') },
  ];

  function exportCsv() {
    const stageName = new Map(stages.map((s) => [s.id, s.name]));
    downloadCsv('pipeline.csv', [
      ['Affaire', 'Client', 'Commercial', 'Statut', 'Étape', 'Valeur XOF'],
      ...filtered.map((d) => [
        d.product ?? d.title ?? '',
        d.name ?? '',
        d.repName ?? '',
        d.status,
        d.stageId ? (stageName.get(d.stageId) ?? '') : '',
        d.value ?? '',
      ]),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setStatus(tb.key)}
              className={`min-h-touch whitespace-nowrap rounded-lg px-3 text-sm font-medium ${
                status === tb.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv}>
          <Download className="h-4 w-4" /> {t('exportCsv')}
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <RepMultiFilter reps={reps} selected={repIds} onChange={setRepIds} />
        <TerritoryFilter territories={territories} selected={terrIds} onChange={setTerrIds} />
      </div>

      {/* Won-date filter — narrows won deals to a recent period. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{tD('wonPeriodLabel')}</span>
        <div className="flex gap-1">
          {(['all', 'week', 'month'] as WonPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setWonPeriod(p)}
              className={`min-h-touch whitespace-nowrap rounded-lg px-3 text-sm font-medium ${
                wonPeriod === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {tD(p === 'all' ? 'wonAll' : p === 'week' ? 'wonWeek' : 'wonMonth')}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((s) => {
          const items = byStage.get(s.id) ?? [];
          return (
            <div key={s.id} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">{s.name}</p>
                <span className="rounded bg-secondary px-1.5 text-xs font-medium text-secondary-foreground">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((d) => (
                  <Link key={d.id} href={`/contacts/${d.contactId}`} className="block">
                    <div className="rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:bg-accent">
                      <p className="truncate text-sm font-medium">{d.product ?? d.title ?? tD('untitled')}</p>
                      <p className="truncate text-xs text-muted-foreground">{d.name ?? '—'}</p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        {d.value != null ? <span>{d.value.toLocaleString('fr-FR')} XOF</span> : <span />}
                        {d.repName && <span className="truncate">{d.repName}</span>}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

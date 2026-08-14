'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ContactLifecycle, PriorityLevel } from '@/types/database';
import { downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { RepMultiFilter, TerritoryFilter } from '@/components/dashboard/rep-multi-filter';

export interface PipelineContact {
  id: string;
  name: string | null;
  lifecycle: ContactLifecycle;
  priority: PriorityLevel;
  stageId: string | null;
  value: number | null;
  repId: string | null;
  repName: string | null;
  territoryId: string | null;
}
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

type LifeFilter = 'all' | ContactLifecycle;

const PRIORITY_DOT: Record<PriorityLevel, string> = {
  vip: 'bg-brand-amber',
  high: 'bg-brand-amber/70',
  medium: 'bg-muted-foreground/40',
  low: 'bg-muted-foreground/20',
};

export function PipelineBoard({
  contacts,
  stages,
  reps,
  territories,
  initialLife = 'all',
}: {
  contacts: PipelineContact[];
  stages: PipelineStage[];
  reps: PipelineRep[];
  territories: PipelineTerritory[];
  initialLife?: LifeFilter;
}) {
  const t = useTranslations('dashboard');
  const tC = useTranslations('contacts');
  const tLife = useTranslations('lifecycle');
  const [life, setLife] = useState<LifeFilter>(initialLife);
  const [repIds, setRepIds] = useState<string[]>([]);
  const [terrIds, setTerrIds] = useState<string[]>([]);

  const filtered = useMemo(
    () =>
      contacts.filter(
        (c) =>
          (life === 'all' || c.lifecycle === life) &&
          (repIds.length === 0 || (!!c.repId && repIds.includes(c.repId))) &&
          (terrIds.length === 0 || (!!c.territoryId && terrIds.includes(c.territoryId))),
      ),
    [contacts, life, repIds, terrIds],
  );

  const byStage = useMemo(() => {
    const m = new Map<string, PipelineContact[]>();
    for (const s of stages) m.set(s.id, []);
    for (const c of filtered) {
      if (c.stageId && m.has(c.stageId)) m.get(c.stageId)!.push(c);
    }
    return m;
  }, [filtered, stages]);

  const tabs: { key: LifeFilter; label: string }[] = [
    { key: 'all', label: tC('tabAll') },
    { key: 'lead', label: tC('tabLeads') },
    { key: 'customer', label: tC('tabCustomers') },
    { key: 'lost', label: tC('tabLost') },
  ];

  function exportCsv() {
    const stageName = new Map(stages.map((s) => [s.id, s.name]));
    downloadCsv('pipeline.csv', [
      ['Nom', 'Commercial', 'Cycle', 'Étape', 'Priorité', 'Valeur XOF'],
      ...filtered.map((c) => [
        c.name ?? '',
        c.repName ?? '',
        c.lifecycle,
        c.stageId ? (stageName.get(c.stageId) ?? '') : '',
        c.priority,
        c.value ?? '',
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
              onClick={() => setLife(tb.key)}
              className={`min-h-touch whitespace-nowrap rounded-lg px-3 text-sm font-medium ${
                life === tb.key
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
                {items.map((c) => (
                  <Link key={c.id} href={`/contacts/${c.id}`} className="block">
                    <div className="rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:bg-accent">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[c.priority]}`} />
                        <p className="truncate text-sm font-medium">{c.name ?? tC('noName')}</p>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{tLife(c.lifecycle)}</span>
                        {c.value != null && <span>{c.value.toLocaleString('fr-FR')} XOF</span>}
                      </div>
                      {c.repName && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                          {c.repName}
                        </p>
                      )}
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

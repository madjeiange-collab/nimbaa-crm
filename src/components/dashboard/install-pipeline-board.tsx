'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { downloadCsv } from '@/lib/csv';
import { pointInAnyPolygon } from '@/lib/geo';
import { Button } from '@/components/ui/button';
import { TechMultiFilter, TerritoryFilter } from '@/components/dashboard/rep-multi-filter';
import { INSTALL_STATUSES, INSTALL_STATUS_BADGE } from '@/lib/installations/protocol';
import type { ManagerInstallRow, ManagerTerritory } from '@/lib/installations/manager-data';

export function InstallPipelineBoard({
  installations,
  technicians,
  territories,
  initialTechIds = [],
}: {
  installations: ManagerInstallRow[];
  technicians: { id: string; name: string }[];
  initialTechIds?: string[];
  territories: ManagerTerritory[];
}) {
  const t = useTranslations('dashboard');
  const tInstall = useTranslations('installation');
  const tStatus = useTranslations('installation.status');
  const [techIds, setTechIds] = useState<string[]>(initialTechIds);
  const [terrIds, setTerrIds] = useState<string[]>([]);

  const nameOf = useMemo(() => new Map(technicians.map((tt) => [tt.id, tt.name])), [technicians]);

  const selectedPolys = useMemo(
    () => territories.filter((tr) => terrIds.length === 0 || terrIds.includes(tr.id)).map((tr) => tr.coordinates),
    [territories, terrIds],
  );

  const filtered = useMemo(
    () =>
      installations.filter(
        (r) =>
          (techIds.length === 0 || (!!r.installerId && techIds.includes(r.installerId))) &&
          (terrIds.length === 0 || (r.lat != null && r.lng != null && pointInAnyPolygon(r.lat, r.lng, selectedPolys))),
      ),
    [installations, techIds, terrIds, selectedPolys],
  );

  const byStatus = useMemo(() => {
    const m = new Map<string, ManagerInstallRow[]>();
    for (const s of INSTALL_STATUSES) m.set(s.key, []);
    for (const r of filtered) m.get(r.status)?.push(r);
    return m;
  }, [filtered]);

  function exportCsv() {
    downloadCsv('installations.csv', [
      ['Client', 'Installation', 'Technicien', 'Statut', 'Date'],
      ...filtered.map((r) => [
        r.contactName ?? '',
        r.title ?? '',
        r.installerId ? (nameOf.get(r.installerId) ?? '') : '',
        r.status,
        r.nextVisitDate ?? r.scheduledDate ?? '',
      ]),
    ]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <TechMultiFilter technicians={technicians} selected={techIds} onChange={setTechIds} />
        <TerritoryFilter territories={territories} selected={terrIds} onChange={setTerrIds} />
        <Button variant="outline" size="sm" className="sm:ml-auto" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" /> {t('exportCsv')}
        </Button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {INSTALL_STATUSES.map((s) => {
          const items = byStatus.get(s.key) ?? [];
          return (
            <div key={s.key} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${INSTALL_STATUS_BADGE[s.color]}`}>
                  {tStatus(s.i18n)}
                </span>
                <span className="rounded bg-secondary px-1.5 text-xs font-medium text-secondary-foreground">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((r) => {
                  const when = r.nextVisitDate ?? r.scheduledDate;
                  return (
                    <Link
                      key={r.id}
                      href={r.contactId ? `/contacts/${r.contactId}` : '/installs'}
                      className="block"
                    >
                      <div className="rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:bg-accent">
                        <p className="truncate text-sm font-medium">{r.contactName ?? '—'}</p>
                        {r.title && <p className="truncate text-xs text-muted-foreground">{r.title}</p>}
                        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="truncate">
                            {r.installerId ? (nameOf.get(r.installerId) ?? '—') : tInstall('unassignedTech')}
                          </span>
                          {when && <span className="shrink-0">{when}</span>}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

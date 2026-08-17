'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, RotateCcw, ArrowUp, ArrowDown, Minus, KanbanSquare, Images } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { StatTile } from '@/components/charts/stat-tile';
import { BarDays } from '@/components/charts/bar-days';
import { Donut } from '@/components/charts/donut';
import { Funnel } from '@/components/charts/funnel';
import { CoverageMap } from '@/components/charts/coverage-map';
import { TechMultiFilter, TerritoryFilter } from '@/components/dashboard/rep-multi-filter';
import { pointInAnyPolygon } from '@/lib/geo';
import { Card, CardContent } from '@/components/ui/card';
import { INSTALL_STATUSES } from '@/lib/installations/protocol';
import type { InstallStatus } from '@/types/database';
import type { InstallPoint } from '@/components/map/turf-map';
import type { ManagerInstallRow, ManagerTerritory } from '@/lib/installations/manager-data';

const STATUS_CSS: Record<string, string> = {
  grey: 'hsl(var(--knock-grey))',
  blue: 'hsl(217 91% 60%)',
  amber: 'hsl(var(--brand-amber))',
  green: 'hsl(var(--knock-green))',
};

/** Rich, filterable team-wide installation statistics for managers. */
export function TechnicianTeamStats({
  nowIso,
  installations,
  technicians,
  territories,
  showNav = true,
}: {
  nowIso: string;
  installations: ManagerInstallRow[];
  technicians: { id: string; name: string }[];
  territories: ManagerTerritory[];
  /** Show the nav cards to the pipeline + photo sub-pages (manager area only). */
  showNav?: boolean;
}) {
  const t = useTranslations('installation');
  const tStatus = useTranslations('installation.status');
  const tS = useTranslations('stats');
  const tD = useTranslations('dashboard');
  const tDeals = useTranslations('deals');

  const [techIds, setTechIds] = useState<string[]>([]);
  const [terrIds, setTerrIds] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const selectedTerrs = useMemo(
    () => territories.filter((tr) => terrIds.length === 0 || terrIds.includes(tr.id)),
    [territories, terrIds],
  );
  const selectedPolys = useMemo(() => selectedTerrs.map((tr) => tr.coordinates), [selectedTerrs]);
  const selectedTerrNames = useMemo(() => selectedTerrs.map((tr) => tr.name), [selectedTerrs]);

  // Branch (type d'activité) + tag filters via the installation's linked deal.
  const typeOptions = useMemo(
    () =>
      [...new Set(installations.map((r) => r.businessType).filter((v): v is string => !!v))].sort(),
    [installations],
  );
  const tagOptions = useMemo(
    () => [...new Set(installations.flatMap((r) => r.tags))].sort(),
    [installations],
  );

  const rows = useMemo(
    () =>
      installations.filter(
        (r) =>
          (techIds.length === 0 || (!!r.installerId && techIds.includes(r.installerId))) &&
          (terrIds.length === 0 || (r.lat != null && r.lng != null && pointInAnyPolygon(r.lat, r.lng, selectedPolys))) &&
          (typeFilter === '' || r.businessType === typeFilter) &&
          (tagFilter === '' || r.tags.includes(tagFilter)),
      ),
    [installations, techIds, terrIds, selectedPolys, typeFilter, tagFilter],
  );

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d7 = new Date(now.getTime() - 7 * 864e5);
  const d14 = new Date(now.getTime() - 14 * 864e5);

  const total = rows.length;
  const countStatus = (s: InstallStatus) => rows.filter((r) => r.status === s).length;
  const pending = countStatus('pending') + countStatus('scheduled');
  const inProgress = countStatus('in_progress');
  const revisits = countStatus('needs_revisit');
  const doneAll = countStatus('done');
  const started = rows.filter((r) => ['in_progress', 'needs_revisit', 'done'].includes(r.status)).length;
  const completionRate = total > 0 ? Math.round((doneAll / total) * 100) : 0;

  const done = rows.filter((r) => r.status === 'done' && r.completedAt);
  const doneInWin = (from: Date, to?: Date) =>
    done.filter((r) => {
      const at = new Date(r.completedAt as string);
      return at >= from && (!to || at < to);
    }).length;
  const doneToday = doneInWin(startToday);
  const doneWeek = doneInWin(d7);
  const donePrevWeek = doneInWin(d14, d7);
  const wowDelta = doneWeek - donePrevWeek;

  const trend = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now.getTime() - (29 - i) * 864e5);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return { label: '', value: doneInWin(start, new Date(start.getTime() + 864e5)) };
  });

  const donutSegs = INSTALL_STATUSES.map((s) => ({
    label: tStatus(s.i18n),
    value: countStatus(s.key),
    color: STATUS_CSS[s.color] ?? STATUS_CSS.grey,
  })).filter((s) => s.value > 0);

  const nameOf = useMemo(() => new Map(technicians.map((tech) => [tech.id, tech.name])), [technicians]);
  const perTech = useMemo(() => {
    // When filtering to specific technicians, only show those; else all.
    const ids = techIds.length > 0 ? techIds : technicians.map((tt) => tt.id);
    return ids
      .map((id) => {
        const mine = rows.filter((r) => r.installerId === id);
        return {
          name: nameOf.get(id) ?? '—',
          done7d: mine.filter((r) => r.status === 'done' && r.completedAt && new Date(r.completedAt) >= d7).length,
          open: mine.filter((r) => r.status !== 'done').length,
          revisits: mine.filter((r) => r.status === 'needs_revisit').length,
        };
      })
      .sort((a, b) => b.done7d - a.done7d || b.open - a.open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, techIds, technicians, nameOf]);
  const maxDone = Math.max(1, ...perTech.map((p) => p.done7d));

  const upcoming = rows
    .filter((r) => r.status === 'scheduled' || r.status === 'needs_revisit')
    .map((r) => ({
      id: r.id,
      contactId: r.contactId,
      name: r.contactName ?? '—',
      title: r.title,
      when: r.nextVisitDate ?? r.scheduledDate,
      revisit: r.status === 'needs_revisit',
    }))
    .filter((r) => r.when)
    .sort((a, b) => (a.when! < b.when! ? -1 : 1))
    .slice(0, 8);

  const mapPoints: InstallPoint[] = rows
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({
      id: r.id,
      lat: r.lat as number,
      lng: r.lng as number,
      status: r.status,
      statusLabel: tStatus(r.status as InstallStatus),
      title: r.title,
      contactId: r.contactId,
      name: r.contactName,
    }));

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <TechMultiFilter technicians={technicians} selected={techIds} onChange={setTechIds} />
        <TerritoryFilter territories={territories} selected={terrIds} onChange={setTerrIds} />
      </div>

      {/* Branch (type d'activité) + tag filters via the linked deals */}
      {(typeOptions.length > 0 || tagOptions.length > 0) && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {typeOptions.length > 0 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label={tDeals('businessType')}
              className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm sm:w-56"
            >
              <option value="">{tDeals('allTypes')}</option>
              {typeOptions.map((ty) => (
                <option key={ty} value={ty}>
                  {ty}
                </option>
              ))}
            </select>
          )}
          {tagOptions.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label={tDeals('tags')}
              className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm sm:w-56"
            >
              <option value="">{tDeals('allTags')}</option>
              {tagOptions.map((tg) => (
                <option key={tg} value={tg}>
                  {tg}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Nav to sub-pages */}
      {showNav && (
        <div className="grid grid-cols-2 gap-2">
          <Link href="/dashboard/install-pipeline" className="block">
            <Card className="flex flex-col items-center gap-1.5 p-3 text-center transition-colors hover:bg-accent">
              <KanbanSquare className="h-6 w-6 text-primary" />
              <span className="text-xs font-medium">{tD('installPipeline')}</span>
            </Card>
          </Link>
          <Link href="/dashboard/install-photos" className="block">
            <Card className="flex flex-col items-center gap-1.5 p-3 text-center transition-colors hover:bg-accent">
              <Images className="h-6 w-6 text-primary" />
              <span className="text-xs font-medium">{tD('installPhotos')}</span>
            </Card>
          </Link>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={t('kpiPending')} value={pending} accent="primary" href="/installs" />
        <StatTile label={t('status.in_progress')} value={inProgress} accent="amber" href="/installs" />
        <StatTile label={t('kpiDoneWeek')} value={doneWeek} accent="green" />
        <StatTile label={t('kpiRevisits')} value={revisits} accent="red" href="/installs" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatTile label={t('kpiTotal')} value={total} accent="muted" />
        <StatTile label={t('kpiDoneAll')} value={doneAll} accent="green" />
        <StatTile label={t('completionRate')} value={`${completionRate}%`} accent="primary" />
      </div>

      {/* Momentum */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{tS('momentum')}</p>
            <span
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${
                wowDelta > 0
                  ? 'bg-knock-green/15 text-knock-green'
                  : wowDelta < 0
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {wowDelta > 0 ? <ArrowUp className="h-3 w-3" /> : wowDelta < 0 ? <ArrowDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {wowDelta > 0 ? '+' : ''}
              {wowDelta} {tS('vsLastWeek')}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label={tS('today')} value={doneToday} />
            <StatTile label={tS('thisWeek')} value={doneWeek} accent="green" />
            <StatTile label={tS('lastWeek')} value={donePrevWeek} accent="muted" />
          </div>
          <div>
            <p className="mb-1 text-xs text-muted-foreground">{t('doneTrend')}</p>
            <BarDays data={trend} showLabels={false} />
          </div>
        </CardContent>
      </Card>

      {/* Progress funnel */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm font-semibold">{t('funnelTitle')}</p>
          <Funnel
            steps={[
              { label: t('kpiTotal'), value: total, color: 'hsl(var(--knock-grey))' },
              { label: t('funnelStarted'), value: started, color: 'hsl(var(--brand-amber))' },
              { label: t('kpiDoneAll'), value: doneAll, color: 'hsl(var(--knock-green))' },
            ]}
          />
        </CardContent>
      </Card>

      {/* Upcoming */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm font-semibold">{t('upcoming')}</p>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('nothingUpcoming')}</p>
          ) : (
            <ul className="space-y-1">
              {upcoming.map((j) => (
                <li key={j.id}>
                  <Link
                    href={j.contactId ? `/contacts/${j.contactId}` : '/installs'}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm ${
                      j.revisit ? 'bg-brand-amber/10' : 'bg-primary/5'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {j.revisit ? (
                        <RotateCcw className="h-3.5 w-3.5 shrink-0 text-brand-brown" />
                      ) : (
                        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                      <span className="truncate">
                        {j.name}
                        {j.title ? ` · ${j.title}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{j.when}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Per-technician */}
      {perTech.length > 0 && (
        <Card>
          <CardContent className="space-y-2.5 pt-4">
            <p className="text-sm font-semibold">{t('perTechnician')}</p>
            {perTech.map((tech) => (
              <div key={tech.name} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{tech.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('techTallyFull', { done: tech.done7d, open: tech.open, revisits: tech.revisits })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand-green" style={{ width: `${(tech.done7d / maxDone) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Status breakdown */}
      {donutSegs.length > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-semibold">{t('statusBreakdown')}</p>
            <Donut segments={donutSegs} />
          </CardContent>
        </Card>
      )}

      {/* Map */}
      {mapPoints.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">{t('mapTitle')}</p>
            <CoverageMap polygons={selectedPolys} knocks={[]} installs={mapPoints} turfNames={selectedTerrNames} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

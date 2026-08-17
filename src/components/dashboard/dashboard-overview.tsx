'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Images, KanbanSquare, AlertTriangle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { StatTile } from '@/components/charts/stat-tile';
import { Funnel } from '@/components/charts/funnel';
import { CoverageMap } from '@/components/charts/coverage-map';
import type { InstallPoint } from '@/components/map/turf-map';
import type { ManagerInstallRow } from '@/lib/installations/manager-data';
import { RepMultiFilter, TerritoryFilter } from '@/components/dashboard/rep-multi-filter';
import { pointInAnyPolygon } from '@/lib/geo';
import { Card, CardContent } from '@/components/ui/card';
import type { TurfKnock } from '@/components/map/turf-map';

interface OverviewVisit {
  rep_id: string;
  disposition: string | null;
  visited_at: string;
  contact_id: string | null;
  lat: number | null;
  lng: number | null;
}
interface OverviewContact {
  id: string;
  lifecycle: string;
  assigned_rep_id: string | null;
  territory_id: string | null;
}
interface OverviewFlag {
  rep_id: string | null;
  out_of_turf: boolean;
  implausible_rate: boolean;
  rapid_fire: boolean;
  lat: number | null;
  lng: number | null;
}
interface OverviewCoverage {
  id: string;
  lat: number | null;
  lng: number | null;
  disposition: string | null;
  rep_id: string;
  contact_id?: string | null;
  contacts?: { name: string | null; lifecycle: string } | null;
}
interface OverviewTerritory {
  id: string;
  name: string;
  coordinates: number[][][];
}

export interface DashboardOverviewProps {
  nowIso: string;
  reps: { id: string; name: string }[];
  territories: OverviewTerritory[];
  visits: OverviewVisit[];
  contacts: OverviewContact[];
  flagged: OverviewFlag[];
  coverage: OverviewCoverage[];
  installations?: ManagerInstallRow[];
}

export function DashboardOverview({
  nowIso,
  reps,
  territories,
  visits,
  contacts,
  flagged,
  coverage,
  installations = [],
}: DashboardOverviewProps) {
  const t = useTranslations('dashboard');
  const tS = useTranslations('stats');
  const tStatus = useTranslations('installation.status');
  const [repIds, setRepIds] = useState<string[]>([]);
  const [terrIds, setTerrIds] = useState<string[]>([]);
  const inSel = (id: string | null) => repIds.length === 0 || (!!id && repIds.includes(id));

  const nameOf = useMemo(() => new Map(reps.map((r) => [r.id, r.name])), [reps]);

  // Polygons of the selected territories (or all when none selected).
  const selectedTerrs = useMemo(
    () => territories.filter((t) => terrIds.length === 0 || terrIds.includes(t.id)),
    [territories, terrIds],
  );
  const selectedPolys = useMemo(() => selectedTerrs.map((t) => t.coordinates), [selectedTerrs]);
  const selectedTerrNames = useMemo(() => selectedTerrs.map((t) => t.name), [selectedTerrs]);
  const inTerr = (lat: number | null, lng: number | null) =>
    terrIds.length === 0 ||
    (lat != null && lng != null && pointInAnyPolygon(lat, lng, selectedPolys));
  const inTerrContact = (territoryId: string | null) =>
    terrIds.length === 0 || (!!territoryId && terrIds.includes(territoryId));

  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d7 = new Date(now.getTime() - 7 * 864e5);
  const d30 = new Date(now.getTime() - 30 * 864e5);

  const vs = useMemo(
    () => visits.filter((v) => inSel(v.rep_id) && inTerr(v.lat, v.lng)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visits, repIds, terrIds, selectedPolys],
  );
  const cs = useMemo(
    () => contacts.filter((c) => inSel(c.assigned_rep_id) && inTerrContact(c.territory_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contacts, repIds, terrIds],
  );
  const fl = useMemo(
    () => flagged.filter((f) => inSel(f.rep_id) && inTerr(f.lat, f.lng)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flagged, repIds, terrIds, selectedPolys],
  );
  const covKnocks: TurfKnock[] = useMemo(
    () =>
      coverage
        .filter((k) => inSel(k.rep_id) && k.lat != null && k.lng != null && inTerr(k.lat, k.lng))
        .map((k) => ({
          id: k.id,
          lat: k.lat as number,
          lng: k.lng as number,
          disposition: k.disposition as TurfKnock['disposition'],
          contactId: k.contact_id ?? null,
          name: k.contacts?.name ?? null,
          lifecycle: k.contacts?.lifecycle ?? null,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coverage, repIds, terrIds, selectedPolys],
  );

  // Installation jobs on the same map (status-coloured 🔧), territory-filtered.
  const covInstalls: InstallPoint[] = useMemo(
    () =>
      installations
        .filter((i) => i.lat != null && i.lng != null && inTerr(i.lat, i.lng))
        .map((i) => ({
          id: i.id,
          lat: i.lat as number,
          lng: i.lng as number,
          status: i.status,
          statusLabel: tStatus(i.status),
          title: i.title,
          contactId: i.contactId,
          name: i.contactName,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [installations, terrIds, selectedPolys],
  );

  const inWin = (from: Date) => vs.filter((v) => new Date(v.visited_at) >= from);
  const knocksToday = inWin(startToday).length;
  const knocksWeek = inWin(d7).length;
  const dispCount = (keys: string[]) =>
    vs.filter((v) => v.disposition && keys.includes(v.disposition)).length;
  const interested = dispCount(['interested', 'appointment_set', 'sold']);
  const appointments = dispCount(['appointment_set', 'sold']);
  const sold = dispCount(['sold']);
  const conversion = vs.length > 0 ? Math.round((sold / vs.length) * 100) : 0;

  const leads = cs.filter((c) => c.lifecycle === 'lead').length;
  const customers = cs.filter((c) => c.lifecycle === 'customer');
  const visitedIds = new Set(inWin(d30).map((v) => v.contact_id).filter(Boolean));
  const notVisited30 = customers.filter((c) => !visitedIds.has(c.id)).length;

  // Per-rep bars over the selected reps (or all).
  const perRep = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of inWin(d7)) m.set(v.rep_id, (m.get(v.rep_id) ?? 0) + 1);
    return [...m.entries()]
      .map(([id, n]) => ({ label: nameOf.get(id) ?? '—', value: n, color: 'hsl(var(--primary))' }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs, repIds, nameOf]);
  const activeReps = new Set(inWin(d7).map((v) => v.rep_id)).size;

  const flOut = fl.filter((f) => f.out_of_turf).length;
  const flRate = fl.filter((f) => f.implausible_rate).length;
  const flRapid = fl.filter((f) => f.rapid_fire).length;

  const navCards = [
    { href: '/dashboard/pipeline', icon: KanbanSquare, label: t('pipeline') },
    { href: '/dashboard/photos', icon: Images, label: t('photos') },
  ];

  // Carry the active rep/secteur filter into the pipeline drill-down so its
  // list matches the KPI count.
  const pipelineHref = (life: 'lead' | 'customer') => {
    const p = new URLSearchParams({ life });
    if (repIds.length) p.set('rep', repIds.join(','));
    if (terrIds.length) p.set('terr', terrIds.join(','));
    return `/dashboard/pipeline?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      {/* Global filters — searchable multi-select for reps and territories */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <RepMultiFilter reps={reps} selected={repIds} onChange={setRepIds} />
        <TerritoryFilter territories={territories} selected={terrIds} onChange={setTerrIds} />
      </div>

      {/* Nav */}
      <div className="grid grid-cols-2 gap-2">
        {navCards.map((c) => (
          <Link key={c.href} href={c.href} className="block">
            <Card className="flex flex-col items-center gap-1.5 p-3 text-center transition-colors hover:bg-accent">
              <c.icon className="h-6 w-6 text-primary" />
              <span className="text-xs font-medium">{c.label}</span>
            </Card>
          </Link>
        ))}
      </div>

      {/* Coverage map */}
      <Card>
        <CardContent className="space-y-2 pt-4">
          <p className="text-sm font-semibold">{t('coverageTitle')}</p>
          <CoverageMap polygons={selectedPolys} knocks={covKnocks} installs={covInstalls} turfNames={selectedTerrNames} />
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <StatTile label={t('knocksToday')} value={knocksToday} />
        <StatTile label={t('knocksWeek')} value={knocksWeek} accent="green" />
        <StatTile label={t('activeReps')} value={activeReps} />
        <StatTile label={t('leads')} value={leads} accent="amber" href={pipelineHref('lead')} />
        <StatTile label={t('customers')} value={customers.length} accent="green" href={pipelineHref('customer')} />
        <StatTile label={t('conversion')} value={`${conversion}%`} />
      </div>

      <StatTile label={t('notVisited30')} value={notVisited30} accent="red" />

      {/* Per-rep bars (all reps only) */}
      {perRep.length > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-semibold">{t('perRepWeek')}</p>
            <Funnel steps={perRep} />
          </CardContent>
        </Card>
      )}

      {/* Team funnel */}
      <Card>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm font-semibold">{t('funnel')}</p>
          <Funnel
            steps={[
              { label: tS('funnelKnocks'), value: vs.length, color: 'hsl(var(--knock-grey))' },
              { label: tS('funnelInterested'), value: interested, color: 'hsl(var(--knock-yellow))' },
              { label: tS('funnelAppointments'), value: appointments, color: 'hsl(var(--brand-amber))' },
              { label: tS('funnelSold'), value: sold, color: 'hsl(var(--knock-green))' },
            ]}
          />
        </CardContent>
      </Card>

      {/* Flagged */}
      <Card>
        <CardContent className="space-y-2 pt-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            {t('flagged')}
          </p>
          {flOut + flRate + flRapid === 0 ? (
            <p className="text-sm text-muted-foreground">{t('flaggedNone')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <StatTile label={t('outOfTurf')} value={flOut} accent="red" />
              <StatTile label={t('highRate')} value={flRate} accent="red" />
              <StatTile label={t('rapidFire')} value={flRapid} accent="red" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

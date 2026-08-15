import { getTranslations } from 'next-intl/server';
import { CalendarClock, RotateCcw, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { StatTile } from '@/components/charts/stat-tile';
import { BarDays } from '@/components/charts/bar-days';
import { Donut } from '@/components/charts/donut';
import { Funnel } from '@/components/charts/funnel';
import { CoverageMap } from '@/components/charts/coverage-map';
import { Card, CardContent } from '@/components/ui/card';
import { INSTALL_STATUSES } from '@/lib/installations/protocol';
import type { InstallStatus, DispositionType } from '@/types/database';
import type { TurfKnock } from '@/components/map/turf-map';

interface Row {
  id: string;
  status: InstallStatus;
  installer_id: string | null;
  completed_at: string | null;
  scheduled_date: string | null;
  next_visit_date: string | null;
  title: string | null;
  contact_id: string | null;
  contacts: { name: string | null; lat: number | null; lng: number | null } | null;
}

const STATUS_CSS: Record<string, string> = {
  grey: 'hsl(var(--knock-grey))',
  blue: 'hsl(217 91% 60%)',
  amber: 'hsl(var(--brand-amber))',
  green: 'hsl(var(--knock-green))',
};

// Reuse the map's disposition palette to colour installation spots.
const STATUS_TO_DISPOSITION: Record<InstallStatus, DispositionType> = {
  pending: 'no_answer', // grey
  scheduled: 'appointment_set', // yellow
  in_progress: 'interested', // yellow
  needs_revisit: 'refused', // red
  done: 'sold', // green
};

/** Rich team-wide installation statistics for managers (models "Mes statistiques"). */
export async function TechnicianTeamStats() {
  const t = await getTranslations('installation');
  const tStatus = await getTranslations('installation.status');
  const tS = await getTranslations('stats');

  const supabase = await createClient();
  const [{ data: rawRows }, { data: users }] = await Promise.all([
    supabase
      .from('installations')
      .select('id, status, installer_id, completed_at, scheduled_date, next_visit_date, title, contact_id, contacts(name, lat, lng)')
      .limit(5000),
    supabase.from('users').select('id, full_name, username, role'),
  ]);
  const rows = (rawRows ?? []) as unknown as Row[];

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d7 = new Date(now.getTime() - 7 * 864e5);
  const d14 = new Date(now.getTime() - 14 * 864e5);
  const d30 = new Date(now.getTime() - 30 * 864e5);

  // --- Aggregates ----------------------------------------------------------
  const total = rows.length;
  const countStatus = (s: InstallStatus) => rows.filter((r) => r.status === s).length;
  const pending = countStatus('pending') + countStatus('scheduled');
  const inProgress = countStatus('in_progress');
  const revisits = countStatus('needs_revisit');
  const doneAll = countStatus('done');
  const started = rows.filter((r) => ['in_progress', 'needs_revisit', 'done'].includes(r.status)).length;
  const completionRate = total > 0 ? Math.round((doneAll / total) * 100) : 0;

  const done = rows.filter((r) => r.status === 'done' && r.completed_at);
  const doneInWin = (from: Date, to?: Date) =>
    done.filter((r) => {
      const at = new Date(r.completed_at as string);
      return at >= from && (!to || at < to);
    }).length;
  const doneToday = doneInWin(startToday);
  const doneWeek = doneInWin(d7);
  const donePrevWeek = doneInWin(d14, d7);
  const wowDelta = doneWeek - donePrevWeek;

  // --- 30-day completion trend --------------------------------------------
  const trend = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now.getTime() - (29 - i) * 864e5);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return { label: '', value: doneInWin(start, new Date(start.getTime() + 864e5)) };
  });

  // --- Status donut --------------------------------------------------------
  const donutSegs = INSTALL_STATUSES.map((s) => ({
    label: tStatus(s.i18n),
    value: countStatus(s.key),
    color: STATUS_CSS[s.color] ?? STATUS_CSS.grey,
  })).filter((s) => s.value > 0);

  // --- Per-technician ------------------------------------------------------
  const techName = new Map<string, string>();
  for (const u of (users ?? []) as { id: string; full_name: string | null; username: string | null; role?: string }[]) {
    if (u.role === 'technician') techName.set(u.id, u.full_name ?? u.username ?? '—');
  }
  const perTech = [...techName.entries()]
    .map(([id, name]) => {
      const mine = rows.filter((r) => r.installer_id === id);
      return {
        name,
        done7d: mine.filter((r) => r.status === 'done' && r.completed_at && new Date(r.completed_at) >= d7).length,
        open: mine.filter((r) => r.status !== 'done').length,
        revisits: mine.filter((r) => r.status === 'needs_revisit').length,
      };
    })
    .sort((a, b) => b.done7d - a.done7d || b.open - a.open);
  const maxDone = Math.max(1, ...perTech.map((p) => p.done7d));

  // --- Upcoming ------------------------------------------------------------
  const upcoming = rows
    .filter((r) => r.status === 'scheduled' || r.status === 'needs_revisit')
    .map((r) => ({
      id: r.id,
      name: r.contacts?.name ?? '—',
      title: r.title,
      when: r.next_visit_date ?? r.scheduled_date,
      revisit: r.status === 'needs_revisit',
    }))
    .filter((r) => r.when)
    .sort((a, b) => (a.when! < b.when! ? -1 : 1))
    .slice(0, 8);

  // --- Map points (installations with GPS, coloured by status) -------------
  const mapPoints: TurfKnock[] = rows
    .filter((r) => r.contacts?.lat != null && r.contacts?.lng != null)
    .map((r) => ({
      id: r.id,
      lat: r.contacts!.lat as number,
      lng: r.contacts!.lng as number,
      disposition: STATUS_TO_DISPOSITION[r.status],
      contactId: r.contact_id,
      name: r.contacts?.name ?? null,
      lifecycle: 'customer',
    }));

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      {/* KPI tiles (drill down to the queue) */}
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

      {/* Upcoming (drill down to the job) */}
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
                    href={`/install/new?job=${j.id}`}
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
                  <div
                    className="h-full rounded-full bg-brand-green"
                    style={{ width: `${(tech.done7d / maxDone) * 100}%` }}
                  />
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

      {/* Map (drill down to the customer via popup) */}
      {mapPoints.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">{t('mapTitle')}</p>
            <CoverageMap polygons={[]} knocks={mapPoints} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}

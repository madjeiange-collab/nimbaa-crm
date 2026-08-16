import { getTranslations } from 'next-intl/server';
import { CalendarClock, RotateCcw, ArrowUp, ArrowDown, Minus, KanbanSquare, Images } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { StatTile } from '@/components/charts/stat-tile';
import { BarDays } from '@/components/charts/bar-days';
import { Donut } from '@/components/charts/donut';
import { CoverageMap } from '@/components/charts/coverage-map';
import type { InstallPoint } from '@/components/map/turf-map';
import { Card, CardContent } from '@/components/ui/card';
import { INSTALL_STATUSES } from '@/lib/installations/protocol';
import type { InstallStatus } from '@/types/database';

interface JobRow {
  id: string;
  title: string | null;
  status: InstallStatus;
  completed_at: string | null;
  scheduled_date: string | null;
  next_visit_date: string | null;
  contact_id: string | null;
  contacts: { name: string | null; lat: number | null; lng: number | null } | null;
}

const STATUS_CSS: Record<string, string> = {
  grey: 'hsl(var(--knock-grey))',
  blue: 'hsl(217 91% 60%)',
  amber: 'hsl(var(--brand-amber))',
  green: 'hsl(var(--knock-green))',
};

/** Installation-focused statistics for a technician. */
export async function TechnicianStats({ userId }: { userId: string }) {
  const t = await getTranslations('installation');
  const tStatus = await getTranslations('installation.status');
  const tS = await getTranslations('stats');
  const tDash = await getTranslations('dashboard');

  const supabase = await createClient();
  const [{ data }, { data: turfs }] = await Promise.all([
    supabase
      .from('installations')
      .select('id, title, status, completed_at, scheduled_date, next_visit_date, contact_id, contacts(name, lat, lng)')
      .eq('installer_id', userId),
    supabase.rpc('territories_geojson'), // RLS-scoped (usually empty for techs)
  ]);
  const jobs = (data ?? []) as unknown as JobRow[];
  const polygons: number[][][][] = ((turfs ?? []) as { geojson?: { coordinates?: number[][][] } }[])
    .map((row) => row.geojson?.coordinates)
    .filter(Boolean) as number[][][][];
  const mapPoints: InstallPoint[] = jobs
    .filter((j) => j.contacts?.lat != null && j.contacts?.lng != null)
    .map((j) => ({
      id: j.id,
      lat: j.contacts!.lat as number,
      lng: j.contacts!.lng as number,
      status: j.status,
      statusLabel: tStatus(j.status),
      title: j.title,
      contactId: j.contact_id,
      name: j.contacts?.name ?? null,
    }));

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d7 = new Date(now.getTime() - 7 * 864e5);
  const d14 = new Date(now.getTime() - 14 * 864e5);
  const d30 = new Date(now.getTime() - 30 * 864e5);
  const todayStr = startToday.toISOString().slice(0, 10);

  const done = jobs.filter((j) => j.status === 'done' && j.completed_at);
  const doneInWin = (from: Date, to?: Date) =>
    done.filter((j) => {
      const at = new Date(j.completed_at as string);
      return at >= from && (!to || at < to);
    }).length;

  const doneToday = doneInWin(startToday);
  const doneWeek = doneInWin(d7);
  const donePrevWeek = doneInWin(d14, d7);
  const doneMonth = doneInWin(d30);
  const wowDelta = doneWeek - donePrevWeek;

  const openJobs = jobs.filter((j) => j.status !== 'done');
  const revisits = jobs.filter((j) => j.status === 'needs_revisit').length;

  // 30-day completion trend.
  const trend = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now.getTime() - (29 - i) * 864e5);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return { label: '', value: doneInWin(start, new Date(start.getTime() + 864e5)) };
  });

  // Status breakdown donut.
  const donutSegs = INSTALL_STATUSES.map((s) => ({
    label: tStatus(s.i18n),
    value: jobs.filter((j) => j.status === s.key).length,
    color: STATUS_CSS[s.color] ?? STATUS_CSS.grey,
  })).filter((s) => s.value > 0);

  // Upcoming: scheduled ahead + revisits due, soonest first.
  const upcoming = openJobs
    .filter((j) => j.status === 'scheduled' || j.status === 'needs_revisit')
    .map((j) => ({
      id: j.id,
      name: j.contacts?.name ?? '—',
      title: j.title,
      when: j.next_visit_date ?? j.scheduled_date,
      revisit: j.status === 'needs_revisit',
    }))
    .filter((j) => j.when)
    .sort((a, b) => (a.when! < b.when! ? -1 : 1))
    .slice(0, 6);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={t('kpiDoneWeek')} value={doneWeek} accent="green" />
        <StatTile label={t('kpiDoneMonth')} value={doneMonth} accent="primary" />
        <StatTile label={t('kpiOpen')} value={openJobs.length} accent="amber" href="/installs" />
        <StatTile label={t('kpiRevisits')} value={revisits} accent="red" />
      </div>

      {/* Drill-downs: my install pipeline + install photo audit */}
      <div className="grid grid-cols-2 gap-2">
        <Link href="/dashboard/install-pipeline" className="block">
          <Card className="flex flex-col items-center gap-1.5 p-4 transition-colors hover:bg-accent">
            <KanbanSquare className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{tDash('installPipeline')}</span>
          </Card>
        </Link>
        <Link href="/dashboard/install-photos" className="block">
          <Card className="flex flex-col items-center gap-1.5 p-4 transition-colors hover:bg-accent">
            <Images className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{tDash('installPhotos')}</span>
          </Card>
        </Link>
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

      {/* Status breakdown */}
      {donutSegs.length > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-semibold">{t('statusBreakdown')}</p>
            <Donut segments={donutSegs} />
          </CardContent>
        </Card>
      )}

      {/* My installations map (status-coloured markers) */}
      {mapPoints.length > 0 && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">{t('mapTitle')}</p>
            <CoverageMap polygons={polygons} knocks={[]} installs={mapPoints} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}

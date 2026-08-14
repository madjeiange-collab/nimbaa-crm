import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowUp, ArrowDown, Minus, CalendarClock, AlertTriangle, RotateCcw, Navigation } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { directionsUrl } from '@/lib/geo';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { StatTile } from '@/components/charts/stat-tile';
import { Funnel } from '@/components/charts/funnel';
import { BarDays } from '@/components/charts/bar-days';
import { ProgressRing } from '@/components/charts/progress-ring';
import { Donut } from '@/components/charts/donut';
import { CoverageMap } from '@/components/charts/coverage-map';
import { Card, CardContent } from '@/components/ui/card';
import { dispositionCssColor } from '@/lib/visits/dispositions';
import type { TurfKnock } from '@/components/map/turf-map';

const DAILY_GOAL = 30; // admin-settable per rep in Phase 6

export default async function StatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('stats');
  const tDisp = await getTranslations('dispositions');
  const tC = await getTranslations('contacts');
  const tCommon = await getTranslations('common');

  const supabase = await createClient();

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(startToday.getTime() + 864e5);
  const d7 = new Date(now.getTime() - 7 * 864e5);
  const d14 = new Date(now.getTime() - 14 * 864e5);
  const d30 = new Date(now.getTime() - 30 * 864e5);

  const [{ data: visits }, { data: contacts }, { data: appts }, { data: relance }, { data: turfs }] =
    await Promise.all([
      supabase
        .from('visits')
        .select('id, visited_at, disposition, lat, lng, contact_id, contacts(name, lifecycle)')
        .eq('rep_id', user.id)
        .gte('visited_at', d30.toISOString()),
      supabase.from('contacts').select('lifecycle').eq('assigned_rep_id', user.id),
      supabase
        .from('visits')
        .select('appointment_date, contact_id, contacts(name, lifecycle, lat, lng, address)')
        .eq('rep_id', user.id)
        .not('appointment_date', 'is', null)
        .order('appointment_date', { ascending: true }),
      supabase
        .from('contacts')
        .select('id, name, updated_at, lat, lng, address')
        .eq('assigned_rep_id', user.id)
        .eq('lifecycle', 'lead')
        .lt('updated_at', d7.toISOString())
        .order('updated_at', { ascending: true })
        .limit(5),
      supabase.rpc('territories_geojson'),
    ]);

  const vs = (visits ?? []) as unknown as {
    id: string;
    visited_at: string;
    disposition: string | null;
    lat: number | null;
    lng: number | null;
    contact_id: string | null;
    contacts: { name: string | null; lifecycle: string } | null;
  }[];
  const inWin = (from: Date, to?: Date) =>
    vs.filter((v) => {
      const at = new Date(v.visited_at);
      return at >= from && (!to || at < to);
    });
  const vsMonth = inWin(d30); // month-scoped metrics (we now fetch 3 months)
  const knocksToday = inWin(startToday).length;
  const knocksWeek = inWin(d7).length;
  const knocksMonth = vsMonth.length;
  const knocksPrevWeek = inWin(d14, d7).length;
  const wowDelta = knocksWeek - knocksPrevWeek;

  const dispCount = (keys: string[]) => vsMonth.filter((v) => v.disposition && keys.includes(v.disposition)).length;
  const interested = dispCount(['interested', 'appointment_set', 'sold']);
  const appointments = dispCount(['appointment_set', 'sold']);
  const sold = dispCount(['sold']);

  const cs = (contacts ?? []) as { lifecycle: string }[];
  const leads = cs.filter((c) => c.lifecycle === 'lead').length;
  const customers = cs.filter((c) => c.lifecycle === 'customer').length;
  const lost = cs.filter((c) => c.lifecycle === 'lost').length;
  const conversion = knocksMonth > 0 ? Math.round((sold / knocksMonth) * 100) : 0;

  // 30-day trend
  const trend = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now.getTime() - (29 - i) * 864e5);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    return { label: '', value: inWin(start, new Date(start.getTime() + 864e5)).length };
  });

  // Disposition donut
  const donutSegs = (['no_answer', 'not_home', 'refused', 'interested', 'appointment_set', 'sold'] as const).map(
    (k) => ({
      label: tDisp(k),
      value: dispCount([k]),
      color: dispositionCssColor(
        k === 'refused' ? 'red' : k === 'interested' || k === 'appointment_set' ? 'yellow' : k === 'sold' ? 'green' : 'grey',
      ),
    }),
  );

  // Coverage knocks (with GPS)
  const coverageKnocks: TurfKnock[] = vs
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => ({
      id: v.id,
      lat: v.lat as number,
      lng: v.lng as number,
      disposition: v.disposition as TurfKnock['disposition'],
      contactId: v.contact_id,
      name: v.contacts?.name ?? null,
      lifecycle: v.contacts?.lifecycle ?? null,
    }));
  const polygons: number[][][][] = ((turfs ?? []) as { geojson?: { coordinates?: number[][][] } }[])
    .map((row) => row.geojson?.coordinates)
    .filter(Boolean) as number[][][][];

  // À faire
  type Appt = { appointment_date: string; contact_id: string | null; contacts: { name: string | null; lifecycle: string; lat: number | null; lng: number | null; address: string | null } | null };
  // PostgREST returns the to-one embed as an object; the untyped client infers
  // an array, so cast through unknown.
  const apptRows = (appts ?? []) as unknown as Appt[];
  const rdvToday = apptRows.filter(
    (a) => new Date(a.appointment_date) >= startToday && new Date(a.appointment_date) < startTomorrow,
  );
  const rdvOverdue = apptRows.filter(
    (a) => new Date(a.appointment_date) < startToday && a.contacts?.lifecycle === 'lead',
  );
  const relanceRows = (relance ?? []) as { id: string; name: string | null; updated_at: string; lat: number | null; lng: number | null; address: string | null }[];
  const nothingTodo = rdvToday.length === 0 && rdvOverdue.length === 0 && relanceRows.length === 0;

  const fmtDate = (s: string) =>
    new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(s));
  const daysAgo = (s: string) => Math.max(0, Math.round((now.getTime() - new Date(s).getTime()) / 864e5));

  return (
    <>
      <AppHeader title={t('title')} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {/* Goal ring */}
        <Card>
          <CardContent className="pt-4">
            <p className="mb-3 text-sm font-semibold">{t('goalTitle')}</p>
            <ProgressRing value={knocksToday} goal={DAILY_GOAL} label={t('goalLabel')} />
          </CardContent>
        </Card>

        {/* À faire */}
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-semibold">{t('todo')}</p>
            {nothingTodo ? (
              <p className="text-sm text-muted-foreground">{t('nothingTodo')}</p>
            ) : (
              <div className="space-y-3">
                {rdvOverdue.length > 0 && (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" /> {t('rdvOverdue')} ({rdvOverdue.length})
                    </p>
                    <ul className="space-y-1">
                      {rdvOverdue.slice(0, 5).map((a, i) => {
                        const go = directionsUrl(a.contacts?.lat, a.contacts?.lng, a.contacts?.address);
                        return (
                          <li key={i} className="flex items-stretch gap-1.5">
                            <Link href={a.contact_id ? `/contacts/${a.contact_id}` : '/contacts'} className="flex min-w-0 flex-1 justify-between rounded-md bg-destructive/5 px-2 py-1.5 text-sm">
                              <span className="truncate">{a.contacts?.name ?? tC('noName')}</span>
                              <span className="shrink-0 text-xs text-destructive">{fmtDate(a.appointment_date)}</span>
                            </Link>
                            {go && (
                              <a href={go} target="_blank" rel="noreferrer" aria-label={tCommon('goThere')} className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary">
                                <Navigation className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {rdvToday.length > 0 && (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-brand-brown">
                      <CalendarClock className="h-3.5 w-3.5" /> {t('rdvToday')} ({rdvToday.length})
                    </p>
                    <ul className="space-y-1">
                      {rdvToday.slice(0, 5).map((a, i) => {
                        const go = directionsUrl(a.contacts?.lat, a.contacts?.lng, a.contacts?.address);
                        return (
                          <li key={i} className="flex items-stretch gap-1.5">
                            <Link href={a.contact_id ? `/contacts/${a.contact_id}` : '/contacts'} className="flex min-w-0 flex-1 justify-between rounded-md bg-brand-amber/10 px-2 py-1.5 text-sm">
                              <span className="truncate">{a.contacts?.name ?? tC('noName')}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(a.appointment_date)}</span>
                            </Link>
                            {go && (
                              <a href={go} target="_blank" rel="noreferrer" aria-label={tCommon('goThere')} className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary">
                                <Navigation className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {relanceRows.length > 0 && (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <RotateCcw className="h-3.5 w-3.5" /> {t('leadsToFollow')} ({relanceRows.length})
                    </p>
                    <ul className="space-y-1">
                      {relanceRows.map((r) => {
                        const go = directionsUrl(r.lat, r.lng, r.address);
                        return (
                          <li key={r.id} className="flex items-stretch gap-1.5">
                            <Link href={`/contacts/${r.id}`} className="flex min-w-0 flex-1 justify-between rounded-md bg-muted/50 px-2 py-1.5 text-sm">
                              <span className="truncate">{r.name ?? tC('noName')}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">{t('daysAgo', { n: daysAgo(r.updated_at) })}</span>
                            </Link>
                            {go && (
                              <a href={go} target="_blank" rel="noreferrer" aria-label={tCommon('goThere')} className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 text-xs font-medium text-primary">
                                <Navigation className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Momentum */}
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t('momentum')}</p>
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
                {wowDelta > 0 ? '+' : ''}{wowDelta} {t('vsLastWeek')}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label={t('today')} value={knocksToday} href="/turf" />
              <StatTile label={t('thisWeek')} value={knocksWeek} accent="green" href="/turf" />
              <StatTile label={t('lastWeek')} value={knocksPrevWeek} accent="muted" />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t('trend30')}</p>
              <BarDays data={trend} showLabels={false} />
            </div>
          </CardContent>
        </Card>

        {/* Pipeline outcomes + funnel */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label={t('leads')} value={leads} accent="amber" href="/contacts?tab=lead" />
          <StatTile label={t('customers')} value={customers} accent="green" href="/contacts?tab=customer" />
          <StatTile label={t('lost')} value={lost} accent="red" href="/contacts?tab=lost" />
          <StatTile label={t('conversion')} value={`${conversion}%`} accent="primary" />
        </div>

        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-semibold">{t('funnel')}</p>
            <Funnel
              steps={[
                { label: t('funnelKnocks'), value: knocksMonth, color: 'hsl(var(--knock-grey))' },
                { label: t('funnelInterested'), value: interested, color: 'hsl(var(--knock-yellow))' },
                { label: t('funnelAppointments'), value: appointments, color: 'hsl(var(--brand-amber))' },
                { label: t('funnelSold'), value: sold, color: 'hsl(var(--knock-green))' },
              ]}
            />
          </CardContent>
        </Card>

        {/* Quality donut */}
        <Card>
          <CardContent className="space-y-3 pt-4">
            <p className="text-sm font-semibold">{t('quality')}</p>
            <Donut segments={donutSegs} />
          </CardContent>
        </Card>

        {/* Coverage map */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">{t('coverage')}</p>
            <CoverageMap polygons={polygons} knocks={coverageKnocks} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

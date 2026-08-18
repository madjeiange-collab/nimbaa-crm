import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowUp, ArrowDown, Minus, CalendarClock, Clock, AlertTriangle, RotateCcw, Navigation, KanbanSquare, Images } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { directionsUrl, pointInAnyPolygon } from '@/lib/geo';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { StatTile } from '@/components/charts/stat-tile';
import { Funnel } from '@/components/charts/funnel';
import { DealStageFunnel } from '@/components/charts/deal-stage-funnel';
import { BarDays } from '@/components/charts/bar-days';
import { ProgressRing } from '@/components/charts/progress-ring';
import { Donut } from '@/components/charts/donut';
import { CoverageMap } from '@/components/charts/coverage-map';
import { Card, CardContent } from '@/components/ui/card';
import { dispositionCssColor } from '@/lib/visits/dispositions';
import type { InstallPoint, TurfKnock } from '@/components/map/turf-map';
import { TechnicianStats } from '@/components/stats/technician-stats';
import { StatsFilters } from '@/components/stats/stats-filters';
import { MyCommissions } from '@/components/stats/my-commissions';

const DEFAULT_DAILY_GOAL = 30; // fallback when neither user nor app setting has one

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ terr?: string; type?: string; tag?: string; rep?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('stats');
  const tDash = await getTranslations('dashboard');
  const tHome = await getTranslations('home');

  // Technicians get an installation-focused statistics view.
  if (user.role === 'technician') {
    return (
      <>
        <AppHeader title={tHome('techStats')} />
        <TechnicianStats userId={user.id} />
      </>
    );
  }

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

  // Rep picker: RLS scopes this list — field reps only see themselves (the
  // filter hides), managers/admins can inspect any commercial's stats.
  const spEarly = await searchParams;
  const { data: repRows } = await supabase
    .from('users')
    .select('id, full_name, username, role, is_active, daily_goal')
    .order('full_name');
  const repOptions = ((repRows ?? []) as {
    id: string;
    full_name: string | null;
    username: string | null;
    role: string;
    is_active: boolean;
    daily_goal: number | null;
  }[]).filter((u) => u.is_active && u.role !== 'technician');
  const target = repOptions.find((u) => u.id === spEarly.rep) ?? null;
  const targetId = target?.id ?? user.id;
  const targetGoalOverride = target ? target.daily_goal : user.daily_goal;

  const [
    { data: visits },
    { data: contacts },
    { data: appts },
    { data: relance },
    { data: turfs },
    { data: myDeals },
    { data: stageRows },
  ] = await Promise.all([
      supabase
        .from('visits')
        .select('id, visited_at, disposition, lat, lng, contact_id, contacts(name, lifecycle)')
        .eq('rep_id', targetId)
        .gte('visited_at', d30.toISOString()),
      supabase.from('contacts').select('id, lifecycle, territory_id').eq('assigned_rep_id', targetId),
      supabase
        .from('visits')
        .select('appointment_date, contact_id, contacts(name, lifecycle, lat, lng, address)')
        .eq('rep_id', targetId)
        .not('appointment_date', 'is', null)
        .order('appointment_date', { ascending: true }),
      supabase
        .from('contacts')
        .select('id, name, updated_at, lat, lng, address')
        .eq('assigned_rep_id', targetId)
        .eq('lifecycle', 'lead')
        .lt('updated_at', d7.toISOString())
        .order('updated_at', { ascending: true })
        .limit(5),
      supabase.rpc('territories_geojson'),
      supabase
        .from('deals')
        .select('contact_id, pipeline_stage_id, status, value_xof, business_type, tags')
        .eq('assigned_rep_id', targetId)
        .limit(2000),
      supabase
        .from('pipeline_stages')
        .select('id, name, is_won, is_lost, is_active')
        .order('sort_order'),
    ]);

  // Personal goal wins over the global app setting, then the default.
  const { data: goalSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'daily_visit_goal')
    .maybeSingle();
  const globalGoal = Number((goalSetting?.value as { goal?: number } | null)?.goal);
  const dailyGoal =
    (targetGoalOverride ?? 0) > 0
      ? (targetGoalOverride as number)
      : globalGoal > 0
        ? globalGoal
        : DEFAULT_DAILY_GOAL;

  // --- Manager-style filters (secteur / type d'activité / tag), URL-driven --
  const sp = await searchParams;
  const terrRows = ((turfs ?? []) as {
    id: string;
    name: string;
    geojson?: { coordinates?: number[][][] };
  }[]).filter((r) => r.geojson?.coordinates);
  const terrOptions = terrRows.map((r) => ({ id: r.id, name: r.name }));
  const dealRows = (myDeals ?? []) as {
    contact_id: string | null;
    pipeline_stage_id: string | null;
    status: 'open' | 'won' | 'lost';
    value_xof: number | null;
    business_type: string | null;
    tags: string[] | null;
  }[];
  const typeOptions = [
    ...new Set(dealRows.map((d) => d.business_type).filter((x): x is string => !!x)),
  ].sort();
  const tagOptions = [...new Set(dealRows.flatMap((d) => d.tags ?? []))].sort();

  const terrSel = terrRows.find((r) => r.id === sp.terr) ?? null;
  const typeSel = typeOptions.includes(sp.type ?? '') ? (sp.type as string) : '';
  const tagSel = tagOptions.includes(sp.tag ?? '') ? (sp.tag as string) : '';
  const branchActive = !!typeSel || !!tagSel;
  const matchDeal = (d: (typeof dealRows)[number]) =>
    (!typeSel || d.business_type === typeSel) && (!tagSel || (d.tags ?? []).includes(tagSel));
  const branchContacts = new Set(
    dealRows.filter((d) => matchDeal(d) && d.contact_id).map((d) => d.contact_id as string),
  );
  const inBranch = (cid: string | null) => !branchActive || (!!cid && branchContacts.has(cid));
  const terrPolys = terrSel ? [terrSel.geojson!.coordinates as number[][][]] : [];
  const inTerrPt = (lat: number | null, lng: number | null) =>
    !terrSel || (lat != null && lng != null && pointInAnyPolygon(lat, lng, terrPolys));

  const contactsAll = (contacts ?? []) as { id: string; lifecycle: string; territory_id: string | null }[];
  const terrContactIds = terrSel
    ? new Set(contactsAll.filter((c) => c.territory_id === terrSel.id).map((c) => c.id))
    : null;

  const funnelStages = ((stageRows ?? []) as {
    id: string;
    name: string;
    is_won: boolean;
    is_lost: boolean;
    is_active: boolean;
  }[])
    .filter((s) => s.is_active || s.is_won || s.is_lost)
    .map((s) => ({ id: s.id, name: s.name, isWon: s.is_won, isLost: s.is_lost }));
  const funnelDeals = dealRows
    .filter(
      (d) =>
        matchDeal(d) && (!terrContactIds || (d.contact_id && terrContactIds.has(d.contact_id))),
    )
    .map((d) => ({ stageId: d.pipeline_stage_id, status: d.status, valueXof: d.value_xof }));

  const vsAll = (visits ?? []) as unknown as {
    id: string;
    visited_at: string;
    disposition: string | null;
    lat: number | null;
    lng: number | null;
    contact_id: string | null;
    contacts: { name: string | null; lifecycle: string } | null;
  }[];
  const vs = vsAll.filter((v) => inTerrPt(v.lat, v.lng) && inBranch(v.contact_id));
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

  const cs = contactsAll.filter(
    (c) => (!terrSel || c.territory_id === terrSel.id) && inBranch(c.id),
  );
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
  const turfRows = ((turfs ?? []) as {
    name?: string | null;
    geojson?: { coordinates?: number[][][] };
  }[]).filter((row) => row.geojson?.coordinates);
  const polygons: number[][][][] = turfRows.map((row) => row.geojson!.coordinates!);
  const turfNames = turfRows.map((row) => row.name ?? '—');

  // Installations on the rep's own customers → 🔧 markers on the coverage map.
  const { data: insRows } = await supabase
    .from('installations')
    .select('id, status, title, contact_id, contacts!inner(name, lat, lng, assigned_rep_id)')
    .eq('contacts.assigned_rep_id', targetId)
    .limit(500);
  const tInstallStatus = await getTranslations('installation.status');
  const coverageInstalls: InstallPoint[] = ((insRows ?? []) as unknown as {
    id: string;
    status: string;
    title: string | null;
    contact_id: string | null;
    contacts: { name: string | null; lat: number | null; lng: number | null } | null;
  }[])
    .filter((i) => i.contacts?.lat != null && i.contacts?.lng != null)
    .map((i) => ({
      id: i.id,
      lat: i.contacts!.lat as number,
      lng: i.contacts!.lng as number,
      status: i.status,
      statusLabel: tInstallStatus(i.status as never),
      title: i.title,
      contactId: i.contact_id,
      name: i.contacts?.name ?? null,
    }));

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
      <AppHeader title={tHome('commercialStats')} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {/* Drill-downs up top, like the manager area: my pipeline + my photos */}
        <div className="grid grid-cols-2 gap-2">
          <Link href="/dashboard/pipeline" className="block">
            <Card className="flex flex-col items-center gap-1.5 p-4 transition-colors hover:bg-accent">
              <KanbanSquare className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">{tDash('pipeline')}</span>
            </Card>
          </Link>
          <Link href="/dashboard/photos" className="block">
            <Card className="flex flex-col items-center gap-1.5 p-4 transition-colors hover:bg-accent">
              <Images className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium">{tDash('photos')}</span>
            </Card>
          </Link>
          {/* Check-In and -Out reports on the whole team, so managers only. */}
          {(user.role === 'manager' || user.role === 'admin') && (
            <Link href="/dashboard/controls" className="col-span-2 block">
              <Card className="flex flex-col items-center gap-1.5 p-4 transition-colors hover:bg-accent">
                <Clock className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">{tDash('controls')}</span>
              </Card>
            </Link>
          )}
        </div>

        {/* Manager-style filters: secteur, type d'activité, tag */}
        <StatsFilters
          reps={repOptions.map((u) => ({ id: u.id, name: u.full_name ?? u.username ?? '—' }))}
          selfId={user.id}
          territories={terrOptions}
          types={typeOptions}
          tags={tagOptions}
          current={{ rep: targetId, terr: terrSel?.id ?? '', type: typeSel, tag: tagSel }}
        />

        {/* Goal ring */}
        <Card>
          <CardContent className="pt-4">
            <p className="mb-3 text-sm font-semibold">{t('goalTitle')}</p>
            <ProgressRing value={knocksToday} goal={dailyGoal} label={t('goalLabel')} />
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
          <StatTile label={t('leads')} value={leads} accent="amber" href="/contacts?tab=lead&mine=1" />
          <StatTile label={t('customers')} value={customers} accent="green" href="/contacts?tab=customer&mine=1" />
          <StatTile label={t('lost')} value={lost} accent="red" href="/contacts?tab=lost&mine=1" />
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

        {/* Own commission ledger (renders only once entries exist) */}
        <MyCommissions userId={targetId} />

        {/* Deal-based funnel: the rep's own pipeline by stage (FCFA manager-only) */}
        <DealStageFunnel
          stages={funnelStages}
          deals={funnelDeals}
          showMoney={user.role === 'manager' || user.role === 'admin'}
        />

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
            <CoverageMap polygons={polygons} knocks={coverageKnocks} installs={coverageInstalls} turfNames={turfNames} />
          </CardContent>
        </Card>
      </main>
    </>
  );
}

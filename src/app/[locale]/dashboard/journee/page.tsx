import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { Card, CardContent } from '@/components/ui/card';
import { loadJournalRows, type JournalRow } from '@/lib/checkin/journal';
import {
  asDayKey,
  dayKeyOf,
  dayStart,
  dayWindow,
  shiftDay,
  MAX_LOOKBACK_DAYS,
} from '@/lib/checkin/day';
import {
  buildHourly,
  buildBaseline,
  hm,
  totalsOf,
  abidjanHour,
  FIRST_HOUR,
  LAST_HOUR,
  type BaselineVisit,
} from '@/lib/checkin/hourly';
import { HourlyMatrix } from '@/components/dashboard/hourly-matrix';
import { DayPicker } from '@/components/dashboard/day-picker';

/** Someone with nothing received for this long is worth a call, not a guess. */
const SILENT_MIN = 120;
/** Before this hour, "hasn't started" means nothing. */
const EXPECTED_START_HOUR = 9;
/** Days the ordinary day is averaged over, for the comparison marks. */
const BASELINE_DAYS = 14;
/** A single empty hour is lunch. Two in a row is worth naming. */
const QUIET_RUN = 2;

export const dynamic = 'force-dynamic';

export default async function JourneePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ d?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireRole(['manager', 'admin']);
  const t = await getTranslations('hourly');
  const tFlag = await getTranslations('dashboard');
  const supabase = await createClient();

  const now = new Date();
  const today = dayKeyOf(now);
  const day = asDayKey(sp.d, now);
  const isToday = day === today;
  const { sinceIso, untilIso } = dayWindow(day);
  const lookbackIso = dayStart(shiftDay(today, -MAX_LOOKBACK_DAYS)).toISOString();

  // The fortnight BEFORE the day on screen, so the comparison is against days
  // that had already finished when this one started.
  const baseFrom = dayWindow(shiftDay(day, -BASELINE_DAYS)).sinceIso;
  const baseTo = dayWindow(shiftDay(day, -1)).untilIso;

  const [rows, { data: userRows }, { data: wonThatDay }, { data: seenRows }, baseRes] =
    await Promise.all([
      loadJournalRows(supabase, { sinceIso, untilIso, limit: 600 }),
      supabase.from('users').select('id, full_name, username, role, is_active, daily_goal'),
      supabase
        .from('deals')
        .select('assigned_rep_id, value_xof')
        .eq('status', 'won')
        .gte('won_at', sinceIso)
        .lte('won_at', untilIso),
      // Which days have anything in them at all — the calendar's dots. One
      // column only, so half a year of passages is a few kilobytes.
      supabase.from('visits').select('visited_at').gte('visited_at', lookbackIso).limit(5000),
      // A running day is incomplete by definition; comparing 11 h of work to
      // whole-day averages would mark everyone down every morning.
      isToday
        ? Promise.resolve({ data: [] as BaselineVisit[] })
        : supabase
            .from('visits')
            .select('rep_id, visit_type, visited_at, started_at')
            .gte('visited_at', baseFrom)
            .lte('visited_at', baseTo)
            .limit(3000),
    ]);

  const { commercial, technical } = buildHourly(rows);
  const baseline = buildBaseline((baseRes.data ?? []) as unknown as BaselineVisit[]);

  const activeDays = [
    ...new Set(((seenRows ?? []) as { visited_at: string }[]).map((r) => r.visited_at.slice(0, 10))),
  ].sort();
  const minDay = activeDays[0] ?? today;

  // Passages per person, oldest first, so the drilldown reads as a day.
  const passages: Record<string, JournalRow[]> = {};
  for (const r of [...rows].reverse()) {
    (passages[r.personId] ??= []).push(r);
  }

  type U = {
    id: string;
    full_name: string | null;
    username: string | null;
    role: string;
    is_active: boolean;
    daily_goal: number | null;
  };
  const users = (userRows ?? []) as U[];
  // Staff phone numbers are not stored anywhere yet (users has no phone
  // column), so the call affordance stays wired but unfed — adding it later is
  // one line here plus a field in the users admin.
  const phones: Record<string, string | null> = {};
  const goals: Record<string, number> = {};
  for (const u of users) {
    if (u.daily_goal && u.daily_goal > 0) goals[u.id] = u.daily_goal;
  }

  const pipeline: Record<string, number> = {};
  for (const d of (wonThatDay ?? []) as {
    assigned_rep_id: string | null;
    value_xof: number | null;
  }[]) {
    if (!d.assigned_rep_id) continue;
    pipeline[d.assigned_rep_id] = (pipeline[d.assigned_rep_id] ?? 0) + (d.value_xof ?? 0);
  }

  // buildHourly keys rows by person AND trade, so anyone who did both a visit
  // and a chantier produces two rows. Counting rows gave "10/7 en tournée" and
  // listed the same person twice as silent.
  const fieldStaff = users.filter(
    (u) => u.is_active && u.role !== 'manager' && u.role !== 'admin',
  );
  const fieldIds = new Set(fieldStaff.map((u) => u.id));
  const byPerson = new Map<string, { name: string; lastAt: string | null }>();
  for (const r of [...commercial, ...technical]) {
    const cur = byPerson.get(r.personId);
    if (!cur || (r.lastAt && (!cur.lastAt || r.lastAt > cur.lastAt))) {
      byPerson.set(r.personId, { name: r.personName, lastAt: r.lastAt });
    }
  }
  const activeIds = new Set(byPerson.keys());
  const worked = [...activeIds].filter((id) => fieldIds.has(id)).length;

  // --- who needs a call, which is the only reason to open this at 11h ------
  const nowMs = now.getTime();
  const hourNow = abidjanHour(now.toISOString());
  // Only field staff: a manager who logged a visit is not someone to chase.
  const silent = isToday
    ? [...byPerson.entries()]
        .filter(([id]) => fieldIds.has(id))
        .map(([id, p]) => ({
          id,
          name: p.name,
          min: p.lastAt ? Math.round((nowMs - new Date(p.lastAt).getTime()) / 60_000) : null,
        }))
        .filter((x) => x.min != null && x.min >= SILENT_MIN)
        .sort((a, b) => (b.min ?? 0) - (a.min ?? 0))
    : [];

  const notStarted =
    isToday && hourNow >= EXPECTED_START_HOUR
      ? fieldStaff.filter((u) => !activeIds.has(u.id))
      : [];

  // --- and, on a finished day, what there is to talk about -----------------
  // Silence and "not started yet" are live ideas: on Thursday they would be
  // noise. The same block answers the question a review meeting actually asks.
  const notLogged = isToday ? [] : fieldStaff.filter((u) => !activeIds.has(u.id));

  const flagTally = new Map<string, number>();
  if (!isToday) {
    for (const r of rows) for (const f of r.flags) flagTally.set(f, (flagTally.get(f) ?? 0) + 1);
  }
  const flagTotal = [...flagTally.values()].reduce((a, b) => a + b, 0);

  const HOURS = LAST_HOUR - FIRST_HOUR + 1;
  const perHour = Array.from({ length: HOURS }, () => ({ n: 0, won: 0 }));
  for (const r of rows) {
    const cell = perHour[abidjanHour(r.outAt) - FIRST_HOUR];
    if (!cell) continue;
    cell.n++;
    const d = (r.kind === 'install' ? r.installStatus : r.disposition) ?? '';
    if (r.kind === 'install' ? d === 'done' : d === 'sold') cell.won++;
  }
  const peakIdx = perHour.reduce((best, c, i) => (c.n > perHour[best].n ? i : best), 0);
  const peak = perHour[peakIdx].n > 0 ? { hour: FIRST_HOUR + peakIdx, ...perHour[peakIdx] } : null;

  // The longest stretch of nothing, bounded by the first and last passage —
  // dead hours before anyone started are not a gap in the day.
  let quiet: { from: number; to: number } | null = null;
  if (!isToday) {
    const first = perHour.findIndex((c) => c.n > 0);
    const last = perHour.reduce((l, c, i) => (c.n > 0 ? i : l), -1);
    let run = 0;
    for (let i = first; i >= 0 && i <= last; i++) {
      run = perHour[i].n === 0 ? run + 1 : 0;
      if (run >= QUIET_RUN && (!quiet || run > quiet.to - quiet.from)) {
        quiet = { from: FIRST_HOUR + i - run + 1, to: FIRST_HOUR + i + 1 };
      }
    }
  }

  const cTot = totalsOf(commercial);
  const tTot = totalsOf(technical);
  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(isToday ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
  const stamp = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Abidjan',
  }).format(now);
  const showMoney = user.role === 'manager' || user.role === 'admin';
  const hasBilan = notLogged.length > 0 || flagTotal > 0 || peak != null || quiet != null;

  return (
    <>
      <AppHeader title={isToday ? t('title') : t('titlePast')} />
      <main className="mx-auto max-w-[1400px] space-y-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('backToDashboard')}
          </Link>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {isToday
              ? t('stamp', { day: dayLabel, time: stamp })
              : t('stampPast', { day: dayLabel, from: FIRST_HOUR, to: LAST_HOUR })}
          </span>
        </div>

        <DayPicker day={day} today={today} activeDays={activeDays} minDay={minDay} />

        {/* The band: enough to know whether to keep reading */}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <p className="text-sm text-muted-foreground">
            <span className="mr-1 text-lg font-semibold text-foreground">
              {worked}/{fieldIds.size}
            </span>
            {isToday ? t('onTheRoad') : t('didWork')}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="mr-1 text-lg font-semibold text-foreground">
              {cTot.total + tTot.total}
            </span>
            {t('passagesWord')}
          </p>
          <p className="text-sm text-muted-foreground">
            <span className="mr-1 text-lg font-semibold text-foreground">
              {hm(cTot.minutes + tTot.minutes)}
            </span>
            {t('withClients')}
          </p>
          {cTot.engagementPct != null && (
            <p className="text-sm text-muted-foreground">
              <span className="mr-1 text-lg font-semibold text-foreground">
                {cTot.engagementPct} %
              </span>
              {t('engagement')}
            </p>
          )}
        </div>

        {/* Exceptions first: the matrix says what shape the day has, this says
            who to call about it — or, afterwards, what to discuss. */}
        {isToday && (silent.length > 0 || notStarted.length > 0) && (
          <Card>
            <CardContent className="space-y-1.5 pt-4">
              <p className="text-sm font-semibold">{t('callNow')}</p>
              {notStarted.map((u) => (
                <p key={u.id} className="text-sm">
                  <span className="font-medium">{u.full_name ?? u.username}</span>
                  <span className="text-muted-foreground"> — {t('notStarted')}</span>
                </p>
              ))}
              {silent.map((p) => (
                <p key={p.id} className="text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">
                    {' — '}
                    {t('silentSince', { time: hm(p.min) })}
                  </span>
                </p>
              ))}
            </CardContent>
          </Card>
        )}

        {!isToday && hasBilan && (
          <Card>
            <CardContent className="space-y-1.5 pt-4">
              <p className="text-sm font-semibold">{t('dayReview')}</p>
              {notLogged.map((u) => (
                <p key={u.id} className="text-sm">
                  <span className="font-medium">{u.full_name ?? u.username}</span>
                  <span className="text-muted-foreground"> — {t('loggedNothing')}</span>
                </p>
              ))}
              {flagTotal > 0 && (
                <p className="text-sm">
                  <span className="font-medium">{t('alerts', { n: flagTotal })}</span>
                  <span className="text-muted-foreground">
                    {' — '}
                    {[...flagTally.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([f, n]) => `${n} × ${tFlag(`flag_${f}` as never)}`)
                      .join(' · ')}
                  </span>
                </p>
              )}
              {peak && (
                <p className="text-sm">
                  <span className="font-medium">{t('peakHour')}</span>
                  <span className="text-muted-foreground">
                    {' — '}
                    {t('peakHourValue', { hour: peak.hour, n: peak.n, won: peak.won })}
                  </span>
                </p>
              )}
              {quiet && (
                <p className="text-sm">
                  <span className="font-medium">{t('quiet')}</span>
                  <span className="text-muted-foreground">
                    {' — '}
                    {t('quietValue', { from: quiet.from, to: quiet.to })}
                  </span>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <HourlyMatrix
          commercial={commercial}
          technical={technical}
          passages={passages}
          phones={phones}
          goals={goals}
          pipeline={pipeline}
          showMoney={showMoney}
          baseline={baseline}
          isPast={!isToday}
        />

        <p className="text-xs text-muted-foreground">{t('receivedNote')}</p>
      </main>
    </>
  );
}

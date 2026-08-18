import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Clock } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { Card, CardContent } from '@/components/ui/card';
import { loadJournalRows, type JournalRow } from '@/lib/checkin/journal';
import { periodSince } from '@/lib/checkin/period';
import { buildHourly, hm, totalsOf } from '@/lib/checkin/hourly';
import { HourlyMatrix } from '@/components/dashboard/hourly-matrix';

/** Someone with nothing received for this long is worth a call, not a guess. */
const SILENT_MIN = 120;
/** Before this hour, "hasn't started" means nothing. */
const EXPECTED_START_HOUR = 9;

export const dynamic = 'force-dynamic';

export default async function JourneePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(['manager', 'admin']);
  const t = await getTranslations('hourly');
  const supabase = await createClient();

  const now = new Date();
  const sinceIso = periodSince('day', now);

  const [rows, { data: userRows }, { data: wonToday }] = await Promise.all([
    loadJournalRows(supabase, { sinceIso, limit: 600 }),
    supabase.from('users').select('id, full_name, username, role, is_active, daily_goal'),
    supabase
      .from('deals')
      .select('assigned_rep_id, value_xof')
      .eq('status', 'won')
      .gte('won_at', sinceIso ?? new Date(0).toISOString()),
  ]);

  const { commercial, technical } = buildHourly(rows);

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
  for (const d of (wonToday ?? []) as { assigned_rep_id: string | null; value_xof: number | null }[]) {
    if (!d.assigned_rep_id) continue;
    pipeline[d.assigned_rep_id] = (pipeline[d.assigned_rep_id] ?? 0) + (d.value_xof ?? 0);
  }

  // --- who needs a call, which is the only reason to open this at 11h ------
  const nowMs = now.getTime();
  const hourNow = Number(
    new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', hour12: false, timeZone: 'Africa/Abidjan' })
      .format(now),
  );
  // buildHourly keys rows by person AND trade, so anyone who did both a visit
  // and a chantier today produces two rows. Counting rows gave "10/7 en
  // tournée" and listed the same person twice as silent.
  const fieldIds = new Set(
    users.filter((u) => u.is_active && u.role !== 'manager' && u.role !== 'admin').map((u) => u.id),
  );
  const byPerson = new Map<string, { name: string; lastAt: string | null }>();
  for (const r of [...commercial, ...technical]) {
    const cur = byPerson.get(r.personId);
    if (!cur || (r.lastAt && (!cur.lastAt || r.lastAt > cur.lastAt))) {
      byPerson.set(r.personId, { name: r.personName, lastAt: r.lastAt });
    }
  }
  const activeIds = new Set(byPerson.keys());

  // Only field staff: a manager who logged a visit is not someone to chase.
  const silent = [...byPerson.entries()]
    .filter(([id]) => fieldIds.has(id))
    .map(([id, p]) => ({
      id,
      name: p.name,
      min: p.lastAt ? Math.round((nowMs - new Date(p.lastAt).getTime()) / 60_000) : null,
    }))
    .filter((x) => x.min != null && x.min >= SILENT_MIN)
    .sort((a, b) => (b.min ?? 0) - (a.min ?? 0));

  const notStarted =
    hourNow >= EXPECTED_START_HOUR
      ? users.filter(
          (u) => u.is_active && u.role !== 'manager' && u.role !== 'admin' && !activeIds.has(u.id),
        )
      : [];

  const cTot = totalsOf(commercial);
  const tTot = totalsOf(technical);
  const stamp = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Abidjan',
  }).format(now);
  const today = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Africa/Abidjan',
  }).format(now);
  const showMoney = user.role === 'manager' || user.role === 'admin';

  return (
    <>
      <AppHeader title={t('title')} />
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
            {t('stamp', { day: today, time: stamp })}
          </span>
        </div>

        {/* The band: enough to know whether to keep reading */}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <p className="text-sm text-muted-foreground">
            <span className="mr-1 text-lg font-semibold text-foreground">
              {[...activeIds].filter((id) => fieldIds.has(id)).length}/{fieldIds.size}
            </span>
            {t('onTheRoad')}
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
            who to call about it. */}
        {(silent.length > 0 || notStarted.length > 0) && (
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

        <HourlyMatrix
          commercial={commercial}
          technical={technical}
          passages={passages}
          phones={phones}
          goals={goals}
          pipeline={pipeline}
          showMoney={showMoney}
        />

        <p className="text-xs text-muted-foreground">{t('receivedNote')}</p>
      </main>
    </>
  );
}

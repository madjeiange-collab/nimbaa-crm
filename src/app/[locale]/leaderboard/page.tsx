import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Trophy } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeBoards, getPointConfig } from '@/lib/leaderboard/score';
import { AppHeader } from '@/components/shared/app-header';
import { Avatar } from '@/components/shared/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { GenerateRecapButton } from '@/components/leaderboard/generate-recap-button';
import { RecapCard } from '@/components/leaderboard/recap-card';

function rankBadge(i: number): string {
  return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
}

/**
 * Consecutive active days (≥1 visit / ≥1 completed install), counting back
 * from today — or yesterday when today has no activity yet (a morning view
 * must not zero everyone's streak). An inactive Sunday is a rest day and
 * does not break the chain.
 */
function computeStreak(activeDays: Set<string>, startToday: Date): number {
  let streak = 0;
  const d = new Date(startToday);
  if (!activeDays.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  for (let i = 0; i < 30; i++) {
    const key = d.toISOString().slice(0, 10);
    if (activeDays.has(key)) streak++;
    else if (d.getDay() !== 0) break;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

type DisplayRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  points: number;
  badges: string[];
  lines: string[];
};

function Board({
  title,
  rows,
  meId,
  emptyText,
}: {
  title: string;
  rows: DisplayRow[];
  meId: string;
  emptyText: string;
}) {
  const max = rows[0]?.points || 1;
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="mb-3 text-sm font-semibold">{title}</p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li
                key={r.id}
                className={`rounded-lg border p-3 ${
                  r.id === meId ? 'border-primary bg-primary/5' : 'border-transparent bg-muted/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 shrink-0 text-center text-lg font-bold">
                    {rankBadge(i)}
                  </span>
                  <Avatar url={r.avatarUrl} name={r.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">
                        {r.name}
                        {r.id === meId && ' 👈'}
                      </span>
                      {r.badges.map((b, j) => (
                        <span
                          key={j}
                          className="shrink-0 rounded bg-brand-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-brown"
                        >
                          {b}
                        </span>
                      ))}
                    </p>
                    {r.lines.map((line, j) => (
                      <p key={j} className="text-xs text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                  <span className="shrink-0 text-lg font-bold text-primary">{r.points}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(4, Math.round((r.points / max) * 100))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('leaderboard');

  const period = sp.p === 'month' ? 'month' : 'week';
  const now = new Date();
  const since = new Date(now);
  if (period === 'week') {
    const day = (now.getDay() + 6) % 7; // Monday start
    since.setDate(now.getDate() - day);
  } else {
    since.setDate(1);
  }
  since.setHours(0, 0, 0, 0);

  // Aggregated, non-sensitive board data (names + counts). Reps can't read
  // colleagues' user rows under RLS, so this aggregates with the admin client.
  const admin = createAdminClient();
  const pts = await getPointConfig(admin);
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const since30 = new Date(startToday.getTime() - 29 * 86400_000);
  const prevPeriodStart = new Date(since.getTime() - 7 * 86400_000);
  const prevPeriodCutoff = new Date(now.getTime() - 7 * 86400_000);
  const [
    { reps: repRows, techs: techRows },
    { data: recap },
    { data: recentVisits },
    { data: recentInstalls },
    { data: goalRow },
    { data: goalRows },
    prevWeek,
  ] = await Promise.all([
    computeBoards(admin, since.toISOString(), pts),
    admin
      .from('daily_recaps')
      .select('day, content')
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('visits')
      .select('rep_id, visited_at')
      .neq('visit_type', 'installation')
      .gte('visited_at', since30.toISOString())
      .limit(10000),
    admin
      .from('installations')
      .select('installer_id, completed_at')
      .eq('status', 'done')
      .gte('completed_at', since30.toISOString())
      .limit(5000),
    admin.from('app_settings').select('value').eq('key', 'daily_visit_goal').maybeSingle(),
    admin.from('users').select('id, daily_goal'),
    // 📈 badge compares this week vs last week at the same point (week view only).
    period === 'week'
      ? computeBoards(admin, prevPeriodStart.toISOString(), pts, prevPeriodCutoff.toISOString())
      : Promise.resolve(null),
  ]);

  // Active-day sets for streaks + today's visit counts for the goal badge.
  const todayKey = startToday.toISOString().slice(0, 10);
  const repDays = new Map<string, Set<string>>();
  const todayVisits = new Map<string, number>();
  for (const v of (recentVisits ?? []) as { rep_id: string; visited_at: string }[]) {
    const day = v.visited_at.slice(0, 10);
    if (!repDays.has(v.rep_id)) repDays.set(v.rep_id, new Set());
    repDays.get(v.rep_id)!.add(day);
    if (day === todayKey) todayVisits.set(v.rep_id, (todayVisits.get(v.rep_id) ?? 0) + 1);
  }
  const techDays = new Map<string, Set<string>>();
  for (const j of (recentInstalls ?? []) as { installer_id: string | null; completed_at: string | null }[]) {
    if (!j.installer_id || !j.completed_at) continue;
    if (!techDays.has(j.installer_id)) techDays.set(j.installer_id, new Set());
    techDays.get(j.installer_id)!.add(j.completed_at.slice(0, 10));
  }
  const dailyGoal =
    Number((goalRow?.value as { goal?: number } | null)?.goal) > 0
      ? Number((goalRow!.value as { goal: number }).goal)
      : 30;
  // Per-rep objective wins over the global goal for the 🎯 badge.
  const goalOf = new Map(
    ((goalRows ?? []) as { id: string; daily_goal: number | null }[]).map((u) => [
      u.id,
      u.daily_goal,
    ]),
  );

  const repBadges = (r: (typeof repRows)[number]): string[] => {
    const b: string[] = [];
    const streak = computeStreak(repDays.get(r.id) ?? new Set(), startToday);
    if (streak >= 2) b.push(`🔥 ${streak} j`);
    if ((todayVisits.get(r.id) ?? 0) >= (goalOf.get(r.id) || dailyGoal)) b.push('🎯');
    const prev = prevWeek?.reps.find((p) => p.id === r.id);
    if (prevWeek && r.points > 0 && r.points > (prev?.points ?? 0)) b.push('📈');
    return b;
  };
  const techBadges = (r: (typeof techRows)[number]): string[] => {
    const b: string[] = [];
    const streak = computeStreak(techDays.get(r.id) ?? new Set(), startToday);
    if (streak >= 2) b.push(`🔥 ${streak} j`);
    const prev = prevWeek?.techs.find((p) => p.id === r.id);
    if (prevWeek && r.points > 0 && r.points > (prev?.points ?? 0)) b.push('📈');
    return b;
  };

  const isTech = user.role === 'technician';
  const isManager = user.role === 'manager' || user.role === 'admin';

  // Funnel + performance lines. Revenue is visible to managers/admins only.
  const repDisplay: DisplayRow[] = repRows.map((r) => ({
    id: r.id,
    name: r.name,
    avatarUrl: r.avatarUrl,
    points: r.points,
    badges: repBadges(r),
    lines: [
      `${t('visits')}: ${r.visits} · ${t('refused')}: ${r.refused} · ${t('interested')}: ${r.interested} · ${t('rdv')}: ${r.rdv} · ${t('sales')}: ${r.sales}`,
      `${t('leads')}: ${r.leads} · ${t('customers')}: ${r.sales} · ${t('engagement')}: ${r.engagementPct}% · ${t('conversion')}: ${r.conversionPct}%` +
        (isManager ? ` · ${t('revenue')}: ${r.fcfa.toLocaleString('fr-FR')} FCFA` : ''),
    ],
  }));
  const techDisplay: DisplayRow[] = techRows.map((r) => ({
    id: r.id,
    name: r.name,
    avatarUrl: r.avatarUrl,
    points: r.points,
    badges: techBadges(r),
    lines: [
      `${t('done')}: ${r.done} · ${t('revisits')}: ${r.revisits} · ${t('open')}: ${r.open}`,
      `${t('completion')}: ${r.completionPct}%`,
    ],
  }));

  const boards = [
    <Board
      key="reps"
      title={t('repsBoard')}
      rows={repDisplay}
      meId={user.id}
      emptyText={t('empty')}
    />,
    <Board
      key="techs"
      title={t('techsBoard')}
      rows={techDisplay}
      meId={user.id}
      emptyText={t('empty')}
    />,
  ];
  if (isTech) boards.reverse();

  return (
    <>
      <AppHeader title={t('title')} subtitle={t('subtitle')} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {/* Daily recap written by the assistant */}
        {recap && (
          <RecapCard
            title={t('recapTitle')}
            dateLabel={new Date(recap.day + 'T12:00:00').toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            content={recap.content}
          />
        )}

        {/* Period toggle + manager recap trigger */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(['week', 'month'] as const).map((p) => (
              <Link
                key={p}
                href={`/leaderboard?p=${p}`}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                  period === p ? 'bg-background shadow' : 'text-muted-foreground'
                }`}
              >
                {p === 'week' ? t('thisWeek') : t('thisMonth')}
              </Link>
            ))}
          </div>
          {isManager ? <GenerateRecapButton /> : <Trophy className="h-5 w-5 text-brand-amber" />}
        </div>

        {boards}

        {/* Scoring legend — transparency drives trust in the game */}
        <Card>
          <CardContent className="pt-4 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">{t('scoringTitle')}</p>
            <p>
              {t('scoringReps', {
                v: pts.visit,
                i: pts.interested,
                r: pts.appointment,
                w: pts.deal_won,
              })}
            </p>
            <p>{t('scoringTechs', { d: pts.install_done, r: pts.revisit })}</p>
            <p className="mt-1">{t('badgesLegend', { goal: dailyGoal })}</p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

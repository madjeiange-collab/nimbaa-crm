import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Trophy, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeBoards, getPointConfig } from '@/lib/leaderboard/score';
import { AppHeader } from '@/components/shared/app-header';
import { Card, CardContent } from '@/components/ui/card';
import { GenerateRecapButton } from '@/components/leaderboard/generate-recap-button';

function rankBadge(i: number): string {
  return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
}

type DisplayRow = { id: string; name: string; points: number; lines: string[] };

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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {r.name}
                      {r.id === meId && ' 👈'}
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
  const [{ reps: repRows, techs: techRows }, { data: recap }] = await Promise.all([
    computeBoards(admin, since.toISOString(), pts),
    admin
      .from('daily_recaps')
      .select('day, content')
      .order('day', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const isTech = user.role === 'technician';
  const isManager = user.role === 'manager' || user.role === 'admin';

  // Funnel + performance lines. Revenue is visible to managers/admins only.
  const repDisplay: DisplayRow[] = repRows.map((r) => ({
    id: r.id,
    name: r.name,
    points: r.points,
    lines: [
      `${t('visits')}: ${r.visits} · ${t('refused')}: ${r.refused} · ${t('interested')}: ${r.interested} · ${t('rdv')}: ${r.rdv} · ${t('sales')}: ${r.sales}`,
      `${t('leads')}: ${r.leads} · ${t('customers')}: ${r.sales} · ${t('engagement')}: ${r.engagementPct}% · ${t('conversion')}: ${r.conversionPct}%` +
        (isManager ? ` · ${t('revenue')}: ${r.fcfa.toLocaleString('fr-FR')} FCFA` : ''),
    ],
  }));
  const techDisplay: DisplayRow[] = techRows.map((r) => ({
    id: r.id,
    name: r.name,
    points: r.points,
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
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                {t('recapTitle')}
                <span className="font-normal text-muted-foreground">
                  · {new Date(recap.day + 'T12:00:00').toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </span>
              </p>
              <p className="whitespace-pre-wrap text-sm">{recap.content}</p>
            </CardContent>
          </Card>
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
          </CardContent>
        </Card>
      </main>
    </>
  );
}

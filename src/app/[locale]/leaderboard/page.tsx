import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Trophy } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { AppHeader } from '@/components/shared/app-header';
import { Card, CardContent } from '@/components/ui/card';

// Transparent scoring — keep in sync with the legend in the i18n strings.
const PTS_VISIT = 1;
const PTS_INTERESTED = 3;
const PTS_APPOINTMENT = 5;
const PTS_DEAL_WON = 20;
const PTS_INSTALL_DONE = 20;
const PTS_REVISIT = 5;

type Row = {
  id: string;
  name: string;
  points: number;
  a: number; // visits | installs done
  b: number; // interested+RDV | revisits handled
  c: number; // deals won | open jobs
  fcfa: number;
};

function rankBadge(i: number): string {
  return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
}

function Board({
  title,
  rows,
  meId,
  cols,
  emptyText,
}: {
  title: string;
  rows: Row[];
  meId: string;
  cols: [string, string, string];
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
                    <p className="text-xs text-muted-foreground">
                      {cols[0]}: {r.a} · {cols[1]}: {r.b} · {cols[2]}: {r.c}
                      {r.fcfa > 0 && ` · ${r.fcfa.toLocaleString('fr-FR')} FCFA`}
                    </p>
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
  const sinceIso = since.toISOString();

  // Aggregated, non-sensitive board data (names + counts). Reps can't read
  // colleagues' user rows under RLS, so this page aggregates server-side
  // with the admin client and exposes only what the board shows.
  const admin = createAdminClient();
  const [{ data: users }, { data: visits }, { data: deals }, { data: installs }] =
    await Promise.all([
      admin.from('users').select('id, full_name, username, role, is_active'),
      admin
        .from('visits')
        .select('rep_id, disposition, visit_type')
        .gte('visited_at', sinceIso)
        .limit(10000),
      admin
        .from('deals')
        .select('assigned_rep_id, value_xof')
        .eq('status', 'won')
        .gte('won_at', sinceIso)
        .limit(5000),
      admin
        .from('installations')
        .select('installer_id, status, completed_at, next_visit_date')
        .limit(5000),
    ]);

  const active = (users ?? []).filter((u) => u.is_active);
  const nameOf = (u: { full_name: string | null; username: string | null; id: string }) =>
    u.full_name || u.username || u.id.slice(0, 8);

  // --- Commercials ---------------------------------------------------------
  const repRows: Row[] = active
    .filter((u) => u.role === 'rep' || u.role === 'manager')
    .map((u) => {
      const mine = (visits ?? []).filter(
        (v) => v.rep_id === u.id && v.visit_type !== 'installation',
      );
      const interested = mine.filter((v) => v.disposition === 'interested').length;
      const rdv = mine.filter((v) => v.disposition === 'appointment_set').length;
      const myDeals = (deals ?? []).filter((d) => d.assigned_rep_id === u.id);
      const fcfa = myDeals.reduce((s, d) => s + (d.value_xof ?? 0), 0);
      return {
        id: u.id,
        name: nameOf(u),
        a: mine.length,
        b: interested + rdv,
        c: myDeals.length,
        fcfa,
        points:
          mine.length * PTS_VISIT +
          interested * PTS_INTERESTED +
          rdv * PTS_APPOINTMENT +
          myDeals.length * PTS_DEAL_WON,
      };
    })
    .filter((r) => r.points > 0 || r.a > 0)
    .sort((x, y) => y.points - x.points || y.fcfa - x.fcfa);

  // --- Technicians ---------------------------------------------------------
  const techRows: Row[] = active
    .filter((u) => u.role === 'technician')
    .map((u) => {
      const mine = (installs ?? []).filter((i) => i.installer_id === u.id);
      const done = mine.filter(
        (i) => i.status === 'done' && i.completed_at && i.completed_at >= sinceIso,
      ).length;
      const revisits = mine.filter(
        (i) => i.status === 'needs_revisit' || (i.status === 'done' && i.next_visit_date),
      ).length;
      const open = mine.filter((i) =>
        ['pending', 'scheduled', 'in_progress', 'needs_revisit'].includes(i.status),
      ).length;
      return {
        id: u.id,
        name: nameOf(u),
        a: done,
        b: revisits,
        c: open,
        fcfa: 0,
        points: done * PTS_INSTALL_DONE + revisits * PTS_REVISIT,
      };
    })
    .filter((r) => r.points > 0 || r.c > 0)
    .sort((x, y) => y.points - x.points || y.a - x.a);

  const isTech = user.role === 'technician';
  const boards = [
    <Board
      key="reps"
      title={t('repsBoard')}
      rows={repRows}
      meId={user.id}
      cols={[t('visits'), t('leadsRdv'), t('sales')]}
      emptyText={t('empty')}
    />,
    <Board
      key="techs"
      title={t('techsBoard')}
      rows={techRows}
      meId={user.id}
      cols={[t('done'), t('revisits'), t('open')]}
      emptyText={t('empty')}
    />,
  ];
  if (isTech) boards.reverse();

  return (
    <>
      <AppHeader title={t('title')} subtitle={t('subtitle')} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        {/* Period toggle */}
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
          <Trophy className="h-5 w-5 text-brand-amber" />
        </div>

        {boards}

        {/* Scoring legend — transparency drives trust in the game */}
        <Card>
          <CardContent className="pt-4 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">{t('scoringTitle')}</p>
            <p>{t('scoringReps', { v: PTS_VISIT, i: PTS_INTERESTED, r: PTS_APPOINTMENT, w: PTS_DEAL_WON })}</p>
            <p>{t('scoringTechs', { d: PTS_INSTALL_DONE, r: PTS_REVISIT })}</p>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

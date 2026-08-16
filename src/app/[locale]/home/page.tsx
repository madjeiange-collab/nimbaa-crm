import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  DoorOpen,
  Map as MapIcon,
  Users,
  BarChart3,
  ShieldCheck,
  Settings,
  Sparkles,
  Trophy,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeBoards, getPointConfig } from '@/lib/leaderboard/score';
import { AppHeader } from '@/components/shared/app-header';
import { Card, CardContent } from '@/components/ui/card';
import { CoverageMap } from '@/components/charts/coverage-map';
import type { TurfKnock } from '@/components/map/turf-map';

function HomeCard({
  href,
  icon: Icon,
  title,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-accent active:bg-accent">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{title}</p>
          {hint && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
      </Card>
    </Link>
  );
}

function rankBadge(i: number): string {
  return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
}

function MiniBoard({
  title,
  rows,
  meId,
}: {
  title: string;
  rows: { id: string; name: string; points: number }[];
  meId: string;
}) {
  if (rows.length === 0) return null;
  const max = rows[0]?.points || 1;
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li
            key={r.id}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
              r.id === meId ? 'bg-primary/10' : ''
            }`}
          >
            <span className="w-7 shrink-0 text-center text-sm font-bold">{rankBadge(i)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {r.name}
                {r.id === meId && ' 👈'}
              </p>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(4, Math.round((r.points / max) * 100))}%` }}
                />
              </div>
            </div>
            <span className="shrink-0 text-sm font-bold text-primary">{r.points}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations('home');
  const tBoard = await getTranslations('leaderboard');

  const isManager = user.role === 'manager' || user.role === 'admin';
  const isAdmin = user.role === 'admin';
  const isTechnician = user.role === 'technician';
  const displayName = user.full_name ?? user.username ?? '';
  const hasNoCapability =
    !user.can_do_b2b && !user.can_do_d2d && user.role === 'rep';

  // --- Welcome-screen data: this week's board + coverage map ---------------
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  const admin = createAdminClient();
  const supabase = await createClient();
  const knocksSince = new Date(Date.now() - 30 * 86400_000).toISOString();

  let visitsQ = supabase
    .from('visits')
    .select('id, lat, lng, disposition, contact_id')
    .eq('visit_type', 'd2d_knock')
    .gte('visited_at', knocksSince)
    .limit(2000);
  // Reps see their own coverage; managers/admins the whole team's.
  if (!isManager) visitsQ = visitsQ.eq('rep_id', user.id);

  const [{ reps, techs }, { data: turfs }, { data: knockRows }] = await Promise.all([
    getPointConfig(admin).then((pts) => computeBoards(admin, monday.toISOString(), pts)),
    supabase.rpc('territories_geojson'), // RLS: rep → own turfs, manager → all
    isTechnician ? Promise.resolve({ data: [] as never[] }) : visitsQ,
  ]);

  const polygons: number[][][][] = ((turfs ?? []) as { geojson?: { coordinates?: number[][][] } }[])
    .map((row) => row.geojson?.coordinates)
    .filter(Boolean) as number[][][][];
  const knocks: TurfKnock[] = ((knockRows ?? []) as {
    id: string;
    lat: number | null;
    lng: number | null;
    disposition: TurfKnock['disposition'];
    contact_id: string | null;
  }[])
    .filter((v) => v.lat != null && v.lng != null)
    .map((v) => ({
      id: v.id,
      lat: v.lat as number,
      lng: v.lng as number,
      disposition: v.disposition,
      contactId: v.contact_id,
    }));

  const miniBoards = [
    <MiniBoard key="reps" title={tBoard('repsBoard')} rows={reps.slice(0, 5)} meId={user.id} />,
    <MiniBoard key="techs" title={tBoard('techsBoard')} rows={techs.slice(0, 5)} meId={user.id} />,
  ];
  if (isTechnician) miniBoards.reverse();

  return (
    <>
      <AppHeader title={t('greeting', { name: displayName })} />
      <main className="mx-auto max-w-6xl p-4">
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* ---- Left: action buttons ---- */}
          <div className="space-y-2.5">
            {user.can_do_b2b && (
              <HomeCard
                href="/contacts"
                icon={Users}
                title={t('myContacts')}
                hint={t('myContactsHint')}
              />
            )}

            {(user.can_do_b2b || user.can_do_d2d) && (
              <HomeCard
                href="/visit/new"
                icon={DoorOpen}
                title={t('logVisit')}
                hint={t('logVisitHint')}
              />
            )}

            {(isTechnician || isManager) && (
              <HomeCard
                href="/installs"
                icon={Wrench}
                title={t('logInstall')}
                hint={t('logInstallHint')}
              />
            )}

            {user.can_do_d2d && (
              <HomeCard href="/turf" icon={MapIcon} title={t('myTurf')} hint={t('myTurfHint')} />
            )}

            <HomeCard
              href="/assistant"
              icon={Sparkles}
              title={t('assistant')}
              hint={t('assistantHint')}
            />

            <HomeCard
              href="/leaderboard"
              icon={Trophy}
              title={t('leaderboard')}
              hint={t('leaderboardHint')}
            />

            {(user.can_do_b2b || user.can_do_d2d) && (
              <HomeCard
                href="/stats"
                icon={BarChart3}
                title={t('commercialStats')}
                hint={t('myStatsHint')}
              />
            )}

            {isManager && (
              <HomeCard
                href="/stats/technicians"
                icon={Wrench}
                title={t('techStats')}
                hint={t('techStatsHint')}
              />
            )}

            {isTechnician && (
              <>
                <HomeCard
                  href="/contacts"
                  icon={Users}
                  title={t('myContacts')}
                  hint={t('myContactsHint')}
                />
                <HomeCard
                  href="/stats"
                  icon={BarChart3}
                  title={t('myStats')}
                  hint={t('myStatsHint')}
                />
              </>
            )}

            {hasNoCapability && (
              <Card className="p-4 text-sm text-muted-foreground">{t('noCapabilities')}</Card>
            )}

            {isManager && (
              <HomeCard href="/dashboard" icon={ShieldCheck} title={t('managerArea')} hint="" />
            )}
            {isAdmin && (
              <HomeCard href="/admin" icon={Settings} title={t('adminArea')} hint="" />
            )}
          </div>

          {/* ---- Right: this week's board + coverage map ---- */}
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Trophy className="h-4 w-4 text-brand-amber" />
                    {tBoard('title')} · {tBoard('thisWeek')}
                  </p>
                  <Link href="/leaderboard" className="text-sm font-medium text-primary underline">
                    {t('seeAll')}
                  </Link>
                </div>
                {reps.length === 0 && techs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tBoard('empty')}</p>
                ) : (
                  miniBoards
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2 pt-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <MapIcon className="h-4 w-4 text-primary" />
                  {t('coverageTitle')}
                </p>
                <CoverageMap polygons={polygons} knocks={knocks} />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}

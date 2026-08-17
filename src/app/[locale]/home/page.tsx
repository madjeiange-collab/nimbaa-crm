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
import { Avatar } from '@/components/shared/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { CoverageMap } from '@/components/charts/coverage-map';
import { GenerateRecapButton } from '@/components/leaderboard/generate-recap-button';
import { RecapCard } from '@/components/leaderboard/recap-card';
import type { InstallPoint, TurfKnock } from '@/components/map/turf-map';

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
  rows: {
    id: string;
    name: string;
    avatarUrl: string | null;
    points: number;
    lines: string[];
  }[];
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
            <Avatar url={r.avatarUrl} name={r.name} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {r.name}
                {r.id === meId && ' 👈'}
              </p>
              {r.lines.map((line, j) => (
                <p key={j} className="truncate text-xs text-muted-foreground">
                  {line}
                </p>
              ))}
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

  // Installations on the same map (status-coloured 🔧 markers). Technicians
  // see their own jobs; everyone else sees all (matches the app's read model).
  let installsQ = supabase
    .from('installations')
    .select('id, status, title, contact_id, contacts(name, lat, lng)')
    .limit(1000);
  if (isTechnician) installsQ = installsQ.eq('installer_id', user.id);

  // Managers get the detailed per-person brief; field users get "Mon brief"
  // (team story + their personal analysis). Fallback: the public recap.
  const detailRecapQ = isManager
    ? admin
        .from('manager_recaps')
        .select('day, content')
        .order('day', { ascending: false })
        .limit(1)
        .maybeSingle()
    : admin
        .from('user_recaps')
        .select('day, content')
        .eq('user_id', user.id)
        .order('day', { ascending: false })
        .limit(1)
        .maybeSingle();

  const [{ reps, techs }, { data: turfs }, { data: knockRows }, { data: installRows }, { data: recap }, { data: detailRecap }] =
    await Promise.all([
      getPointConfig(admin).then((pts) => computeBoards(admin, monday.toISOString(), pts)),
      supabase.rpc('territories_geojson'), // RLS: rep → own turfs, manager → all
      isTechnician ? Promise.resolve({ data: [] as never[] }) : visitsQ,
      installsQ,
      admin
        .from('daily_recaps')
        .select('day, content')
        .order('day', { ascending: false })
        .limit(1)
        .maybeSingle(),
      detailRecapQ,
    ]);

  const shownRecap = (detailRecap as { day: string; content: string } | null) ?? recap;

  const turfRows = ((turfs ?? []) as {
    name?: string | null;
    geojson?: { coordinates?: number[][][] };
  }[]).filter((row) => row.geojson?.coordinates);
  const polygons: number[][][][] = turfRows.map((row) => row.geojson!.coordinates!);
  const turfNames = turfRows.map((row) => row.name ?? '—');
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

  const tInstall = await getTranslations('installation');
  const installs: InstallPoint[] = ((installRows ?? []) as unknown as {
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
      statusLabel: tInstall(`status.${i.status}` as never),
      title: i.title,
      contactId: i.contact_id,
      name: i.contacts?.name ?? null,
    }));

  // Same detail lines as the full leaderboard (revenue: managers/admins only).
  const repMini = reps.slice(0, 5).map((r) => ({
    id: r.id,
    name: r.name,
    avatarUrl: r.avatarUrl,
    points: r.points,
    lines: [
      `${tBoard('visits')}: ${r.visits} · ${tBoard('refused')}: ${r.refused} · ${tBoard('interested')}: ${r.interested} · ${tBoard('rdv')}: ${r.rdv} · ${tBoard('sales')}: ${r.sales}`,
      `${tBoard('leads')}: ${r.leads} · ${tBoard('engagement')}: ${r.engagementPct}% · ${tBoard('conversion')}: ${r.conversionPct}%` +
        (isManager ? ` · ${tBoard('revenue')}: ${r.fcfa.toLocaleString('fr-FR')} FCFA` : ''),
    ],
  }));
  const techMini = techs.slice(0, 5).map((r) => ({
    id: r.id,
    name: r.name,
    avatarUrl: r.avatarUrl,
    points: r.points,
    lines: [
      `${tBoard('done')}: ${r.done} · ${tBoard('revisits')}: ${r.revisits} · ${tBoard('open')}: ${r.open} · ${tBoard('completion')}: ${r.completionPct}%`,
    ],
  }));

  const miniBoards = [
    <MiniBoard key="reps" title={tBoard('repsBoard')} rows={repMini} meId={user.id} />,
    <MiniBoard key="techs" title={tBoard('techsBoard')} rows={techMini} meId={user.id} />,
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

          {/* ---- Right: daily AI recap + this week's board + coverage map ---- */}
          <div className="space-y-4">
            {(shownRecap || isManager) && (
              <RecapCard
                title={
                  detailRecap && isManager
                    ? tBoard('managerRecapTitle')
                    : detailRecap
                      ? tBoard('myRecapTitle')
                      : tBoard('recapTitle')
                }
                dateLabel={
                  shownRecap
                    ? new Date(shownRecap.day + 'T12:00:00').toLocaleDateString('fr-FR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })
                    : null
                }
                content={shownRecap?.content ?? null}
                action={isManager ? <GenerateRecapButton /> : undefined}
              />
            )}

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
                <CoverageMap polygons={polygons} knocks={knocks} installs={installs} turfNames={turfNames} />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}

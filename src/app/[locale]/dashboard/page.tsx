import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import {
  DashboardOverview,
  type DashboardOverviewProps,
} from '@/components/dashboard/dashboard-overview';
import {
  InstallationsSummary,
  type TechTally,
} from '@/components/dashboard/installations-summary';
import { OPEN_INSTALL_STATUSES } from '@/lib/installations/protocol';
import type { InstallStatus } from '@/types/database';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('dashboard');

  const supabase = await createClient();
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 864e5);
  const d7 = new Date(now.getTime() - 7 * 864e5);

  const [{ data: users }, { data: visits }, { data: contacts }, { data: flagged }, { data: turfs }, { data: coverage }, { data: installs }] =
    await Promise.all([
      supabase.from('users').select('id, full_name, username, role'),
      supabase
        .from('visits')
        .select('rep_id, disposition, visited_at, contact_id, lat, lng')
        .gte('visited_at', d30.toISOString()),
      supabase.from('contacts').select('id, lifecycle, assigned_rep_id, territory_id'),
      supabase
        .from('flagged_visits')
        .select('rep_id, out_of_turf, implausible_rate, rapid_fire, lat, lng')
        .limit(500),
      supabase.rpc('territories_geojson'),
      supabase
        .from('visits')
        .select('id, lat, lng, disposition, rep_id, contact_id, contacts(name, lifecycle)')
        .eq('visit_type', 'd2d_knock')
        .not('lat', 'is', null)
        .limit(2000),
      supabase
        .from('installations')
        .select('status, installer_id, completed_at')
        .limit(5000),
    ]);

  const reps: DashboardOverviewProps['reps'] = (users ?? []).map(
    (u: { id: string; full_name: string | null; username: string | null }) => ({
      id: u.id,
      name: u.full_name ?? u.username ?? '—',
    }),
  );

  const territories: DashboardOverviewProps['territories'] = (
    (turfs ?? []) as { id: string; name: string; geojson?: { coordinates?: number[][][] } }[]
  )
    .filter((r) => r.geojson?.coordinates)
    .map((r) => ({ id: r.id, name: r.name, coordinates: r.geojson!.coordinates as number[][][] }));

  // ---- Installation snapshot -------------------------------------------------
  type InstallRow = { status: InstallStatus; installer_id: string | null; completed_at: string | null };
  const installRows = (installs ?? []) as InstallRow[];
  const d7Iso = d7.toISOString();
  const openSet = new Set<InstallStatus>(OPEN_INSTALL_STATUSES);

  const techName = new Map<string, string>(
    (users ?? [])
      .filter((u: { role?: string }) => u.role === 'technician')
      .map((u: { id: string; full_name: string | null; username: string | null }) => [
        u.id,
        u.full_name ?? u.username ?? '—',
      ]),
  );
  const perTechMap = new Map<string, TechTally>();
  for (const [id, name] of techName) perTechMap.set(id, { name, done: 0, open: 0 });

  let pending = 0;
  let inProgress = 0;
  let doneWeek = 0;
  let revisits = 0;
  for (const r of installRows) {
    if (r.status === 'pending' || r.status === 'scheduled') pending++;
    if (r.status === 'in_progress') inProgress++;
    if (r.status === 'needs_revisit') revisits++;
    if (r.status === 'done' && r.completed_at && r.completed_at >= d7Iso) doneWeek++;

    const tally = r.installer_id ? perTechMap.get(r.installer_id) : null;
    if (tally) {
      if (r.status === 'done') tally.done++;
      else if (openSet.has(r.status)) tally.open++;
    }
  }
  const perTech = [...perTechMap.values()].sort((a, b) => b.done - a.done);

  return (
    <>
      <AppHeader title={t('title')} />
      <DashboardOverview
        nowIso={now.toISOString()}
        reps={reps}
        territories={territories}
        visits={(visits ?? []) as DashboardOverviewProps['visits']}
        contacts={(contacts ?? []) as DashboardOverviewProps['contacts']}
        flagged={(flagged ?? []) as DashboardOverviewProps['flagged']}
        coverage={(coverage ?? []) as unknown as DashboardOverviewProps['coverage']}
      />
      <InstallationsSummary
        pending={pending}
        inProgress={inProgress}
        doneWeek={doneWeek}
        revisits={revisits}
        perTech={perTech}
      />
    </>
  );
}

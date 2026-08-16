import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import {
  DashboardOverview,
  type DashboardOverviewProps,
} from '@/components/dashboard/dashboard-overview';
import { DashboardTabs } from '@/components/dashboard/dashboard-tabs';
import { TechnicianTeamStats } from '@/components/stats/technician-team-stats';
import { loadInstallManagerData } from '@/lib/installations/manager-data';

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

  const [{ data: users }, { data: visits }, { data: contacts }, { data: flagged }, { data: turfs }, { data: coverage }] =
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
    ]);

  const installData = await loadInstallManagerData(supabase);

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

  return (
    <>
      <AppHeader title={t('title')} />
      <DashboardTabs
        commercial={
          <DashboardOverview
            nowIso={now.toISOString()}
            reps={reps}
            territories={territories}
            visits={(visits ?? []) as DashboardOverviewProps['visits']}
            contacts={(contacts ?? []) as DashboardOverviewProps['contacts']}
            flagged={(flagged ?? []) as DashboardOverviewProps['flagged']}
            coverage={(coverage ?? []) as unknown as DashboardOverviewProps['coverage']}
            installations={installData.installations}
          />
        }
        technician={
          <TechnicianTeamStats
            nowIso={now.toISOString()}
            installations={installData.installations}
            technicians={installData.technicians}
            territories={installData.territories}
          />
        }
      />
    </>
  );
}

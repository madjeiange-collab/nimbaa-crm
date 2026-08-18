import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { TechnicianTeamStats } from '@/components/stats/technician-team-stats';
import { loadInstallManagerData } from '@/lib/installations/manager-data';

export default async function TechniciansStatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('installation');

  const supabase = await createClient();
  const data = await loadInstallManagerData(supabase);

  return (
    <>
      <AppHeader title={t('techStatsTitle')} />
      <main className="mx-auto max-w-3xl p-4">
        <TechnicianTeamStats
          nowIso={new Date().toISOString()}
          installations={data.installations}
          technicians={data.technicians}
          territories={data.territories}
          canSeeManagerTools
        />
      </main>
    </>
  );
}

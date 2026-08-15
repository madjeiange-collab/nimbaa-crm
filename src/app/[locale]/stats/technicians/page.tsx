import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth/session';
import { AppHeader } from '@/components/shared/app-header';
import { TechnicianTeamStats } from '@/components/stats/technician-team-stats';

export default async function TechniciansStatsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('installation');

  return (
    <>
      <AppHeader title={t('techStatsTitle')} />
      <TechnicianTeamStats />
    </>
  );
}

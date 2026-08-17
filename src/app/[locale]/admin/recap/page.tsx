import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { RecapSettings } from '@/components/admin/recap-settings';

export default async function AdminRecapPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('adminRecap');
  const tAdmin = await getTranslations('admin');

  const supabase = await createClient();
  const [{ data: sched }, { data: goal }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'recap_schedule').maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', 'daily_visit_goal').maybeSingle(),
  ]);
  const hourVal = Number((sched?.value as { hour?: number } | null)?.hour);
  const goalVal = Number((goal?.value as { goal?: number } | null)?.goal);

  return (
    <>
      <AppHeader title={t('title')} />
      <main className="mx-auto max-w-2xl space-y-3 p-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {tAdmin('title')}
        </Link>
        <RecapSettings
          initialHour={Number.isInteger(hourVal) && hourVal >= 0 && hourVal <= 23 ? hourVal : 6}
          initialGoal={Number.isInteger(goalVal) && goalVal > 0 ? goalVal : 30}
        />
      </main>
    </>
  );
}

import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { InstallPipelineBoard } from '@/components/dashboard/install-pipeline-board';
import { loadInstallManagerData } from '@/lib/installations/manager-data';

export default async function InstallPipelinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('dashboard');

  const supabase = await createClient();
  const data = await loadInstallManagerData(supabase);

  return (
    <>
      <AppHeader title={t('installPipelineTitle')} />
      <main className="mx-auto max-w-6xl space-y-3 p-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <InstallPipelineBoard
          installations={data.installations}
          technicians={data.technicians}
          territories={data.territories}
        />
      </main>
    </>
  );
}

import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { getPointConfig } from '@/lib/leaderboard/score';
import { AppHeader } from '@/components/shared/app-header';
import { PointsEditor } from '@/components/admin/points-editor';

export default async function AdminPointsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('adminPoints');
  const tAdmin = await getTranslations('admin');

  const supabase = await createClient();
  const initial = await getPointConfig(supabase);

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
        <PointsEditor initial={initial} />
      </main>
    </>
  );
}

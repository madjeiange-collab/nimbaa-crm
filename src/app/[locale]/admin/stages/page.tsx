import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { StagesEditor, type StageRow } from '@/components/admin/stages-editor';

export default async function AdminStagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('adminStages');
  const tAdmin = await getTranslations('admin');

  const supabase = await createClient();
  const { data } = await supabase
    .from('pipeline_stages')
    .select('id, name, sort_order, is_won, is_lost, is_active, system_key')
    .order('sort_order');

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
        <StagesEditor initial={(data ?? []) as StageRow[]} />
      </main>
    </>
  );
}

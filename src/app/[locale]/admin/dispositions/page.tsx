import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { getDispositionConfig } from '@/lib/visits/disposition-config';
import { AppHeader } from '@/components/shared/app-header';
import { DispositionsEditor } from '@/components/admin/dispositions-editor';

export default async function AdminDispositionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('adminDispositions');
  const tAdmin = await getTranslations('admin');

  const supabase = await createClient();
  const initial = await getDispositionConfig(supabase);

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
        <DispositionsEditor initial={initial} />
      </main>
    </>
  );
}

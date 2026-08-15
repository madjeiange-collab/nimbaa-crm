import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { ProtocolEditor, type ProtocolStep } from '@/components/admin/protocol-editor';

export default async function AdminProtocolPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('admin');
  const tp = await getTranslations('protocol');

  const supabase = await createClient();
  const { data: steps } = await supabase
    .from('install_protocol_steps')
    .select('id, label, is_active')
    .order('sort_order', { ascending: true });

  return (
    <>
      <AppHeader title={tp('title')} subtitle={tp('subtitle')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <ProtocolEditor steps={(steps ?? []) as ProtocolStep[]} />
      </main>
    </>
  );
}

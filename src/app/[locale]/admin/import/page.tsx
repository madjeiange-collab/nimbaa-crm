import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { ImportContacts } from '@/components/admin/import-contacts';

export default async function AdminImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('adminImport');
  const tAdmin = await getTranslations('admin');

  const supabase = await createClient();
  const [{ data: terrs }, { data: reps }] = await Promise.all([
    supabase.from('territories').select('name').eq('is_active', true).order('name'),
    supabase.from('users').select('username, role, is_active').order('username'),
  ]);
  const territoryNames = ((terrs ?? []) as { name: string }[]).map((t2) => t2.name);
  const repUsernames = ((reps ?? []) as {
    username: string | null;
    role: string;
    is_active: boolean;
  }[])
    .filter((u) => u.is_active && u.username && (u.role === 'rep' || u.role === 'manager'))
    .map((u) => u.username!);

  return (
    <>
      <AppHeader title={t('title')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {tAdmin('title')}
        </Link>
        <ImportContacts territoryNames={territoryNames} repUsernames={repUsernames} />
      </main>
    </>
  );
}

import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { UsersManager, type AdminUser } from '@/components/admin/users-manager';

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const me = await requireRole(['admin']);
  const t = await getTranslations('admin');
  const tu = await getTranslations('adminUsers');

  const supabase = await createClient();
  const { data: users } = await supabase
    .from('users')
    .select('id, username, full_name, role, can_do_b2b, can_do_d2d, is_active, daily_goal')
    .order('created_at', { ascending: true });

  return (
    <>
      <AppHeader title={tu('title')} subtitle={tu('subtitle')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <UsersManager users={(users ?? []) as AdminUser[]} currentUserId={me.id} />
      </main>
    </>
  );
}

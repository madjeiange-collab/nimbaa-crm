import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { AppHeader } from '@/components/shared/app-header';
import { ChangePasswordForm } from './change-password-form';

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('home');

  return (
    <>
      <AppHeader title={user.full_name ?? user.username ?? ''} subtitle={user.username ?? ''} />
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <Link
          href="/home"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('greeting', { name: '' }).trim().replace(/,$/, '')}
        </Link>
        <ChangePasswordForm />
      </main>
    </>
  );
}

import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { LoginForm } from './login-form';

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Already signed in → go home.
  const user = await getCurrentUser();
  if (user) redirect({ href: '/home', locale });

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary/40 p-4">
      <LoginForm />
    </main>
  );
}

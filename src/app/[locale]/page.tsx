import { redirect } from '@/i18n/navigation';
import { setRequestLocale } from 'next-intl/server';

export default async function IndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Home gates on auth and routes by capability.
  redirect({ href: '/home', locale });
}

import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { AppHeader } from '@/components/shared/app-header';
import { NewContactForm } from '@/components/contacts/new-contact-form';

export default async function NewContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser();
  const t = await getTranslations('contacts');

  return (
    <>
      <AppHeader title={t('newTitle')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <NewContactForm />
      </main>
    </>
  );
}

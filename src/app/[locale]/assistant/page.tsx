import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/session';
import { AppHeader } from '@/components/shared/app-header';
import { AssistantChat } from '@/components/assistant/assistant-chat';

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireUser();
  const t = await getTranslations('assistant');

  return (
    <>
      <AppHeader title={t('title')} subtitle={t('subtitle')} />
      <main>
        <AssistantChat />
      </main>
    </>
  );
}

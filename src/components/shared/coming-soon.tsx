import { getTranslations } from 'next-intl/server';
import { ArrowLeft, Hammer } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { AppHeader } from '@/components/shared/app-header';
import { Card, CardContent } from '@/components/ui/card';

/** Placeholder for screens delivered in a later phase. */
export async function ComingSoon({ title, phase }: { title: string; phase: string }) {
  const t = await getTranslations('common');
  return (
    <>
      <AppHeader title={title} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/home"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('home')}
        </Link>
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <Hammer className="h-6 w-6 text-muted-foreground" />
            <div>
              <p className="font-medium">{t('comingSoon')}</p>
              <p className="text-sm text-muted-foreground">{t('comingSoonPhase', { phase })}</p>
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  );
}

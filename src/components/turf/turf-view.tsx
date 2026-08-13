'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { DoorOpen } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui/card';
import type { TurfKnock } from '@/components/map/turf-map';

const TurfMap = dynamic(() => import('@/components/map/turf-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">…</div>
  ),
});

export function TurfView({
  polygons,
  knocks,
}: {
  polygons: number[][][][];
  knocks: TurfKnock[];
}) {
  const t = useTranslations('turf');

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
      {polygons.length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">{t('noTurf')}</Card>
      )}

      <Card className="overflow-hidden">
        <div className="h-[60vh] min-h-[380px] w-full">
          {/* Counts legend is overlaid on the map itself */}
          <TurfMap polygons={polygons} knocks={knocks} />
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{t('knocks', { count: knocks.length })}</p>
        <Link
          href="/visit/new"
          className="inline-flex min-h-touch items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <DoorOpen className="h-4 w-4" />
          {t('logHere')}
        </Link>
      </div>
    </main>
  );
}

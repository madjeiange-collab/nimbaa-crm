'use client';

import dynamic from 'next/dynamic';
import type { InstallPoint, TurfKnock } from '@/components/map/turf-map';

const TurfMap = dynamic(() => import('@/components/map/turf-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">…</div>
  ),
});

/** Personal coverage map: the rep's own knocks (period) on their turf. */
export function CoverageMap({
  polygons,
  knocks,
  installs,
}: {
  polygons: number[][][][];
  knocks: TurfKnock[];
  installs?: InstallPoint[];
}) {
  return (
    <div className="h-[60vh] min-h-[420px] w-full overflow-hidden rounded-lg border">
      <TurfMap polygons={polygons} knocks={knocks} installs={installs} />
    </div>
  );
}

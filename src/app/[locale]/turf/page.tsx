import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { TurfView } from '@/components/turf/turf-view';
import type { TurfKnock } from '@/components/map/turf-map';

export default async function TurfPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('turf');

  const supabase = await createClient();

  const { data: turfs } = await supabase.rpc('territories_geojson');
  const turfRows = ((turfs ?? []) as {
    name?: string | null;
    geojson?: { coordinates?: number[][][] };
  }[]).filter((row) => row.geojson?.coordinates);
  const polygons: number[][][][] = turfRows.map((row) => row.geojson!.coordinates!);
  const turfNames = turfRows.map((row) => row.name ?? '—');

  // The rep's own knocks (with coordinates).
  const { data: visits } = await supabase
    .from('visits')
    .select('id, lat, lng, disposition')
    .eq('rep_id', user.id)
    .eq('visit_type', 'd2d_knock')
    .not('lat', 'is', null);

  const knocks: TurfKnock[] = (visits ?? []).filter(
    (v: TurfKnock) => v.lat != null && v.lng != null,
  );

  return (
    <>
      <AppHeader title={t('title')} />
      <TurfView polygons={polygons} knocks={knocks} turfNames={turfNames} />
    </>
  );
}

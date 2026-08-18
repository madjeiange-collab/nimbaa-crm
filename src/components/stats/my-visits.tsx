import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';
import { StatTile } from '@/components/charts/stat-tile';
import { Donut } from '@/components/charts/donut';
import { dispositionCssColor, type KnockDisposition } from '@/lib/visits/dispositions';

/** Outcomes that mean the customer engaged rather than merely opened the door. */
const ENGAGED: KnockDisposition[] = ['interested', 'appointment_set', 'sold'];

const ORDER: KnockDisposition[] = [
  'no_answer',
  'not_home',
  'refused',
  'interested',
  'appointment_set',
  'sold',
];

function colorOf(k: KnockDisposition) {
  return dispositionCssColor(
    k === 'refused'
      ? 'red'
      : k === 'interested' || k === 'appointment_set'
        ? 'yellow'
        : k === 'sold'
          ? 'green'
          : 'grey',
  );
}

/**
 * A technician's own commercial visits.
 *
 * A technician can log a visit — a diagnostic call is not a knock, but it is
 * still a visit — yet the statistics page branched on role and showed only
 * chantiers, so those visits went nowhere. This is the mirror of the
 * installation block a commercial now gets: what came of the doors I opened,
 * without the door-knocking goal and pipeline a technician has no use for.
 *
 * Renders nothing until there is something to show.
 */
export async function MyVisits({ userId }: { userId: string }) {
  const t = await getTranslations('stats');
  const tDisp = await getTranslations('dispositions');
  const supabase = await createClient();

  const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const d7 = new Date(Date.now() - 7 * 864e5).toISOString();

  const { data, error } = await supabase
    .from('visits')
    .select('id, disposition, visited_at')
    .eq('rep_id', userId)
    .neq('visit_type', 'installation')
    .gte('visited_at', d30);
  if (error) return null;

  const rows = (data ?? []) as { id: string; disposition: KnockDisposition | null; visited_at: string }[];
  if (rows.length === 0) return null;

  const week = rows.filter((v) => v.visited_at >= d7).length;
  const engaged = rows.filter((v) => v.disposition && ENGAGED.includes(v.disposition)).length;
  const sold = rows.filter((v) => v.disposition === 'sold').length;
  const rate = rows.length > 0 ? Math.round((engaged / rows.length) * 100) : 0;

  const segments = ORDER.map((k) => ({
    label: tDisp(k),
    value: rows.filter((v) => v.disposition === k).length,
    color: colorOf(k),
  })).filter((s) => s.value > 0);

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <p className="text-sm font-semibold">{t('myVisitsTitle')}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label={t('myVisitsWeek')} value={week} accent="primary" />
          <StatTile label={t('myVisitsMonth')} value={rows.length} accent="green" />
          <StatTile label={t('myVisitsEngaged')} value={engaged} accent="amber" />
          <StatTile label={t('myVisitsSold')} value={sold} accent="green" />
        </div>
        <p className="text-xs text-muted-foreground">{t('myVisitsRate', { pct: rate })}</p>
        {segments.length > 0 && <Donut segments={segments} />}
      </CardContent>
    </Card>
  );
}

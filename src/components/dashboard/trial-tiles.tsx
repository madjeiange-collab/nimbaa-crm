import 'server-only';

import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { StatTile } from '@/components/charts/stat-tile';
import { ENDING_SOON_DAYS, addDays, todayKey, type TrialRow } from '@/lib/deals/trial';

/** Below this many finished trials, a percentage is one anecdote wearing a % sign. */
const MIN_FOR_RATE = 5;

/**
 * What the trials are costing, in one line.
 *
 * The number that matters is "échus, sans décision": a trial past its date with
 * nobody having said yes or no is equipment lent out by accident. Everything
 * else is context for it — which is why only that one and "ending this week"
 * ever take a colour.
 */
export async function TrialTiles({ showMoney }: { showMoney: boolean }) {
  const t = await getTranslations('trials');
  const supabase = await createClient();

  const today = todayKey();
  const { data, error } = await supabase
    .from('deal_trials')
    .select('id, deal_id, contact_id, seq, started_on, ends_on, ended_on, outcome, installation_id, extensions')
    .limit(1000);
  // Pre-0032 database: no table, no band. The rest of the dashboard is fine.
  if (error) return null;

  const trials = (data ?? []) as unknown as TrialRow[];
  if (trials.length === 0) return null;

  const running = trials.filter((x) => x.outcome === null);
  const soon = running.filter(
    (x) => x.ends_on >= today && x.ends_on <= addDays(today, ENDING_SOON_DAYS),
  );
  const overdue = running.filter((x) => x.ends_on < today);
  const closed = trials.filter((x) => x.outcome === 'converted' || x.outcome === 'declined');
  const converted = closed.filter((x) => x.outcome === 'converted').length;

  // Only affaires whose trial actually put equipment on site count as lent.
  let lent = 0;
  if (showMoney) {
    const ids = running.filter((x) => x.installation_id).map((x) => x.deal_id);
    if (ids.length > 0) {
      const { data: deals } = await supabase.from('deals').select('value_xof').in('id', ids);
      lent = (deals ?? []).reduce(
        (s, d) => s + ((d as { value_xof: number | null }).value_xof ?? 0),
        0,
      );
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      {/* Same grid and the same tile component as every other KPI row, so the
          band reads as part of the page rather than pasted above it. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={t('running')} value={running.length} accent="primary" />
        <StatTile
          label={t('endingSoon')}
          value={soon.length}
          accent={soon.length ? 'amber' : 'muted'}
        />
        <StatTile
          label={t('overdue')}
          value={overdue.length}
          accent={overdue.length ? 'red' : 'muted'}
        />
        {showMoney && <StatTile label={t('lentOut')} value={`${lent.toLocaleString('fr-FR')} F`} accent="muted" />}
      </div>
      {/* A rate needs a denominator worth dividing by: "100 %" off one finished
          trial says nothing and reads as a claim. */}
      {closed.length >= MIN_FOR_RATE && (
        <p className="text-xs text-muted-foreground">
          {t('convertedRateLine', {
            pct: Math.round((converted / closed.length) * 100),
            n: closed.length,
          })}
        </p>
      )}
      {overdue.length > 0 && <p className="text-xs text-brand-brown">{t('overdueHint')}</p>}
    </section>
  );
}

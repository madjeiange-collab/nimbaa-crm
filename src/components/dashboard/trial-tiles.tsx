import 'server-only';

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { ENDING_SOON_DAYS, addDays, todayKey, type TrialRow } from '@/lib/deals/trial';

/**
 * What the trials are costing, in one line.
 *
 * The number that matters is "échu, sans décision": a trial past its date with
 * nobody having said yes or no is equipment lent out by accident. Everything
 * else here is context for it.
 */
export async function TrialTiles({ showMoney }: { showMoney: boolean }) {
  const t = await getTranslations('trials');
  const supabase = await createClient();

  const today = todayKey();
  const { data, error } = await supabase
    .from('deal_trials')
    .select('id, deal_id, contact_id, seq, started_on, ends_on, ended_on, outcome, installation_id, extensions')
    .limit(1000);
  // Pre-0032 database: no table, no tiles. The rest of the dashboard is fine.
  if (error) return null;

  const trials = (data ?? []) as unknown as TrialRow[];
  if (trials.length === 0) return null;

  const running = trials.filter((x) => x.outcome === null);
  const soon = running.filter((x) => x.ends_on >= today && x.ends_on <= addDays(today, ENDING_SOON_DAYS));
  const overdue = running.filter((x) => x.ends_on < today);
  const closed = trials.filter((x) => x.outcome === 'converted' || x.outcome === 'declined');
  const convertedPct =
    closed.length > 0
      ? Math.round((closed.filter((x) => x.outcome === 'converted').length / closed.length) * 100)
      : null;

  // What is physically out: the value of the affaires whose trial is running
  // and actually put equipment on site.
  let lent = 0;
  if (showMoney) {
    const ids = running.filter((x) => x.installation_id).map((x) => x.deal_id);
    if (ids.length > 0) {
      const { data: deals } = await supabase.from('deals').select('value_xof').in('id', ids);
      lent = (deals ?? []).reduce((s, d) => s + ((d as { value_xof: number | null }).value_xof ?? 0), 0);
    }
  }

  const tiles: { n: string; label: string; warn?: boolean }[] = [
    { n: String(running.length), label: t('running') },
    { n: String(soon.length), label: t('endingSoon'), warn: soon.length > 0 },
    { n: String(overdue.length), label: t('overdue'), warn: overdue.length > 0 },
    ...(convertedPct != null ? [{ n: `${convertedPct} %`, label: t('convertedRate') }] : []),
    ...(showMoney && lent > 0
      ? [{ n: `${lent.toLocaleString('fr-FR')} F`, label: t('lentOut') }]
      : []),
  ];

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{t('title')}</h2>
      <div className="flex flex-wrap gap-2">
        {tiles.map((x) => (
          <div
            key={x.label}
            className={`min-w-[110px] rounded-lg border p-2.5 ${
              x.warn ? 'border-brand-amber/50 bg-brand-amber/10' : 'bg-card'
            }`}
          >
            <p
              className={`text-xl font-semibold [font-variant-numeric:tabular-nums] ${
                x.warn ? 'text-brand-brown' : ''
              }`}
            >
              {x.n}
            </p>
            <p className="text-xs text-muted-foreground">{x.label}</p>
          </div>
        ))}
      </div>
      {overdue.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('overdueHint')}{' '}
          <Link href="/dashboard/pipeline" className="underline">
            {t('overdueLink')}
          </Link>
        </p>
      )}
    </section>
  );
}

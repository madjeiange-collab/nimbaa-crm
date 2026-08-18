/** Periods offered on Check-In and -Out, shared by the page and the journal. */
export const PERIODS = ['day', 'week', '14d', 'month', 'year', 'all'] as const;
export type Period = (typeof PERIODS)[number];

export const DEFAULT_PERIOD: Period = '14d';

export function asPeriod(value: string | undefined): Period {
  return PERIODS.includes(value as Period) ? (value as Period) : DEFAULT_PERIOD;
}

/**
 * Lower bound of the window, or null for "everything". "day" means since
 * midnight in Abidjan (= UTC), not the last 24 h — a rep asking about today
 * means today.
 */
export function periodSince(p: Period, now: Date = new Date()): string | null {
  if (p === 'all') return null;
  if (p === 'day') {
    const midnight = new Date(now);
    midnight.setUTCHours(0, 0, 0, 0);
    return midnight.toISOString();
  }
  const days = { week: 7, '14d': 14, month: 30, year: 365 }[p];
  return new Date(now.getTime() - days * 864e5).toISOString();
}

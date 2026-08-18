/**
 * One calendar day in Abidjan, written YYYY-MM-DD.
 *
 * Abidjan is UTC all year, so a day boundary is plain midnight UTC — no offset
 * table, no daylight saving. Everything here leans on that; if the CRM ever
 * serves a second timezone, this file is the one place that has to change.
 */

/** How far back the picker goes. Beyond this a "review meeting" is history. */
export const MAX_LOOKBACK_DAYS = 180;

const VALID = /^\d{4}-\d{2}-\d{2}$/;

export const dayKeyOf = (d: Date): string => d.toISOString().slice(0, 10);

/** Midnight UTC of a day key. */
export const dayStart = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** The window covering one whole day, both bounds inclusive. */
export function dayWindow(day: string): { sinceIso: string; untilIso: string } {
  const s = dayStart(day);
  return {
    sinceIso: s.toISOString(),
    untilIso: new Date(s.getTime() + 864e5 - 1).toISOString(),
  };
}

export const shiftDay = (day: string, n: number): string =>
  dayKeyOf(new Date(dayStart(day).getTime() + n * 864e5));

/**
 * The day to show. A malformed, future or too-old ?d= falls back to today: a
 * bad link should land on the day that matters, not on an error page.
 */
export function asDayKey(value: string | undefined, now: Date = new Date()): string {
  const today = dayKeyOf(now);
  if (!value || !VALID.test(value)) return today;
  const d = dayStart(value);
  // Date.parse rejects 2026-02-31 outright; the round-trip check is belt and
  // braces for anything a future engine decides to be lenient about.
  if (Number.isNaN(d.getTime()) || dayKeyOf(d) !== value) return today;
  if (value > today || value < shiftDay(today, -MAX_LOOKBACK_DAYS)) return today;
  return value;
}

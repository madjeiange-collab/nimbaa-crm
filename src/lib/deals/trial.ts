/**
 * Trial vocabulary shared by the server actions, the deal card and the
 * manager tiles. No 'server-only' here on purpose: the card renders from it.
 */

/** Out of the box. Admin-settable via app_settings key `trial_days`. */
export const DEFAULT_TRIAL_DAYS = 30;

/** Pushes a rep may make alone. The next one is a manager's. */
export const FREE_EXTENSIONS = 1;

/**
 * Past this many days on site, the technician's line ripens whatever the
 * customer has decided. Beyond two months the wait stops being "the sale has
 * not closed yet" and becomes not paying someone for work they finished.
 */
export const TECH_BACKSTOP_DAYS = 60;

/** A trial is "about to end" this many days out — what the manager tile counts. */
export const ENDING_SOON_DAYS = 7;

export interface TrialExtension {
  at: string;
  by: string | null;
  to: string;
  note: string | null;
}

export interface TrialRow {
  id: string;
  deal_id: string;
  contact_id: string | null;
  seq: number;
  started_on: string;
  ends_on: string;
  ended_on: string | null;
  outcome: 'converted' | 'declined' | 'superseded' | null;
  installation_id: string | null;
  extensions: TrialExtension[];
}

/** Abidjan is UTC, so a calendar day is a plain slice. */
export const todayKey = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export const addDays = (day: string, n: number): string =>
  new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

/** Whole days between two day keys, b − a. */
export const daysBetween = (a: string, b: string): number =>
  Math.round(
    (new Date(`${b}T00:00:00.000Z`).getTime() - new Date(`${a}T00:00:00.000Z`).getTime()) / 864e5,
  );

/** Days left on a running trial. Negative once it is overdue. */
export const daysLeft = (trial: TrialRow, today = todayKey()): number =>
  daysBetween(today, trial.ends_on);

/**
 * Days the equipment has been at this customer, across every period.
 *
 * Deliberately cumulative: "J-4" on a third extension reads as almost over,
 * when the honest number is seventy-five days on someone's counter.
 */
export function daysOnSite(trials: TrialRow[], today = todayKey()): number {
  let total = 0;
  for (const t of trials) {
    if (!t.installation_id) continue;
    total += Math.max(0, daysBetween(t.started_on, t.ended_on ?? today));
  }
  return total;
}

export const isRunning = (t: TrialRow) => t.outcome === null;
export const isOverdue = (t: TrialRow, today = todayKey()) => isRunning(t) && t.ends_on < today;

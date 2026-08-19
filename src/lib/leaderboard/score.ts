import type { SupabaseClient } from '@supabase/supabase-js';
import { avatarPublicUrl } from '@/lib/avatar';

/** Admin-configurable point values (app_settings key 'leaderboard_points'). */
export interface PointConfig {
  visit: number;
  interested: number;
  appointment: number;
  deal_won: number;
  install_done: number;
  revisit: number;
  /** Putting equipment out on trial — real progress, short of a sale. */
  trial_started: number;
  /** The trial pose itself: same work as any installation. */
  trial_install_done: number;
  /** Fetching the kit back when a trial fails. Work, with no revenue behind it. */
  retrieval_done: number;
}

export const DEFAULT_POINTS: PointConfig = {
  visit: 1,
  interested: 3,
  appointment: 5,
  deal_won: 20,
  install_done: 20,
  revisit: 5,
  trial_started: 10,
  trial_install_done: 20,
  retrieval_done: 5,
};

export async function getPointConfig(db: SupabaseClient): Promise<PointConfig> {
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('key', 'leaderboard_points')
    .maybeSingle();
  const stored = (data?.value ?? {}) as Partial<PointConfig>;
  const merged = { ...DEFAULT_POINTS, ...stored };
  // Guard against bad stored values — the board must never NaN.
  for (const k of Object.keys(merged) as (keyof PointConfig)[]) {
    if (!Number.isFinite(merged[k]) || merged[k] < 0) merged[k] = DEFAULT_POINTS[k];
  }
  return merged;
}

export type RepBoardRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  points: number;
  visits: number;
  refused: number;
  interested: number;
  rdv: number;
  sales: number;
  leads: number;
  /** % of visits that became interested/RDV/sold. */
  engagementPct: number;
  /** % of engaged visits that became a sale. */
  conversionPct: number;
  /** Kept for the recap prompt — never rendered on the board. */
  fcfa: number;
};

export type TechBoardRow = {
  /** Trial poses finished in the window — never mixed into `done`. */
  trialInstalls: number;
  /** Kit fetched back after a trial fell through. */
  retrievals: number;
  id: string;
  name: string;
  avatarUrl: string | null;
  points: number;
  done: number;
  revisits: number;
  open: number;
  /** % of the period's workload (done + open) that is completed. */
  completionPct: number;
};

/**
 * Computes both boards for the period starting at `sinceIso` (optionally
 * bounded by `untilIso` — used for "prior week to date" comparisons).
 * Expects a privileged client (reps can't read colleagues under RLS);
 * only names + counts leave this function.
 */
export async function computeBoards(
  db: SupabaseClient,
  sinceIso: string,
  pts: PointConfig,
  untilIso?: string,
): Promise<{ reps: RepBoardRow[]; techs: TechBoardRow[] }> {
  let visitsQ = db
    .from('visits')
    .select('rep_id, disposition, visit_type')
    .gte('visited_at', sinceIso)
    .limit(10000);
  if (untilIso) visitsQ = visitsQ.lt('visited_at', untilIso);
  let dealsQ = db
    .from('deals')
    .select('assigned_rep_id, value_xof')
    .eq('status', 'won')
    .gte('won_at', sinceIso)
    .limit(5000);
  if (untilIso) dealsQ = dealsQ.lt('won_at', untilIso);
  let contactsQ = db
    .from('contacts')
    .select('created_by, lifecycle')
    .gte('created_at', sinceIso)
    .limit(10000);
  if (untilIso) contactsQ = contactsQ.lt('created_at', untilIso);

  const [
    { data: users },
    { data: visits },
    { data: deals },
    { data: installs },
    { data: contacts },
    { data: trials },
  ] = await Promise.all([
    db.from('users').select('id, full_name, username, avatar_path, role, is_active'),
    visitsQ,
    dealsQ,
    db
      .from('installations')
      .select('installer_id, status, completed_at, next_visit_date, origin')
      .limit(5000),
    contactsQ,
    db
      .from('deal_trials')
      .select('created_by, created_at')
      .gte('created_at', sinceIso)
      .limit(2000),
  ]);
  const trialsBy = (id: string) =>
    (trials ?? []).filter(
      (t) =>
        (t as { created_by: string | null }).created_by === id &&
        (!untilIso || (t as { created_at: string }).created_at < untilIso),
    ).length;

  const active = (users ?? []).filter((u) => u.is_active);
  const nameOf = (u: { full_name: string | null; username: string | null; id: string }) =>
    u.full_name || u.username || u.id.slice(0, 8);
  const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

  const reps: RepBoardRow[] = active
    .filter((u) => u.role === 'rep' || u.role === 'manager')
    .map((u) => {
      const mine = (visits ?? []).filter(
        (v) => v.rep_id === u.id && v.visit_type !== 'installation',
      );
      const refused = mine.filter((v) => v.disposition === 'refused').length;
      const interested = mine.filter((v) => v.disposition === 'interested').length;
      const rdv = mine.filter((v) => v.disposition === 'appointment_set').length;
      const soldDisp = mine.filter((v) => v.disposition === 'sold').length;
      const engaged = interested + rdv + soldDisp;
      const myDeals = (deals ?? []).filter((d) => d.assigned_rep_id === u.id);
      const fcfa = myDeals.reduce((s, d) => s + (d.value_xof ?? 0), 0);
      const leads = (contacts ?? []).filter(
        (c) => c.created_by === u.id && c.lifecycle === 'lead',
      ).length;
      return {
        id: u.id,
        name: nameOf(u),
        avatarUrl: avatarPublicUrl(u.avatar_path),
        visits: mine.length,
        refused,
        interested,
        rdv,
        sales: myDeals.length,
        leads,
        engagementPct: pct(engaged, mine.length),
        conversionPct: pct(myDeals.length, engaged),
        fcfa,
        points:
          mine.length * pts.visit +
          interested * pts.interested +
          rdv * pts.appointment +
          myDeals.length * pts.deal_won +
          trialsBy(u.id) * pts.trial_started,
      };
    })
    .filter((r) => r.points > 0 || r.visits > 0)
    .sort((x, y) => y.points - x.points || y.sales - x.sales);

  const techs: TechBoardRow[] = active
    .filter((u) => u.role === 'technician')
    .map((u) => {
      const mine = (installs ?? []).filter((i) => i.installer_id === u.id);
      const finished = mine.filter(
        (i) =>
          i.status === 'done' &&
          i.completed_at &&
          i.completed_at >= sinceIso &&
          (!untilIso || i.completed_at < untilIso),
      );
      const originOf = (i: unknown) => (i as { origin?: string | null }).origin ?? 'sale';
      const done = finished.filter((i) => !['trial', 'retrieval'].includes(originOf(i))).length;
      const trialInstalls = finished.filter((i) => originOf(i) === 'trial').length;
      const retrievals = finished.filter((i) => originOf(i) === 'retrieval').length;
      // Only jobs still owed a return trip. Counting finished ones that had
      // been scheduled for a return used to pay 20 + 5 for a job that needed a
      // second visit, against 20 for one fixed on the first — a bonus for the
      // worse outcome. A return trip is work in hand, not an achievement.
      const revisits = mine.filter((i) => i.status === 'needs_revisit').length;
      const open = mine.filter((i) =>
        ['pending', 'scheduled', 'in_progress', 'needs_revisit'].includes(i.status),
      ).length;
      return {
        id: u.id,
        name: nameOf(u),
        avatarUrl: avatarPublicUrl(u.avatar_path),
        done,
        revisits,
        open,
        completionPct: pct(done, done + open),
        trialInstalls,
        retrievals,
        // Points land at the pose, money at the conversion. Not a
        // contradiction: the board measures the week's work, the ledger
        // follows the revenue, and a technician's week should not read empty
        // because a customer has not made up their mind.
        points:
          done * pts.install_done +
          revisits * pts.revisit +
          trialInstalls * pts.trial_install_done +
          retrievals * pts.retrieval_done,
      };
    })
    .filter((r) => r.points > 0 || r.open > 0)
    .sort((x, y) => y.points - x.points || y.done - x.done);

  return { reps, techs };
}

/** Monday 00:00 of the current week (local server time). */
export function startOfWeekIso(): string {
  const now = new Date();
  const since = new Date(now);
  const day = (now.getDay() + 6) % 7;
  since.setDate(now.getDate() - day);
  since.setHours(0, 0, 0, 0);
  return since.toISOString();
}

export function startOfTodayIso(): string {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  return since.toISOString();
}

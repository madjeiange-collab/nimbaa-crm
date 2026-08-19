'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getTemplateChecklist } from '@/lib/installations/template';
import { recomputeContactRollup } from '@/lib/deals/rollup';
import { ensureCommissionForWonDeal, settleTrialCommissions } from '@/lib/commissions/core';
import {
  DEFAULT_TRIAL_DAYS,
  FREE_EXTENSIONS,
  addDays,
  todayKey,
  type TrialRow,
} from '@/lib/deals/trial';

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidate(contactId: string) {
  revalidatePath('/[locale]/contacts', 'page');
  revalidatePath(`/[locale]/contacts/${contactId}`, 'page');
  revalidatePath('/[locale]/dashboard/pipeline', 'page');
  revalidatePath('/[locale]/dashboard', 'page');
  revalidatePath('/[locale]/installs', 'page');
}

type Ctx = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  isManager: boolean;
};

async function ctx(): Promise<Ctx | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    supabase: await createClient(),
    userId: user.id,
    isManager: user.role === 'manager' || user.role === 'admin',
  };
}

/** The period still running on this affaire, if any. */
async function openTrial(c: Ctx, dealId: string): Promise<TrialRow | null> {
  const { data } = await c.supabase
    .from('deal_trials')
    .select('*')
    .eq('deal_id', dealId)
    .is('outcome', null)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as TrialRow) ?? null;
}

/** How long a trial runs by default — admin-settable, 30 days out of the box. */
async function trialDays(c: Ctx): Promise<number> {
  const { data } = await c.supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'trial_days')
    .maybeSingle();
  const n = Number((data?.value as { days?: number } | null)?.days);
  return Number.isFinite(n) && n > 0 && n <= 365 ? Math.round(n) : DEFAULT_TRIAL_DAYS;
}

/** The reminder lives on the period, so extending moves it rather than piling up. */
async function syncTrialTask(
  c: Ctx,
  trial: { id: string; deal_id: string; contact_id: string | null; ends_on: string; seq: number },
  dealTitle: string | null,
  contactName: string | null,
) {
  try {
    const due = `${trial.ends_on}T08:00:00.000Z`; // Abidjan = UTC
    const { data: existing } = await c.supabase
      .from('tasks')
      .select('id')
      .eq('deal_id', trial.deal_id)
      .eq('kind', 'trial_end')
      .eq('status', 'open')
      .maybeSingle();
    const row = {
      contact_id: trial.contact_id,
      deal_id: trial.deal_id,
      kind: 'trial_end' as const,
      title: contactName ? `Fin d'essai — ${contactName}` : "Fin d'essai",
      details: dealTitle,
      due_at: due,
      assigned_to: c.userId,
      created_by: c.userId,
      updated_at: new Date().toISOString(),
    };
    if (existing) await c.supabase.from('tasks').update(row).eq('id', existing.id);
    else await c.supabase.from('tasks').insert(row);
  } catch {
    // Pre-migration DB, or the kind constraint not yet widened — never let the
    // reminder take the trial down with it.
  }
}

async function closeTrialTask(c: Ctx, dealId: string) {
  try {
    await c.supabase
      .from('tasks')
      .update({ status: 'done', completed_at: new Date().toISOString(), completed_by: c.userId })
      .eq('deal_id', dealId)
      .eq('kind', 'trial_end')
      .eq('status', 'open');
  } catch {
    /* same */
  }
}

/**
 * Put an affaire on trial: the equipment goes out, the customer stays a
 * prospect. Called when the stage is moved to Essai, and again for a second
 * trial after a first one ended.
 *
 * A second period is a manager's call. A rep who can start trials at will can
 * keep a customer in equipment indefinitely without ever recording a loss.
 */
export async function startTrial(
  dealId: string,
  opts?: { endsOn?: string | null },
): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: 'unauthenticated' };

  const { data: deal } = await c.supabase
    .from('deals')
    .select('id, contact_id, title, needs_installation, contacts(name)')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return { ok: false, error: 'not_found' };

  const running = await openTrial(c, dealId);
  if (running) return { ok: true }; // already on trial — moving the stage twice is harmless

  const { count } = await c.supabase
    .from('deal_trials')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', dealId);
  const seq = (count ?? 0) + 1;
  if (seq > 1 && !c.isManager) return { ok: false, error: 'manager_only_second_trial' };

  const days = await trialDays(c);
  const ends = opts?.endsOn || addDays(todayKey(), days);

  // The pose only happens if the affaire wants one and nothing is on site yet.
  let installationId: string | null = null;
  if (deal.needs_installation) {
    const { data: live } = await c.supabase
      .from('installations')
      .select('id')
      .eq('deal_id', dealId)
      .in('status', ['pending', 'scheduled', 'in_progress', 'needs_revisit'])
      .limit(1)
      .maybeSingle();
    if (live) {
      installationId = live.id;
    } else {
      const checklist = await getTemplateChecklist(c.supabase);
      const { data: made } = await c.supabase
        .from('installations')
        .insert({
          deal_id: dealId,
          contact_id: deal.contact_id,
          title: deal.title ?? null,
          status: 'pending',
          origin: 'trial',
          checklist,
          created_by: c.userId,
        })
        .select('id')
        .maybeSingle();
      installationId = made?.id ?? null;
    }
  }

  const { data: trial, error } = await c.supabase
    .from('deal_trials')
    .insert({
      deal_id: dealId,
      contact_id: deal.contact_id,
      seq,
      started_on: todayKey(),
      ends_on: ends,
      installation_id: installationId,
      created_by: c.userId,
    })
    .select('id, deal_id, contact_id, ends_on, seq')
    .maybeSingle();
  if (error || !trial) return { ok: false, error: 'save_failed' };

  const name = (deal as unknown as { contacts?: { name: string | null } | null }).contacts?.name ?? null;
  await syncTrialTask(c, trial, deal.title, name);
  revalidate(deal.contact_id);
  return { ok: true };
}

/**
 * Push the end date out. The first push is the rep's; the next needs a
 * manager, which is the only thing standing between "encore une semaine" and
 * a kit that never comes back.
 */
export async function extendTrial(
  dealId: string,
  endsOn: string,
  note: string,
): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: 'unauthenticated' };

  const trial = await openTrial(c, dealId);
  if (!trial) return { ok: false, error: 'no_open_trial' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || endsOn <= trial.ends_on) {
    return { ok: false, error: 'date_must_move_forward' };
  }
  const used = Array.isArray(trial.extensions) ? trial.extensions.length : 0;
  if (used >= FREE_EXTENSIONS && !c.isManager) {
    return { ok: false, error: 'manager_only_extension' };
  }

  const { data: deal } = await c.supabase
    .from('deals')
    .select('title, contact_id, contacts(name)')
    .eq('id', dealId)
    .maybeSingle();

  const { error } = await c.supabase
    .from('deal_trials')
    .update({
      ends_on: endsOn,
      extensions: [
        ...(trial.extensions ?? []),
        { at: todayKey(), by: c.userId, to: endsOn, note: note.trim().slice(0, 200) || null },
      ],
      updated_at: new Date().toISOString(),
    })
    .eq('id', trial.id);
  if (error) return { ok: false, error: 'save_failed' };

  const name = (deal as unknown as { contacts?: { name: string | null } | null })?.contacts?.name ?? null;
  await syncTrialTask(
    c,
    { ...trial, ends_on: endsOn },
    deal?.title ?? null,
    name,
  );
  if (trial.contact_id) revalidate(trial.contact_id);
  return { ok: true };
}

/**
 * The trial convinced: the affaire is won, so everything a sale normally does
 * happens now — subscription, commercial commission, and the technician's line
 * ripening from "à venir" to "acquise".
 */
export async function convertTrial(dealId: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: 'unauthenticated' };

  const [{ data: wonStage }, { data: deal }] = await Promise.all([
    c.supabase.from('pipeline_stages').select('id').eq('is_won', true).limit(1).maybeSingle(),
    c.supabase.from('deals').select('contact_id, won_at').eq('id', dealId).maybeSingle(),
  ]);
  if (!deal || !wonStage) return { ok: false, error: 'not_found' };

  const now = new Date().toISOString();
  const { error } = await c.supabase
    .from('deals')
    .update({
      pipeline_stage_id: wonStage.id,
      status: 'won',
      won_at: deal.won_at ?? now,
      updated_at: now,
    })
    .eq('id', dealId);
  if (error) return { ok: false, error: 'save_failed' };

  const trial = await openTrial(c, dealId);
  if (trial) {
    await c.supabase
      .from('deal_trials')
      .update({ outcome: 'converted', ended_on: todayKey(), updated_at: now })
      .eq('id', trial.id);
  }
  await closeTrialTask(c, dealId);
  await ensureCommissionForWonDeal(c.supabase, dealId);
  await settleTrialCommissions(c.supabase, dealId, 'earned');
  await recomputeContactRollup(c.supabase, deal.contact_id);
  revalidate(deal.contact_id);
  return { ok: true };
}

/**
 * The trial did not convince. The affaire is lost AND a dépose is opened —
 * without it the equipment stays out and nobody is tasked with fetching it,
 * which is the quiet way a trial programme turns into giving stock away.
 */
export async function declineTrial(dealId: string, reason: string): Promise<ActionResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: 'unauthenticated' };

  const [{ data: lostStage }, { data: deal }] = await Promise.all([
    c.supabase.from('pipeline_stages').select('id').eq('is_lost', true).limit(1).maybeSingle(),
    c.supabase.from('deals').select('contact_id, title').eq('id', dealId).maybeSingle(),
  ]);
  if (!deal) return { ok: false, error: 'not_found' };

  const now = new Date().toISOString();
  const { error } = await c.supabase
    .from('deals')
    .update({
      status: 'lost',
      lost_reason: reason.trim() || null,
      pipeline_stage_id: lostStage?.id ?? null,
      updated_at: now,
    })
    .eq('id', dealId);
  if (error) return { ok: false, error: 'save_failed' };

  const trial = await openTrial(c, dealId);
  if (trial) {
    await c.supabase
      .from('deal_trials')
      .update({ outcome: 'declined', ended_on: todayKey(), updated_at: now })
      .eq('id', trial.id);
  }

  // A dépose is only owed if equipment actually reached the customer. A trial
  // called off before anyone posed anything has nothing to fetch back, and
  // sending a technician for it wastes a trip — the pose in that case is a
  // plan that never happened, so it is cleared rather than left open.
  if (trial?.installation_id) {
    const { data: pose } = await c.supabase
      .from('installations')
      .select('id, status')
      .eq('id', trial.installation_id)
      .maybeSingle();
    const wentOut = !!pose && ['done', 'in_progress', 'needs_revisit'].includes(pose.status);

    if (wentOut) {
      const checklist = await getTemplateChecklist(c.supabase);
      await c.supabase.from('installations').insert({
        deal_id: dealId,
        contact_id: deal.contact_id,
        title: deal.title ?? null,
        status: 'pending',
        origin: 'retrieval',
        reason: reason.trim() || null,
        checklist,
        created_by: c.userId,
      });
    } else if (pose) {
      // Never delete a pose someone actually drove to: if any trip references
      // it, it is history, however it was left.
      const { count } = await c.supabase
        .from('visits')
        .select('id', { count: 'exact', head: true })
        .eq('installation_id', pose.id);
      if (!count) await c.supabase.from('installations').delete().eq('id', pose.id);
    }
  }

  await closeTrialTask(c, dealId);
  await settleTrialCommissions(c.supabase, dealId, 'expired');
  await recomputeContactRollup(c.supabase, deal.contact_id);
  revalidate(deal.contact_id);
  return { ok: true };
}

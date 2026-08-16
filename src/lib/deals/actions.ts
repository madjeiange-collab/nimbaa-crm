'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ensurePendingInstallation } from '@/lib/installations/seed';
import { recomputeContactRollup } from '@/lib/deals/rollup';

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidate(contactId: string) {
  revalidatePath('/[locale]/contacts', 'page');
  revalidatePath(`/[locale]/contacts/${contactId}`, 'page');
  revalidatePath('/[locale]/dashboard/pipeline', 'page');
  revalidatePath('/[locale]/dashboard', 'page');
  revalidatePath('/[locale]/installs', 'page');
}

/** Create a new business (affaire) for a customer, at the first pipeline stage. */
export async function createDeal(
  contactId: string,
  fields: { title?: string | null; value?: number | null; needsInstallation?: boolean },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const [{ data: firstStage }, { data: contact }] = await Promise.all([
    supabase
      .from('pipeline_stages')
      .select('id')
      .eq('is_active', true)
      .eq('is_won', false)
      .eq('is_lost', false)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from('contacts').select('assigned_rep_id').eq('id', contactId).maybeSingle(),
  ]);

  const { error } = await supabase.from('deals').insert({
    contact_id: contactId,
    title: fields.title?.trim() || null,
    value_xof: fields.value ?? null,
    pipeline_stage_id: firstStage?.id ?? null,
    status: 'open',
    needs_installation: fields.needsInstallation ?? false,
    assigned_rep_id: contact?.assigned_rep_id ?? user.id,
    created_by: user.id,
  });
  if (error) return { ok: false, error: 'save_failed' };

  await recomputeContactRollup(supabase, contactId);
  revalidate(contactId);
  return { ok: true };
}

/**
 * Move a deal to a pipeline stage. Derives status from the stage (won/lost/open),
 * stamps won_at, and — when won & the deal needs installation — seeds the
 * installation job. Keeps the customer's rollup in sync.
 */
export async function setDealStage(dealId: string, stageId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: stage }, { data: deal }] = await Promise.all([
    supabase.from('pipeline_stages').select('is_won, is_lost').eq('id', stageId).maybeSingle(),
    supabase.from('deals').select('contact_id, needs_installation, title, won_at').eq('id', dealId).maybeSingle(),
  ]);
  if (!deal) return { ok: false, error: 'not_found' };

  const status = stage?.is_won ? 'won' : stage?.is_lost ? 'lost' : 'open';
  const patch: Record<string, unknown> = {
    pipeline_stage_id: stageId,
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === 'won' && !deal.won_at) patch.won_at = new Date().toISOString();

  const { error } = await supabase.from('deals').update(patch).eq('id', dealId);
  if (error) return { ok: false, error: 'save_failed' };

  if (status === 'won' && deal.needs_installation) {
    await ensurePendingInstallation(supabase, {
      dealId,
      contactId: deal.contact_id,
      title: deal.title,
      createdBy: user?.id ?? null,
    });
  }

  await recomputeContactRollup(supabase, deal.contact_id);
  revalidate(deal.contact_id);
  return { ok: true };
}

/** Mark a deal lost with a reason. */
export async function markDealLost(dealId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: deal } = await supabase.from('deals').select('contact_id').eq('id', dealId).maybeSingle();
  if (!deal) return { ok: false, error: 'not_found' };

  const { data: lostStage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('is_lost', true)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from('deals')
    .update({
      status: 'lost',
      lost_reason: reason.trim() || null,
      pipeline_stage_id: lostStage?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dealId);
  if (error) return { ok: false, error: 'save_failed' };

  await recomputeContactRollup(supabase, deal.contact_id);
  revalidate(deal.contact_id);
  return { ok: true };
}

/** Edit a deal's product/value/needs-installation. */
export async function updateDeal(
  dealId: string,
  fields: { title?: string | null; value?: number | null; needsInstallation?: boolean },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: deal } = await supabase
    .from('deals')
    .select('contact_id, status, title, needs_installation')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return { ok: false, error: 'not_found' };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.title !== undefined) patch.title = fields.title?.trim() || null;
  if (fields.value !== undefined) patch.value_xof = fields.value;
  if (fields.needsInstallation !== undefined) patch.needs_installation = fields.needsInstallation;

  const { error } = await supabase.from('deals').update(patch).eq('id', dealId);
  if (error) return { ok: false, error: 'save_failed' };

  // If a won deal is (now) flagged for installation, make sure it has a job.
  const needsInstall = fields.needsInstallation ?? deal.needs_installation;
  if (deal.status === 'won' && needsInstall) {
    await ensurePendingInstallation(supabase, {
      dealId,
      contactId: deal.contact_id,
      title: (fields.title ?? deal.title) as string | null,
      createdBy: user?.id ?? null,
    });
  }

  await recomputeContactRollup(supabase, deal.contact_id);
  revalidate(deal.contact_id);
  return { ok: true };
}

/** Delete a deal (and its installations via cascade). */
export async function deleteDeal(dealId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: deal } = await supabase.from('deals').select('contact_id').eq('id', dealId).maybeSingle();
  if (!deal) return { ok: false, error: 'not_found' };

  const { error } = await supabase.from('deals').delete().eq('id', dealId);
  if (error) return { ok: false, error: 'save_failed' };

  await recomputeContactRollup(supabase, deal.contact_id);
  revalidate(deal.contact_id);
  return { ok: true };
}

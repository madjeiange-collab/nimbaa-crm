'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { ensurePendingInstallation } from '@/lib/installations/seed';
import { ensureCommissionForWonDeal } from '@/lib/commissions/core';
import { recomputeContactRollup } from '@/lib/deals/rollup';
import { startTrial, convertTrial, declineTrial } from '@/lib/deals/trial-actions';
import { logDealEvent, logDealDiff, fcfa, type DealEventKind } from '@/lib/deals/events';

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
  fields: {
    title?: string | null;
    value?: number | null;
    needsInstallation?: boolean;
    contactPersonId?: string | null;
    businessType?: string | null;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const [{ data: firstStage }, { data: contact }, { count: dealCount }] = await Promise.all([
    supabase
      .from('pipeline_stages')
      .select('id')
      .eq('is_active', true)
      .eq('is_won', false)
      .eq('is_lost', false)
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('contacts')
      .select('assigned_rep_id, business_type, tags')
      .eq('id', contactId)
      .maybeSingle(),
    supabase
      .from('deals')
      .select('*', { count: 'exact', head: true })
      .eq('contact_id', contactId),
  ]);

  const inherited = contact as {
    assigned_rep_id?: string | null;
    business_type?: string | null;
    tags?: string[];
  } | null;

  // An affaire is a project with this customer, and an untitled one is
  // impossible to talk about. "Projet 1", "Projet 2"... in order of creation,
  // renameable on the card afterwards.
  const title = fields.title?.trim() || `Projet ${(dealCount ?? 0) + 1}`;

  const { data: made, error } = await supabase
    .from('deals')
    .insert({
    contact_id: contactId,
    title,
    value_xof: fields.value ?? null,
    pipeline_stage_id: firstStage?.id ?? null,
    status: 'open',
    needs_installation: fields.needsInstallation ?? false,
    contact_person_id: fields.contactPersonId ?? null,
    // The business decides these, not the affaire (0030).
    business_type: inherited?.business_type ?? fields.businessType?.trim() ?? null,
    tags: inherited?.tags ?? [],
    assigned_rep_id: inherited?.assigned_rep_id ?? user.id,
    created_by: user.id,
    })
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: 'save_failed' };

  if (made?.id) {
    await logDealEvent(supabase, {
      dealId: made.id,
      contactId,
      dealTitle: title,
      kind: 'created',
      actorId: user.id,
    });
  }

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
    supabase.from('pipeline_stages').select('is_won, is_lost, system_key').eq('id', stageId).maybeSingle(),
    supabase
      .from('deals')
      .select('contact_id, needs_installation, title, won_at, pipeline_stages(name)')
      .eq('id', dealId)
      .maybeSingle(),
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

  // Written before the branches below: whatever else a move sets off, the move
  // itself is the thing the journal exists to remember.
  const wasStage =
    (deal as unknown as { pipeline_stages?: { name: string | null } | null }).pipeline_stages?.name ??
    null;
  const { data: newStage } = await supabase
    .from('pipeline_stages')
    .select('name')
    .eq('id', stageId)
    .maybeSingle();
  if (wasStage !== (newStage?.name ?? null)) {
    await logDealEvent(supabase, {
      dealId,
      contactId: deal.contact_id,
      dealTitle: deal.title,
      kind: 'stage',
      from: wasStage,
      to: newStage?.name ?? null,
      actorId: user?.id ?? null,
    });
  }

  // Picking "Essai" from the dropdown must do exactly what the button does:
  // put the equipment out, leave the contact a prospect, sell nothing.
  if (stage?.system_key === 'trial') {
    const res = await startTrial(dealId);
    if (!res.ok) return res;
    revalidate(deal.contact_id);
    return { ok: true };
  }

  if (status === 'won' && deal.needs_installation) {
    await ensurePendingInstallation(supabase, {
      dealId,
      contactId: deal.contact_id,
      title: deal.title,
      createdBy: user?.id ?? null,
    });
  }
  if (status === 'won') await ensureCommissionForWonDeal(supabase, dealId);

  // Leaving a running trial by the dropdown settles it the same way the two
  // buttons do — including the dépose, so equipment never stays out silently.
  const { data: running } = await supabase
    .from('deal_trials')
    .select('id')
    .eq('deal_id', dealId)
    .is('outcome', null)
    .limit(1)
    .maybeSingle();
  if (running) {
    if (status === 'won') await convertTrial(dealId);
    else if (status === 'lost') await declineTrial(dealId, '');
    else {
      // Back to Négociation and such: the period is over without a verdict.
      await supabase
        .from('deal_trials')
        .update({ outcome: 'superseded', ended_on: new Date().toISOString().slice(0, 10) })
        .eq('id', running.id);
    }
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
  fields: {
    title?: string | null;
    value?: number | null;
    productId?: string | null;
    needsInstallation?: boolean;
    businessType?: string | null;
    tags?: string[];
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: deal } = await supabase
    .from('deals')
    .select('contact_id, status, title, needs_installation, value_xof, product_id, products(name)')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return { ok: false, error: 'not_found' };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.title !== undefined) patch.title = fields.title?.trim() || null;
  if (fields.value !== undefined) patch.value_xof = fields.value;
  if (fields.needsInstallation !== undefined) patch.needs_installation = fields.needsInstallation;
  if (fields.businessType !== undefined) patch.business_type = fields.businessType?.trim() || null;
  if (fields.tags !== undefined) {
    patch.tags = fields.tags.map((t) => t.trim()).filter(Boolean).slice(0, 12);
  }
  // Choosing a product snapshots its price as the deal value.
  if (fields.productId !== undefined) {
    if (fields.productId) {
      const { data: product } = await supabase
        .from('products')
        .select('price_xof')
        .eq('id', fields.productId)
        .maybeSingle();
      patch.product_id = fields.productId;
      patch.value_xof = product?.price_xof ?? 0;
    } else {
      patch.product_id = null;
    }
  }

  const { error } = await supabase.from('deals').update(patch).eq('id', dealId);
  if (error) return { ok: false, error: 'save_failed' };

  // One fact per line. Choosing a product also moves the value, and reading
  // "produit → Power Up" beside "valeur 6 500 → 15 000 F" is what explains a
  // commission that changed.
  const was = deal as unknown as {
    value_xof: number | null;
    product_id: string | null;
    products: { name: string | null } | null;
  };
  const diff: { kind: DealEventKind; from?: string | null; to?: string | null }[] = [];
  if (fields.productId !== undefined && fields.productId !== was.product_id) {
    const { data: now } = fields.productId
      ? await supabase.from('products').select('name').eq('id', fields.productId).maybeSingle()
      : { data: null };
    diff.push({ kind: 'product', from: was.products?.name ?? null, to: now?.name ?? null });
    if (patch.value_xof !== was.value_xof) {
      diff.push({ kind: 'value', from: fcfa(was.value_xof), to: fcfa(patch.value_xof as number) });
    }
  } else if (fields.value !== undefined && fields.value !== was.value_xof) {
    diff.push({ kind: 'value', from: fcfa(was.value_xof), to: fcfa(fields.value) });
  }
  if (fields.needsInstallation !== undefined && fields.needsInstallation !== deal.needs_installation) {
    diff.push({ kind: 'install_flag', to: fields.needsInstallation ? 'oui' : 'non' });
  }
  if (fields.title !== undefined && (fields.title?.trim() || null) !== deal.title) {
    diff.push({ kind: 'renamed', from: deal.title, to: fields.title?.trim() || null });
  }
  if (diff.length > 0) {
    await logDealDiff(
      supabase,
      {
        dealId,
        contactId: deal.contact_id,
        dealTitle: (fields.title ?? deal.title) as string | null,
        actorId: user?.id ?? null,
      },
      diff,
    );
  }

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

/**
 * Delete a deal (and its installations via cascade).
 *
 * Guarded in the same terms as the RLS policy (0029) so a refusal comes back
 * as a message rather than as a delete that silently removes nothing: an open
 * affaire with no subscription is anyone's to clear up, anything else is a
 * manager's call.
 */
export async function deleteDeal(dealId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: deal } = await supabase
    .from('deals')
    .select('contact_id, status, title')
    .eq('id', dealId)
    .maybeSingle();
  if (!deal) return { ok: false, error: 'not_found' };

  const { data: me } = await supabase.auth.getUser();
  const { data: role } = await supabase
    .from('users')
    .select('role')
    .eq('id', me.user?.id ?? '')
    .maybeSingle();
  const isManager = role?.role === 'manager' || role?.role === 'admin';
  if (!isManager) {
    const { count: subs } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('deal_id', dealId);
    if (deal.status !== 'open' || (subs ?? 0) > 0) {
      return { ok: false, error: 'forbidden' };
    }
  }

  // Written BEFORE the row goes: afterwards there is nothing left to read the
  // title from. The line survives the deletion because deal_id is
  // ON DELETE SET NULL — the one case you would most want to be able to read.
  await logDealEvent(supabase, {
    dealId,
    contactId: deal.contact_id,
    dealTitle: deal.title,
    kind: 'deleted',
    from: deal.status,
    actorId: user?.id ?? null,
  });

  const { error } = await supabase.from('deals').delete().eq('id', dealId);
  if (error) return { ok: false, error: 'save_failed' };

  await recomputeContactRollup(supabase, deal.contact_id);
  revalidate(deal.contact_id);
  return { ok: true };
}

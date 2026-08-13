'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { ActivityType, PriorityLevel } from '@/types/database';

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateContact(id: string) {
  revalidatePath('/[locale]/contacts', 'page');
  revalidatePath(`/[locale]/contacts/${id}`, 'page');
}

/** Log a follow-up activity (call / whatsapp / note) on a contact. */
export async function logActivity(
  contactId: string,
  type: ActivityType,
  content: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase.from('activities').insert({
    contact_id: contactId,
    rep_id: user.id,
    type,
    content: content.trim() || null,
  });
  if (error) return { ok: false, error: 'save_failed' };

  // Touch the contact so "last activity" ordering stays fresh.
  await supabase.from('contacts').update({ updated_at: new Date().toISOString() }).eq('id', contactId);
  revalidateContact(contactId);
  return { ok: true };
}

/**
 * Move a contact to a pipeline stage. Keeps lifecycle consistent: a "won"
 * stage marks it a customer (stamps converted_at), a "lost" stage marks it lost.
 */
export async function setStage(contactId: string, stageId: string): Promise<ActionResult> {
  const supabase = await createClient();

  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('is_won, is_lost')
    .eq('id', stageId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    pipeline_stage_id: stageId,
    updated_at: new Date().toISOString(),
  };
  if (stage?.is_won) {
    patch.lifecycle = 'customer';
    patch.converted_at = new Date().toISOString();
  } else if (stage?.is_lost) {
    patch.lifecycle = 'lost';
  } else {
    patch.lifecycle = 'lead';
  }

  const { error } = await supabase.from('contacts').update(patch).eq('id', contactId);
  if (error) return { ok: false, error: 'save_failed' };
  revalidateContact(contactId);
  return { ok: true };
}

/** Mark a contact as lost with a reason. */
export async function markLost(contactId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: lostStage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('is_lost', true)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from('contacts')
    .update({
      lifecycle: 'lost',
      lost_reason: reason.trim() || null,
      pipeline_stage_id: lostStage?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId);
  if (error) return { ok: false, error: 'save_failed' };
  revalidateContact(contactId);
  return { ok: true };
}

/** Convert a lead to a customer (moves to the won stage). */
export async function convertToCustomer(contactId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: wonStage } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('is_won', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase
    .from('contacts')
    .update({
      lifecycle: 'customer',
      converted_at: new Date().toISOString(),
      pipeline_stage_id: wonStage?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId);
  if (error) return { ok: false, error: 'save_failed' };
  revalidateContact(contactId);
  return { ok: true };
}

/** Allocate (or reassign) the contact to a commercial (or unassign). */
export async function assignContact(
  contactId: string,
  repId: string | null,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase
    .from('contacts')
    .update({ assigned_rep_id: repId || null, updated_at: new Date().toISOString() })
    .eq('id', contactId);
  if (error) return { ok: false, error: 'save_failed' };
  revalidateContact(contactId);
  return { ok: true };
}

/** Edit basic contact fields (name / phone / priority / value / tags). */
export async function updateContact(
  contactId: string,
  fields: {
    name?: string | null;
    phone?: string | null;
    priority?: PriorityLevel;
    value_xof?: number | null;
    tags?: string[];
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('contacts')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', contactId);
  if (error) return { ok: false, error: 'save_failed' };
  revalidateContact(contactId);
  return { ok: true };
}

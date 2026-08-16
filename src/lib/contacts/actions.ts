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

/** Edit basic contact fields (name / phone / priority / tags). Deal value lives on deals. */
export async function updateContact(
  contactId: string,
  fields: {
    name?: string | null;
    phone?: string | null;
    priority?: PriorityLevel;
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

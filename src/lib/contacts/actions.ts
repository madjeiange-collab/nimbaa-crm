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
    address?: string | null;
    /** Only sent when the picker produced a pin — see the caller. */
    lat?: number | null;
    lng?: number | null;
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

/**
 * Create a prospect by hand.
 *
 * Until now a contact could only appear two ways: a visit with an engaged
 * outcome, or an admin CSV import. Neither covers the ordinary case of meeting
 * someone, being given a name over the phone, or taking a referral — so those
 * were recorded by inventing a visit, or not at all.
 *
 * The rep who creates it owns it, and the territory follows theirs, matching
 * what a knock-created contact gets.
 */
export async function createContact(input: {
  name: string;
  phone?: string | null;
  address?: string | null;
  priority?: PriorityLevel;
  /** From the address picker: GPS, a search hit, or a dropped pin. */
  lat?: number | null;
  lng?: number | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'name_required' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'unauthenticated' };

  const { data: ut } = await supabase
    .from('user_territories')
    .select('territory_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      name,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      lifecycle: 'lead',
      source: 'manual',
      priority: input.priority ?? 'medium',
      assigned_rep_id: user.id,
      territory_id: ut?.territory_id ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'save_failed' };

  revalidatePath('/[locale]/contacts', 'page');
  return { ok: true, id: data.id };
}

'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

function revalidateContact(contactId: string) {
  revalidatePath(`/[locale]/contacts/${contactId}`, 'page');
}

export type PeopleActionResult = { ok: true } | { ok: false; error: string };
export type AddPersonResult = { ok: true; personId: string } | { ok: false; error: string };

/**
 * Adds an interlocutor (gérant, chef de projet…) to a business. Returns the
 * new person's id so callers can immediately link them to a deal.
 */
export async function addContactPerson(
  contactId: string,
  input: { name: string; role?: string; phone?: string; email?: string },
): Promise<AddPersonResult> {
  const user = await requireUser();
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'noName' };

  const supabase = await createClient();
  const { data: person, error } = await supabase
    .from('contact_people')
    .insert({
      contact_id: contactId,
      name,
      role: input.role?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !person) return { ok: false, error: 'saveError' };
  revalidateContact(contactId);
  return { ok: true, personId: person.id };
}

/** Removes an interlocutor (deals pointing at them fall back to NULL). */
export async function deleteContactPerson(
  personId: string,
  contactId: string,
): Promise<PeopleActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from('contact_people').delete().eq('id', personId);
  if (error) return { ok: false, error: 'saveError' };
  revalidateContact(contactId);
  return { ok: true };
}

/** Links a deal to the person it is negotiated with (or clears it). */
export async function assignDealPerson(
  dealId: string,
  contactId: string,
  personId: string | null,
): Promise<PeopleActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('deals')
    .update({ contact_person_id: personId })
    .eq('id', dealId);
  if (error) return { ok: false, error: 'saveError' };
  revalidateContact(contactId);
  return { ok: true };
}

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
 * A person known to the team, and where else they turn up.
 *
 * Multi-site owners are common, so a person is a record of their own (0031)
 * and `contact_people_links` says which commerces they are behind. The role is
 * held per business: Gérant at one address, Propriétaire at another.
 */
export interface KnownPerson {
  id: string;
  name: string;
  phone: string | null;
  /** Businesses they are already linked to, excluding the one being viewed. */
  otherBusinesses: { id: string; name: string | null }[];
}

/**
 * Add an interlocutor to a business. Returns the person's id so callers can
 * link them to a deal right away.
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
      name,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !person) return { ok: false, error: 'saveError' };

  const { error: linkErr } = await supabase.from('contact_people_links').insert({
    person_id: person.id,
    contact_id: contactId,
    role: input.role?.trim() || null,
    created_by: user.id,
  });
  if (linkErr) return { ok: false, error: 'saveError' };

  revalidateContact(contactId);
  return { ok: true, personId: person.id };
}

/**
 * Attach someone the team already knows to another of their commerces —
 * the point of the whole thing. Their phone stays in one place.
 */
export async function linkExistingPerson(
  contactId: string,
  personId: string,
  role?: string | null,
): Promise<PeopleActionResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from('contact_people_links').insert({
    person_id: personId,
    contact_id: contactId,
    role: role?.trim() || null,
    created_by: user.id,
  });
  // Already linked is not a failure — the desired state is the actual state.
  if (error && !/duplicate key|unique/i.test(error.message)) {
    return { ok: false, error: 'saveError' };
  }
  revalidateContact(contactId);
  return { ok: true };
}

/**
 * Detach a person from THIS business. The person survives, because they may
 * still run the shop next door; only when the last link goes does the record
 * itself go, so we do not accumulate people belonging to nobody.
 */
export async function unlinkContactPerson(
  personId: string,
  contactId: string,
): Promise<PeopleActionResult> {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from('contact_people_links')
    .delete()
    .eq('person_id', personId)
    .eq('contact_id', contactId);
  if (error) return { ok: false, error: 'saveError' };

  const { count } = await supabase
    .from('contact_people_links')
    .select('*', { count: 'exact', head: true })
    .eq('person_id', personId);
  if ((count ?? 0) === 0) {
    // Deals pointing at them fall back to NULL (on delete set null).
    await supabase.from('contact_people').delete().eq('id', personId);
  }

  revalidateContact(contactId);
  return { ok: true };
}

/** The role someone holds at this particular business. */
export async function setPersonRole(
  personId: string,
  contactId: string,
  role: string | null,
): Promise<PeopleActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from('contact_people_links')
    .update({ role: role?.trim() || null })
    .eq('person_id', personId)
    .eq('contact_id', contactId);
  if (error) return { ok: false, error: 'saveError' };
  revalidateContact(contactId);
  return { ok: true };
}

/**
 * Find someone the team already knows, by name or phone, so a multi-site owner
 * is linked rather than typed in again. Excludes people already on this fiche.
 */
export async function searchKnownPeople(
  contactId: string,
  query: string,
): Promise<KnownPerson[]> {
  await requireUser();
  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('contact_people')
    .select('id, name, phone, contact_people_links(contact_id, contacts(id, name))')
    .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
    .limit(20);

  type Row = {
    id: string;
    name: string;
    phone: string | null;
    contact_people_links?: { contact_id: string; contacts: { id: string; name: string | null } | null }[];
  };

  return ((rows ?? []) as unknown as Row[])
    .filter((p) => !(p.contact_people_links ?? []).some((l) => l.contact_id === contactId))
    .map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone,
      otherBusinesses: (p.contact_people_links ?? [])
        .map((l) => l.contacts)
        .filter((c): c is { id: string; name: string | null } => !!c),
    }))
    .slice(0, 8);
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

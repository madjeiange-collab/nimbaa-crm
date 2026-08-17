'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/session';

export type DnkResult = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath('/[locale]/admin/do-not-knock', 'page');
}

/** Add a do-not-knock point (20 m blocking radius, enforced in saveVisit). */
export async function addDnkEntry(input: {
  lat: number;
  lng: number;
  address?: string | null;
  reason?: string | null;
}): Promise<DnkResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.role !== 'admin') return { ok: false, error: 'forbidden' };
  if (
    !Number.isFinite(input.lat) || Math.abs(input.lat) > 90 ||
    !Number.isFinite(input.lng) || Math.abs(input.lng) > 180
  ) {
    return { ok: false, error: 'invalidPoint' };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('do_not_knock_list').insert({
    lat: input.lat,
    lng: input.lng,
    address: input.address?.trim() || null,
    reason: input.reason?.trim() || null,
    added_by: me.id,
  });
  if (error) return { ok: false, error: 'saveFailed' };
  revalidate();
  return { ok: true };
}

/**
 * Rep-proposed do-not-knock point (hostile door met in the field). Created
 * UNAPPROVED — it does not block anything until an admin approves it.
 */
export async function proposeDnkEntry(input: {
  lat: number;
  lng: number;
  address?: string | null;
}): Promise<DnkResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return { ok: false, error: 'invalidPoint' };
  }
  const supabase = await createClient();
  const { error } = await supabase.from('do_not_knock_list').insert({
    lat: input.lat,
    lng: input.lng,
    address: input.address?.trim() || null,
    reason: `Proposé par ${me.full_name ?? me.username ?? 'un commercial'}`,
    added_by: me.id,
    proposed_by: me.id,
    approved: false,
  });
  if (error) return { ok: false, error: 'saveFailed' };
  revalidate();
  return { ok: true };
}

/** Approve a rep-proposed point — it starts blocking visits. */
export async function approveDnkEntry(id: string): Promise<DnkResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.role !== 'admin') return { ok: false, error: 'forbidden' };
  const supabase = await createClient();
  const { error } = await supabase
    .from('do_not_knock_list')
    .update({ approved: true })
    .eq('id', id);
  if (error) return { ok: false, error: 'saveFailed' };
  revalidate();
  return { ok: true };
}

/** Remove a do-not-knock point. */
export async function deleteDnkEntry(id: string): Promise<DnkResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.role !== 'admin') return { ok: false, error: 'forbidden' };

  const supabase = await createClient();
  const { error } = await supabase.from('do_not_knock_list').delete().eq('id', id);
  if (error) return { ok: false, error: 'deleteFailed' };
  revalidate();
  return { ok: true };
}

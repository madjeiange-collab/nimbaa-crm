'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/session';

export type CommissionResult = { ok: true } | { ok: false; error: string };

/** Pay a single EARNED entry (line-level payroll). Manager/admin only. */
export async function payCommissionEntry(entryId: string): Promise<CommissionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.role !== 'manager' && me.role !== 'admin') return { ok: false, error: 'forbidden' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('commission_entries')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('status', 'earned');
  if (error) return { ok: false, error: 'saveFailed' };
  revalidatePath('/[locale]/dashboard/commissions', 'page');
  return { ok: true };
}

/**
 * Payroll cut: flips every EARNED entry to PAID (they leave "à payer" and
 * enter the history). Manager/admin only.
 */
export async function payEarnedCommissions(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.role !== 'manager' && me.role !== 'admin') return { ok: false, error: 'forbidden' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('commission_entries')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('status', 'earned')
    .select('id');
  if (error) return { ok: false, error: 'saveFailed' };
  revalidatePath('/[locale]/dashboard/commissions', 'page');
  return { ok: true, count: (data ?? []).length };
}

/**
 * Marks a subscription cancelled (the one manual signal of the model) and
 * expires its remaining pending slices. Manager/admin only.
 */
export async function cancelSubscription(
  subscriptionId: string,
  contactId: string,
): Promise<CommissionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.role !== 'manager' && me.role !== 'admin') return { ok: false, error: 'forbidden' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', subscriptionId);
  if (error) return { ok: false, error: 'saveFailed' };
  await supabase
    .from('commission_entries')
    .update({ status: 'expired' })
    .eq('subscription_id', subscriptionId)
    .eq('status', 'pending');
  revalidatePath(`/[locale]/contacts/${contactId}`, 'page');
  return { ok: true };
}

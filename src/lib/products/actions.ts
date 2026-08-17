'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/session';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const me = await getCurrentUser();
  return me?.role === 'admin';
}
function revalidate() {
  revalidatePath('/[locale]/admin/products', 'page');
  revalidatePath('/[locale]/contacts', 'page');
}

export async function addProduct(
  name: string,
  priceXof: number,
  commissionPct: number,
  extra?: { billingInterval?: string; commissionMode?: string; commissionMonths?: number },
): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'forbidden' };
  if (!name.trim()) return { ok: false, error: 'empty' };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from('products')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { error } = await supabase.from('products').insert({
    name: name.trim(),
    price_xof: Math.max(0, Math.round(priceXof) || 0),
    commission_pct: Math.max(0, commissionPct || 0),
    billing_interval: extra?.billingInterval ?? 'one_time',
    commission_mode: extra?.commissionMode ?? 'once',
    commission_months: Math.max(1, Math.round(extra?.commissionMonths ?? 3)),
    sort_order: (last?.sort_order ?? 0) + 1,
  });
  if (error) return { ok: false, error: 'save_failed' };
  revalidate();
  return { ok: true };
}

export async function updateProduct(
  id: string,
  fields: {
    name?: string;
    priceXof?: number;
    commissionPct?: number;
    isActive?: boolean;
    billingInterval?: string;
    commissionMode?: string;
    commissionMonths?: number;
  },
): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'forbidden' };
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) {
    if (!fields.name.trim()) return { ok: false, error: 'empty' };
    patch.name = fields.name.trim();
  }
  if (fields.priceXof !== undefined) patch.price_xof = Math.max(0, Math.round(fields.priceXof) || 0);
  if (fields.commissionPct !== undefined) patch.commission_pct = Math.max(0, fields.commissionPct || 0);
  if (fields.isActive !== undefined) patch.is_active = fields.isActive;
  if (fields.billingInterval !== undefined) patch.billing_interval = fields.billingInterval;
  if (fields.commissionMode !== undefined) patch.commission_mode = fields.commissionMode;
  if (fields.commissionMonths !== undefined) {
    patch.commission_months = Math.max(1, Math.round(fields.commissionMonths) || 3);
  }

  const supabase = await createClient();
  const { error } = await supabase.from('products').update(patch).eq('id', id);
  if (error) return { ok: false, error: 'save_failed' };
  revalidate();
  return { ok: true };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: 'forbidden' };
  const supabase = await createClient();
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) return { ok: false, error: 'save_failed' };
  revalidate();
  return { ok: true };
}

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Commission engine (deal-based, no payment import).
 *  - Winning a deal on a product with commission_pct > 0 creates the ledger:
 *    'once' products → one immediately-earned entry;
 *    'recurring' products → a subscription + N monthly slices (window and %
 *    SNAPSHOTTED at sale — later product edits only affect new sales).
 *  - Slice k belongs to start_date + (k-1) months; slice 1 earns at sale.
 *  - The daily sweep earns due slices while the subscription is active;
 *    cancellation expires the remaining pending slices. No clawback ever.
 */

function addMonths(dateIso: string, months: number): string {
  const d = new Date(dateIso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Idempotent — safe to call on every won transition of the same deal. */
export async function ensureCommissionForWonDeal(
  db: SupabaseClient,
  dealId: string,
): Promise<void> {
  try {
    const { data: deal } = await db
      .from('deals')
      .select('id, contact_id, assigned_rep_id, value_xof, status, products(id, price_xof, commission_pct, commission_mode, commission_months)')
      .eq('id', dealId)
      .maybeSingle();
    const product = (deal as { products?: {
      id: string;
      price_xof: number | null;
      commission_pct: number | null;
      commission_mode: string;
      commission_months: number;
    } | null } | null)?.products;
    if (!deal || deal.status !== 'won' || !product) return;
    const pct = Number(product.commission_pct ?? 0);
    const price = Number(deal.value_xof ?? product.price_xof ?? 0);
    if (pct <= 0 || price <= 0 || !deal.assigned_rep_id) return;
    const slice = Math.round((price * pct) / 100);
    const today = new Date().toISOString().slice(0, 10);

    if (product.commission_mode === 'recurring') {
      // One subscription per deal (unique index) — bail if it exists.
      const { data: existing } = await db
        .from('subscriptions')
        .select('id')
        .eq('deal_id', dealId)
        .maybeSingle();
      if (existing) return;
      const months = Math.max(1, product.commission_months ?? 3);
      const { data: sub, error } = await db
        .from('subscriptions')
        .insert({
          deal_id: dealId,
          contact_id: deal.contact_id,
          product_id: product.id,
          rep_id: deal.assigned_rep_id,
          monthly_price_xof: price,
          commission_pct: pct,
          commission_months: months,
          start_date: today,
        })
        .select('id')
        .single();
      if (error || !sub) return;
      await db.from('commission_entries').insert(
        Array.from({ length: months }, (_, i) => ({
          subscription_id: sub.id,
          deal_id: dealId,
          rep_id: deal.assigned_rep_id,
          period_index: i + 1,
          period_month: addMonths(today, i),
          amount_xof: slice,
          // Month 1 is the signup month — earned at the sale itself.
          status: i === 0 ? 'earned' : 'pending',
          earned_at: i === 0 ? new Date().toISOString() : null,
        })),
      );
    } else {
      const { data: existing } = await db
        .from('commission_entries')
        .select('id')
        .eq('deal_id', dealId)
        .limit(1)
        .maybeSingle();
      if (existing) return;
      await db.from('commission_entries').insert({
        deal_id: dealId,
        rep_id: deal.assigned_rep_id,
        period_index: 1,
        period_month: today,
        amount_xof: slice,
        status: 'earned',
        earned_at: new Date().toISOString(),
      });
    }
  } catch {
    // Commission bookkeeping must never break the sale itself
    // (also covers a pre-0021 database).
  }
}

/**
 * Technician commission: earned once when the technician completes an
 * installation belonging to a won deal whose product carries a technician
 * rate. Idempotent per installation; never breaks the completion itself.
 */
export async function ensureTechCommissionForInstall(
  db: SupabaseClient,
  installationId: string,
  installerId: string,
): Promise<void> {
  try {
    const { data: inst } = await db
      .from('installations')
      .select('id, status, deal_id, deals(id, value_xof, status, products(price_xof, tech_commission_pct))')
      .eq('id', installationId)
      .maybeSingle();
    const deal = (inst as { deals?: {
      id: string;
      value_xof: number | null;
      status: string;
      products: { price_xof: number | null; tech_commission_pct: number | null } | null;
    } | null } | null)?.deals;
    if (!inst || inst.status !== 'done' || !deal || deal.status !== 'won') return;
    const pct = Number(deal.products?.tech_commission_pct ?? 0);
    const price = Number(deal.value_xof ?? deal.products?.price_xof ?? 0);
    if (pct <= 0 || price <= 0 || !installerId) return;

    const { data: existing } = await db
      .from('commission_entries')
      .select('id')
      .eq('installation_id', installationId)
      .eq('kind', 'install')
      .limit(1)
      .maybeSingle();
    if (existing) return;

    await db.from('commission_entries').insert({
      deal_id: deal.id,
      installation_id: installationId,
      rep_id: installerId,
      kind: 'install',
      period_index: 1,
      period_month: new Date().toISOString().slice(0, 10),
      amount_xof: Math.round((price * pct) / 100),
      status: 'earned',
      earned_at: new Date().toISOString(),
    });
  } catch {
    // pre-0022 DB or lookup failure — never break the installation save
  }
}

/**
 * Daily accrual: earn pending slices whose anniversary has arrived while the
 * subscription is still active. Runs with the service-role client from the
 * 6h recap job.
 */
export async function runCommissionSweep(admin: SupabaseClient): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: due } = await admin
      .from('commission_entries')
      .select('id, subscription_id, subscriptions!inner(status)')
      .eq('status', 'pending')
      .lte('period_month', today)
      .limit(1000);
    const rows = (due ?? []) as unknown as {
      id: string;
      subscriptions: { status: string } | null;
    }[];
    const earn = rows.filter((r) => r.subscriptions?.status === 'active').map((r) => r.id);
    const expire = rows.filter((r) => r.subscriptions?.status !== 'active').map((r) => r.id);
    if (earn.length > 0) {
      await admin
        .from('commission_entries')
        .update({ status: 'earned', earned_at: new Date().toISOString() })
        .in('id', earn);
    }
    if (expire.length > 0) {
      await admin.from('commission_entries').update({ status: 'expired' }).in('id', expire);
    }
  } catch {
    // pre-0021 DB — sweep is a no-op
  }
}

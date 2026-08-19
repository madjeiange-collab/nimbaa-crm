import type { SupabaseClient } from '@supabase/supabase-js';
import { TECH_BACKSTOP_DAYS } from '@/lib/deals/trial';

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
          base_xof: price,
          rate_pct: pct,
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
        base_xof: price,
        rate_pct: pct,
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
    if (!inst || inst.status !== 'done' || !deal) return;
    // Not "only when won" any more. A trial pose happens with the affaire
    // still open; writing the entry now — pending — is what guarantees the
    // technician is paid at all, and freezes the rate at the day of the work
    // rather than the day the customer makes up their mind.
    if (deal.status === 'lost') return;
    const won = deal.status === 'won';
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
      base_xof: price,
      rate_pct: pct,
      status: won ? 'earned' : 'pending',
      earned_at: won ? new Date().toISOString() : null,
    });
  } catch {
    // pre-0022 DB or lookup failure — never break the installation save
  }
}

/**
 * Ripen or write off the technician lines of one affaire.
 *
 * 'earned' when the trial converts — the sale exists, so the work is payable.
 * 'expired' when it does not, which is the same word a cancelled subscription
 * uses for its remaining slices, so nothing new has to be explained.
 */
export async function settleTrialCommissions(
  db: SupabaseClient,
  dealId: string,
  to: 'earned' | 'expired',
): Promise<void> {
  try {
    await db
      .from('commission_entries')
      .update(
        to === 'earned'
          ? { status: 'earned', earned_at: new Date().toISOString() }
          : { status: 'expired' },
      )
      .eq('deal_id', dealId)
      .eq('kind', 'install')
      .eq('status', 'pending');
  } catch {
    // pre-0022 DB — never break the conversion over the ledger
  }
}

/**
 * The backstop: a technician's line ripens once the equipment has been on site
 * past TECH_BACKSTOP_DAYS, whatever the customer has decided.
 *
 * With 30-day trials, an extension and possibly a second period, waiting for
 * the sale can mean waiting a quarter for work finished on day one — a delay
 * the technician cannot influence. Runs with the daily accrual.
 */
export async function accrueBackstopTechCommissions(db: SupabaseClient): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - TECH_BACKSTOP_DAYS * 864e5).toISOString().slice(0, 10);
    const { data: due } = await db
      .from('deal_trials')
      .select('deal_id, started_on, installation_id')
      .not('installation_id', 'is', null)
      .lte('started_on', cutoff)
      .limit(500);
    const dealIds = [...new Set((due ?? []).map((t) => t.deal_id as string))];
    if (dealIds.length === 0) return 0;

    const { data: ripened } = await db
      .from('commission_entries')
      .update({ status: 'earned', earned_at: new Date().toISOString() })
      .in('deal_id', dealIds)
      .eq('kind', 'install')
      .eq('status', 'pending')
      .select('id');
    return ripened?.length ?? 0;
  } catch {
    // Table missing (pre-0032) — the backstop is a nicety, not a gate.
    return 0;
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

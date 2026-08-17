/**
 * Commission simulation seed — RE-RUNNABLE (purges its own rows, tagged
 * 'demo-commission', then regenerates). Creates on demo customers:
 *  - subscriptions at different ages (fresh / mid-window / completed)
 *  - cancellations with expired slices
 *  - one-shot sales (Plus Day / Plus Week)
 *  - technician commissions on completed installations (5% on monthly plans)
 *  - payroll history: slices earned before this month are marked paid
 * Run: node supabase/seed/seed-commissions.mjs
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const DAY = 86400_000;
const today = new Date();
const iso = (d) => d.toISOString();
const dateOnly = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => new Date(today.getTime() - n * DAY);
const addMonths = (d, m) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + m);
  return x;
};
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

// ---------- purge previous run ----------
const { data: oldDeals } = await db.from('deals').select('id').contains('tags', ['demo-commission']);
const oldIds = (oldDeals ?? []).map((d) => d.id);
if (oldIds.length > 0) {
  await db.from('commission_entries').delete().in('deal_id', oldIds);
  await db.from('subscriptions').delete().in('deal_id', oldIds);
  await db.from('installations').delete().in('deal_id', oldIds);
  await db.from('deals').delete().in('id', oldIds);
  console.log(`purged previous run: ${oldIds.length} deals + dependents`);
}

// ---------- lookups ----------
const { data: users } = await db.from('users').select('id, username, role');
const rep = (u) => users.find((x) => x.username === u)?.id;
const reps = { kofi: rep('kofi'), fatou: rep('fatou'), awa: rep('awa'), yao: rep('yao') };
const techs = { moussa: rep('moussa'), aicha: rep('aicha') };
const { data: products } = await db.from('products').select('id, name, price_xof, commission_pct, commission_mode, tech_commission_pct');
const plan = (n) => products.find((p) => p.name.startsWith(n));
const wonStage = (await db.from('pipeline_stages').select('id').eq('is_won', true).limit(1).single()).data.id;

// Give the monthly plans a technician rate so install commissions exist.
for (const p of ['Start Up', 'Power Up', 'Plus Month']) {
  await db.from('products').update({ tech_commission_pct: 5 }).eq('id', plan(p).id);
}
console.log('tech_commission_pct=5 set on monthly plans');

// Customers to attach deals to (existing demo customers, spread around).
const { data: customers } = await db
  .from('contacts')
  .select('id, name')
  .eq('lifecycle', 'customer')
  .contains('tags', ['demo'])
  .limit(30);
if ((customers ?? []).length < 16) throw new Error('not enough demo customers');
let ci = 0;
const nextCustomer = () => customers[ci++ % customers.length];

// ---------- scenario table ----------
// ageDays = subscription start; cancelAfter = months survived (null = active)
const SUBS = [
  { rep: 'kofi', plan: 'Plus Month', ageDays: 75, cancelAfter: null }, // full 3 earned
  { rep: 'kofi', plan: 'Power Up', ageDays: 70, cancelAfter: 1 },      // churned after m1
  { rep: 'kofi', plan: 'Start Up', ageDays: 40, cancelAfter: null },   // 2 earned, 1 pending
  { rep: 'kofi', plan: 'Power Up', ageDays: 5, cancelAfter: null },    // fresh
  { rep: 'fatou', plan: 'Plus Month', ageDays: 65, cancelAfter: 2 },   // churned after m2
  { rep: 'fatou', plan: 'Power Up', ageDays: 35, cancelAfter: null },
  { rep: 'fatou', plan: 'Start Up', ageDays: 8, cancelAfter: null },
  { rep: 'awa', plan: 'Start Up', ageDays: 80, cancelAfter: null },
  { rep: 'awa', plan: 'Power Up', ageDays: 45, cancelAfter: 1 },
  { rep: 'awa', plan: 'Plus Month', ageDays: 12, cancelAfter: null },
  { rep: 'yao', plan: 'Power Up', ageDays: 55, cancelAfter: null },
  { rep: 'yao', plan: 'Start Up', ageDays: 3, cancelAfter: null },
];
const ONESHOTS = [
  { rep: 'kofi', plan: 'Plus Week', ageDays: 20 },
  { rep: 'fatou', plan: 'Plus Day', ageDays: 6 },
  { rep: 'awa', plan: 'Plus Week', ageDays: 2 },
  { rep: 'yao', plan: 'Plus Day', ageDays: 33 },
];
// Which subscription indexes get a completed installation (tech commission).
const INSTALLS = [
  { subIndex: 0, tech: 'moussa', daysAfterStart: 2 },
  { subIndex: 2, tech: 'moussa', daysAfterStart: 3 },
  { subIndex: 4, tech: 'aicha', daysAfterStart: 1 },
  { subIndex: 8, tech: 'aicha', daysAfterStart: 4 },
  { subIndex: 10, tech: 'moussa', daysAfterStart: 2 },
];

async function makeDeal(repId, product, wonAt, contact) {
  const { data: deal, error } = await db
    .from('deals')
    .insert({
      contact_id: contact.id,
      title: product.name,
      product_id: product.id,
      value_xof: product.price_xof,
      pipeline_stage_id: wonStage,
      status: 'won',
      won_at: iso(wonAt),
      assigned_rep_id: repId,
      created_by: repId,
      tags: ['demo-commission'],
      business_type: ['Maquis', 'Restaurant', 'Boutique', 'Glacier', 'Supérette'][ci % 5],
    })
    .select('id')
    .single();
  if (error) throw error;
  return deal.id;
}

// paid_at simulation: anything earned before this month was paid at payroll.
const paidAt = (earnedAt) => (earnedAt < monthStart ? iso(monthStart) : null);

let subRows = [];
for (const s of SUBS) {
  const product = plan(s.plan);
  const start = daysAgo(s.ageDays);
  const contact = nextCustomer();
  const dealId = await makeDeal(reps[s.rep], product, start, contact);
  const cancelledAt = s.cancelAfter != null ? addMonths(start, s.cancelAfter) : null;
  const { data: sub, error } = await db
    .from('subscriptions')
    .insert({
      deal_id: dealId,
      contact_id: contact.id,
      product_id: product.id,
      rep_id: reps[s.rep],
      monthly_price_xof: product.price_xof,
      commission_pct: product.commission_pct,
      commission_months: 3,
      start_date: dateOnly(start),
      status: cancelledAt ? 'cancelled' : 'active',
      cancelled_at: cancelledAt ? iso(cancelledAt) : null,
    })
    .select('id')
    .single();
  if (error) throw error;
  subRows.push({ subId: sub.id, dealId, product, start, cancelledAt, repId: reps[s.rep], contact });

  const slice = Math.round((product.price_xof * product.commission_pct) / 100);
  const entries = [];
  for (let i = 0; i < 3; i++) {
    const pm = addMonths(start, i);
    let status, earnedAt = null;
    if (cancelledAt && pm >= cancelledAt) status = 'expired';
    else if (pm <= today) {
      earnedAt = iso(pm);
      status = paidAt(pm) ? 'paid' : 'earned';
    } else status = 'pending';
    entries.push({
      subscription_id: sub.id,
      deal_id: dealId,
      rep_id: reps[s.rep],
      kind: 'sale',
      period_index: i + 1,
      period_month: dateOnly(pm),
      amount_xof: slice,
      base_xof: product.price_xof,
      rate_pct: product.commission_pct,
      status,
      earned_at: earnedAt,
      paid_at: status === 'paid' ? paidAt(pm) : null,
    });
  }
  const { error: e2 } = await db.from('commission_entries').insert(entries);
  if (e2) throw e2;
}
console.log(`created ${SUBS.length} subscriptions with slices`);

for (const o of ONESHOTS) {
  const product = plan(o.plan);
  const wonAt = daysAgo(o.ageDays);
  const contact = nextCustomer();
  const dealId = await makeDeal(reps[o.rep], product, wonAt, contact);
  const amount = Math.round((product.price_xof * product.commission_pct) / 100);
  await db.from('commission_entries').insert({
    deal_id: dealId,
    rep_id: reps[o.rep],
    kind: 'sale',
    period_index: 1,
    period_month: dateOnly(wonAt),
    amount_xof: amount,
    base_xof: product.price_xof,
    rate_pct: product.commission_pct,
    status: paidAt(wonAt) ? 'paid' : 'earned',
    earned_at: iso(wonAt),
    paid_at: paidAt(wonAt),
  });
}
console.log(`created ${ONESHOTS.length} one-shot sales`);

for (const inst of INSTALLS) {
  const s = subRows[inst.subIndex];
  const completedAt = new Date(s.start.getTime() + inst.daysAfterStart * DAY);
  const { data: job, error } = await db
    .from('installations')
    .insert({
      contact_id: s.contact.id,
      deal_id: s.dealId,
      installer_id: techs[inst.tech],
      title: s.product.name,
      status: 'done',
      scheduled_date: dateOnly(completedAt),
      completed_at: iso(completedAt),
      created_by: s.repId,
    })
    .select('id')
    .single();
  if (error) throw error;
  const amount = Math.round((s.product.price_xof * 5) / 100);
  await db.from('commission_entries').insert({
    deal_id: s.dealId,
    installation_id: job.id,
    rep_id: techs[inst.tech],
    kind: 'install',
    period_index: 1,
    period_month: dateOnly(completedAt),
    amount_xof: amount,
    base_xof: s.product.price_xof,
    rate_pct: 5,
    status: paidAt(completedAt) ? 'paid' : 'earned',
    earned_at: iso(completedAt),
    paid_at: paidAt(completedAt),
  });
}
console.log(`created ${INSTALLS.length} completed installations with tech commissions`);

// ---------- summary ----------
const { data: all } = await db.from('commission_entries').select('kind, status, amount_xof');
const agg = {};
for (const e of all) {
  const k = `${e.kind}/${e.status}`;
  agg[k] = (agg[k] ?? 0) + e.amount_xof;
}
console.log('ledger totals (FCFA):', JSON.stringify(agg, null, 1));

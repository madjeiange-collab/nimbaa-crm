// Throwaway: verify the won-deal commission path, then restore the demo deal.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const contactId = '59817b8f-5a20-4eed-b317-d0874ba5fb81';
const { data: deal } = await admin
  .from('deals')
  .select('id, title, value_xof, status, product_id, assigned_rep_id')
  .eq('contact_id', contactId)
  .eq('status', 'won')
  .single();
console.log('deal:', deal.title, deal.value_xof, 'XOF');

const { data: sub } = await admin
  .from('subscriptions')
  .select('id, monthly_price_xof, commission_pct, commission_months, status, start_date, rep_id')
  .eq('deal_id', deal.id)
  .maybeSingle();
console.log('subscription:', JSON.stringify(sub));

if (sub) {
  const { data: entries } = await admin
    .from('commission_entries')
    .select('period_index, period_month, amount_xof, status')
    .eq('subscription_id', sub.id)
    .order('period_index');
  console.log('slices:', JSON.stringify(entries, null, 1));

  // Cleanup: remove test commission artifacts, restore the demo deal.
  await admin.from('subscriptions').delete().eq('id', sub.id); // entries cascade
  const { data: fibre } = await admin.from('products').select('id').eq('name', 'Abonnement Internet Fibre').single();
  await admin.from('deals').update({ product_id: fibre.id, value_xof: 25000 }).eq('id', deal.id);
  console.log('cleaned up — demo deal restored (Fibre, 25 000 XOF)');
}

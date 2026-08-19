import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const TAG = '__trial-test';

// --------------------------------------------------------------- clean up
const { data: old } = await db.from('contacts').select('id').ilike('name', `${TAG}%`);
for (const c of old ?? []) {
  const { data: ds } = await db.from('deals').select('id').eq('contact_id', c.id);
  for (const d of ds ?? []) {
    await db.from('deal_trials').delete().eq('deal_id', d.id);
    await db.from('commission_entries').delete().eq('deal_id', d.id);
  }
  await db.from('tasks').delete().eq('contact_id', c.id);
  await db.from('installations').delete().eq('contact_id', c.id);
  await db.from('deals').delete().eq('contact_id', c.id);
  await db.from('contacts').delete().eq('id', c.id);
}
if (process.argv.includes('--purge')) {
  console.log(`purged ${old?.length ?? 0} test contact(s)`);
  process.exit(0);
}

// ------------------------------------------------------------------ seed
const { data: prod } = await db
  .from('products')
  .select('id, name, tech_commission_pct, price_xof')
  .gt('tech_commission_pct', 0)
  .limit(1)
  .maybeSingle();
const { data: stage } = await db
  .from('pipeline_stages')
  .select('id')
  .eq('name', 'Négociation')
  .maybeSingle();
const { data: admin } = await db.from('users').select('id').eq('username', 'admin').maybeSingle();

const { data: contact } = await db
  .from('contacts')
  .insert({
    name: `${TAG} Maquis Essai`,
    lifecycle: 'lead',
    phone: '+2250700000099',
    assigned_rep_id: admin.id,
    created_by: admin.id,
  })
  .select('id')
  .maybeSingle();

const made = [];
for (const title of ['A — à convertir', 'B — à refuser']) {
  const { data: deal } = await db
    .from('deals')
    .insert({
      contact_id: contact.id,
      title,
      product_id: prod.id,
      value_xof: prod.price_xof,
      pipeline_stage_id: stage.id,
      status: 'open',
      needs_installation: true,
      assigned_rep_id: admin.id,
      created_by: admin.id,
    })
    .select('id')
    .maybeSingle();
  made.push({ title, id: deal.id });
}

console.log('contact :', contact.id);
console.log('produit :', prod.name, `· tech ${prod.tech_commission_pct}% · ${prod.price_xof} XOF`);
for (const m of made) console.log(`  ${m.title.padEnd(18)} ${m.id}`);
console.log(`\nfiche : https://nimbaa-crm.vercel.app/fr/contacts/${contact.id}`);

/**
 * Five customers whose journals are worth opening.
 *
 * Random data proves nothing here: a change log only shows its value on the
 * cases people actually argue about — a deal that stalled, an address someone
 * corrected badly, a customer that changed hands, an affaire that was deleted.
 * Each fiche below is one of those.
 *
 * Purged by name rather than by a marker column: contacts.source is an enum
 * ('d2d_knock' | 'b2b_field' | 'referral' | 'walk_in' | 'import' | 'manual')
 * with no room for a custom tag, and a visible tag would show up on the fiche
 * itself. The five names below are the key.
 *
 *   node supabase/seed/seed-journals-demo.mjs --purge
 * removes exactly these and nothing else.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const NAMES = [
  'Supérette Adjamé Centre',
  'Maquis Le Baobab',
  'Boutique Cocody Nord',
  'Kiosque Riviera 3',
  'Pharmacie Les Palmiers',
];
const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

// ---------------------------------------------------------------- purge -----
const { data: mine } = await db.from('contacts').select('id').in('name', NAMES);
for (const c of mine ?? []) {
  const dealIds = ((await db.from('deals').select('id').eq('contact_id', c.id)).data ?? []).map((d) => d.id);
  for (const id of dealIds) {
    await db.from('deal_trials').delete().eq('deal_id', id);
    await db.from('deal_events').delete().eq('deal_id', id);
  }
  await db.from('deal_events').delete().eq('contact_id', c.id);
  await db.from('contact_events').delete().eq('contact_id', c.id);
  await db.from('tasks').delete().eq('contact_id', c.id);
  await db.from('installations').delete().eq('contact_id', c.id);
  await db.from('deals').delete().eq('contact_id', c.id);
  await db.from('contacts').delete().eq('id', c.id);
}
console.log(`purge : ${mine?.length ?? 0} fiche(s) retirée(s)`);
if (process.argv.includes('--purge')) process.exit(0);

// ----------------------------------------------------------------- setup ----
const { data: users } = await db.from('users').select('id, full_name, username, role');
const admin = users.find((u) => u.username === 'admin');
const reps = users.filter((u) => u.role === 'rep');
const [rep1, rep2] = [reps[0] ?? admin, reps[1] ?? reps[0] ?? admin];
const nm = (u) => u.full_name ?? u.username;

const { data: products } = await db.from('products').select('id, name, price_xof').eq('is_active', true);
const small = products.find((p) => /Start Up/.test(p.name)) ?? products[0];
const big = products.find((p) => /Power Up/.test(p.name)) ?? products[1] ?? small;

const { data: stages } = await db.from('pipeline_stages').select('id, name, system_key').order('sort_order');
const stageId = (name) => stages.find((s) => s.name === name)?.id ?? null;

const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
const day = (days) => ago(days).slice(0, 10);

async function fiche({ name, phone, address, lat, lng, type, tags, rep, lifecycle = 'lead' }) {
  const { data } = await db
    .from('contacts')
    .insert({
      name, phone, address, lat, lng, business_type: type, tags: tags ?? [],
      lifecycle, source: 'manual', priority: 'medium',
      assigned_rep_id: rep.id, created_by: admin.id,
    })
    .select('id')
    .maybeSingle();
  return data.id;
}
const cEv = (contactId, contactName, kind, from, to, days, actor) => ({
  contact_id: contactId, contact_name: contactName, kind,
  from_label: from, to_label: to, actor_id: actor.id, at: ago(days),
});
const dEv = (dealId, contactId, title, kind, from, to, days, actor) => ({
  deal_id: dealId, contact_id: contactId, deal_title: title, kind,
  from_label: from, to_label: to, actor_id: actor.id, at: ago(days),
});
async function affaire({ contactId, title, product, stage, status = 'open', wonDays = null, rep }) {
  const { data } = await db
    .from('deals')
    .insert({
      contact_id: contactId, title, product_id: product?.id ?? null,
      value_xof: product?.price_xof ?? null, pipeline_stage_id: stage,
      status, needs_installation: true, won_at: wonDays == null ? null : ago(wonDays),
      assigned_rep_id: rep.id, created_by: admin.id,
    })
    .select('id')
    .maybeSingle();
  return data.id;
}

const made = [];

// 1 ── A sale that took a month, and stalled in négociation ------------------
{
  const id = await fiche({
    name: 'Supérette Adjamé Centre', phone: '+225 0708112233',
    address: 'Rue du Commerce, Adjamé, Abidjan', lat: 5.3612, lng: -4.0201,
    type: 'Supérette', tags: ['3 caisses'], rep: rep1, lifecycle: 'customer',
  });
  const d = await affaire({
    contactId: id, title: 'Projet 1', product: big, stage: stageId('Gagné (Client)'),
    status: 'won', wonDays: 4, rep: rep1,
  });
  await db.from('contact_events').insert([
    cEv(id, 'Supérette Adjamé Centre', 'created', null, '5.36120, -4.02010', 45, rep1),
    cEv(id, 'Supérette Adjamé Centre', 'phone', null, '+225 0708112233', 44, rep1),
    cEv(id, 'Supérette Adjamé Centre', 'business_type', null, 'Supérette', 43, rep1),
    cEv(id, 'Supérette Adjamé Centre', 'tags', null, '3 caisses', 43, rep1),
  ]);
  await db.from('deal_events').insert([
    dEv(d, id, 'Projet 1', 'created', null, null, 44, rep1),
    dEv(d, id, 'Projet 1', 'stage', 'Nouveau', 'Contacté', 41, rep1),
    dEv(d, id, 'Projet 1', 'stage', 'Contacté', 'Intéressé', 36, rep1),
    dEv(d, id, 'Projet 1', 'stage', 'Intéressé', 'RDV', 30, rep1),
    dEv(d, id, 'Projet 1', 'product', small.name, big.name, 27, rep1),
    dEv(d, id, 'Projet 1', 'value', `${small.price_xof.toLocaleString('fr-FR')} F`, `${big.price_xof.toLocaleString('fr-FR')} F`, 27, rep1),
    dEv(d, id, 'Projet 1', 'stage', 'RDV', 'Négociation', 24, rep1),
    dEv(d, id, 'Projet 1', 'stage', 'Négociation', 'Gagné (Client)', 4, rep1),
  ]);
  made.push(['Supérette Adjamé Centre', id, 'vente lente — 20 jours bloqués en Négociation']);
}

// 2 ── An address corrected, a pin moved, an owner changed -------------------
{
  const id = await fiche({
    name: 'Maquis Le Baobab', phone: '+225 0709445566',
    address: 'Rue du Marché, Yopougon, Abidjan', lat: 5.3385, lng: -4.0712,
    type: 'Maquis', tags: ['20 tables'], rep: rep2,
  });
  const d = await affaire({
    contactId: id, title: 'Projet 1', product: small, stage: stageId('Négociation'), rep: rep2,
  });
  await db.from('contact_events').insert([
    cEv(id, 'Maquis Le Baobab', 'created', null, null, 34, admin),
    cEv(id, 'Maquis Le Baobab', 'phone', null, '+225 0709445566', 33, admin),
    // The pin moved on its own — the interesting case for the fraud check.
    cEv(id, 'Maquis Le Baobab', 'address', 'Yopougon (approximatif)', 'Rue du Marché, Yopougon, Abidjan', 12, rep2),
    cEv(id, 'Maquis Le Baobab', 'geo', '5.32040, -4.09880', '5.33850, -4.07120', 12, rep2),
    cEv(id, 'Maquis Le Baobab', 'business_type', null, 'Maquis', 11, rep2),
    cEv(id, 'Maquis Le Baobab', 'tags', null, '20 tables', 11, rep2),
    cEv(id, 'Maquis Le Baobab', 'assigned', nm(admin), nm(rep2), 9, admin),
  ]);
  await db.from('deal_events').insert([
    dEv(d, id, 'Projet 1', 'created', null, null, 33, admin),
    dEv(d, id, 'Projet 1', 'stage', 'Nouveau', 'Intéressé', 30, admin),
    dEv(d, id, 'Projet 1', 'stage', 'Intéressé', 'Négociation', 22, rep2),
  ]);
  made.push(['Maquis Le Baobab', id, 'adresse corrigée + point GPS déplacé + client transféré']);
}

// 3 ── An affaire that was deleted; its journal outlives it ------------------
{
  const id = await fiche({
    name: 'Boutique Cocody Nord', phone: '+225 0701778899',
    address: 'Boulevard Latrille, Cocody, Abidjan', lat: 5.3574, lng: -3.9949,
    type: 'Boutique', tags: [], rep: rep1,
  });
  const live = await affaire({
    contactId: id, title: 'Projet 2', product: small, stage: stageId('Contacté'), rep: rep1,
  });
  await db.from('contact_events').insert([
    cEv(id, 'Boutique Cocody Nord', 'created', null, '5.35740, -3.99490', 20, rep1),
    cEv(id, 'Boutique Cocody Nord', 'business_type', null, 'Boutique', 19, rep1),
  ]);
  // deal_id null is exactly what ON DELETE SET NULL leaves behind.
  await db.from('deal_events').insert([
    { deal_id: null, contact_id: id, deal_title: 'Projet 1', kind: 'created', actor_id: rep1.id, at: ago(19) },
    { deal_id: null, contact_id: id, deal_title: 'Projet 1', kind: 'stage', from_label: 'Nouveau', to_label: 'Contacté', actor_id: rep1.id, at: ago(17) },
    { deal_id: null, contact_id: id, deal_title: 'Projet 1', kind: 'deleted', from_label: 'open', actor_id: admin.id, at: ago(6) },
    dEv(live, id, 'Projet 2', 'created', null, null, 6, rep1),
    dEv(live, id, 'Projet 2', 'stage', 'Nouveau', 'Contacté', 3, rep1),
  ]);
  made.push(['Boutique Cocody Nord', id, 'affaire supprimée — son journal survit sur la fiche']);
}

// 4 ── On trial, extended once ----------------------------------------------
{
  const id = await fiche({
    name: 'Kiosque Riviera 3', phone: '+225 0702334455',
    address: 'Riviera 3, Cocody, Abidjan', lat: 5.3721, lng: -3.9612,
    type: 'Kiosque', tags: ['1 caisse'], rep: rep2,
  });
  const d = await affaire({
    contactId: id, title: 'Projet 1', product: big, stage: stageId('Essai'), rep: rep2,
  });
  const { data: job } = await db
    .from('installations')
    .insert({ deal_id: d, contact_id: id, title: 'Projet 1', status: 'done', origin: 'trial',
              installer_id: rep2.id, completed_at: ago(18), created_by: rep2.id })
    .select('id')
    .maybeSingle();
  await db.from('deal_trials').insert({
    deal_id: d, contact_id: id, seq: 1, started_on: day(18), ends_on: day(-27),
    installation_id: job.id, created_by: rep2.id,
    extensions: [{ at: day(4), by: rep2.id, to: day(-27), note: 'attend le retour du propriétaire' }],
  });
  await db.from('contact_events').insert([
    cEv(id, 'Kiosque Riviera 3', 'created', null, '5.37210, -3.96120', 25, rep2),
    cEv(id, 'Kiosque Riviera 3', 'business_type', null, 'Kiosque', 24, rep2),
  ]);
  await db.from('deal_events').insert([
    dEv(d, id, 'Projet 1', 'created', null, null, 24, rep2),
    dEv(d, id, 'Projet 1', 'stage', 'Nouveau', 'Négociation', 21, rep2),
    dEv(d, id, 'Projet 1', 'stage', 'Négociation', 'Essai', 18, rep2),
  ]);
  made.push(['Kiosque Riviera 3', id, 'en essai, prolongé une fois — l’essai est dans le même fil']);
}

// 5 ── Arrived by import: one line, and nothing else -------------------------
{
  const id = await fiche({
    name: 'Pharmacie Les Palmiers', phone: '+225 0703556677',
    address: 'Marcory Zone 4, Abidjan', lat: 5.2951, lng: -3.9977,
    type: 'Pharmacie', tags: [], rep: rep1,
  });
  await db.from('contacts').update({ source: 'import' }).eq('id', id);
  await db.from('contact_events').insert([
    cEv(id, 'Pharmacie Les Palmiers', 'imported', null, null, 60, admin),
    cEv(id, 'Pharmacie Les Palmiers', 'assigned', null, nm(rep1), 58, admin),
  ]);
  made.push(['Pharmacie Les Palmiers', id, 'arrivée par import — une seule ligne']);
}

console.log('\nfiches créées :\n');
for (const [name, id, what] of made) {
  console.log(`  ${name}`);
  console.log(`    ${what}`);
  console.log(`    https://nimbaa-crm.vercel.app/fr/contacts/${id}\n`);
}
console.log('purge : node supabase/seed/seed-journals-demo.mjs --purge');

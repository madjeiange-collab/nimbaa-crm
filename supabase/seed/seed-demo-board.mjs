/**
 * Simulation du classement : 6 employés de démo (4 commerciaux, 2 techniciens)
 * + ~10 jours d'activité réaliste (visites, affaires gagnées, installations).
 *
 * Ré-exécutable : à chaque lancement, l'ACTIVITÉ des comptes de démo est
 * supprimée puis regénérée (les comptes eux-mêmes sont conservés).
 *
 *   node supabase/seed/seed-demo-board.mjs
 *
 * Comptes créés (mot de passe commun) : Demo2026!
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadEnv();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? 'crm.local';
const PASSWORD = 'Demo2026!';
if (!URL_ || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.');
  process.exit(1);
}
const db = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } });

// --- Démo : personnel --------------------------------------------------------
const STAFF = [
  { username: 'awa', full_name: 'Awa Diabaté', role: 'rep', zone: [-4.07, 5.21, -3.88, 5.305], secteur: 'Abidjan Sud' },
  { username: 'kofi', full_name: 'Kofi Mensah', role: 'rep', zone: [-4.12, 5.36, -3.96, 5.52], secteur: 'Abidjan Nord' },
  { username: 'fatou', full_name: 'Fatou Koné', role: 'rep', zone: [-3.99, 5.29, -3.78, 5.42], secteur: 'Abidjan Est' },
  { username: 'yao', full_name: "Yao N'Guessan", role: 'rep', zone: [-4.2, 5.27, -4.03, 5.43], secteur: 'Abidjan Ouest' },
  { username: 'moussa', full_name: 'Moussa Traoré', role: 'technician', zone: null, secteur: null },
  { username: 'aicha', full_name: 'Aïcha Bamba', role: 'technician', zone: null, secteur: null },
];

const BUSINESS_NAMES = [
  'Boutique Chez Mariam', 'Maquis Le Rocher', 'Pharmacie du Rond-Point', 'Salon Élégance',
  'Cyber Espace Net+', 'Boulangerie La Baguette', 'Garage Auto Plus', 'Kiosque Bon Prix',
  'Restaurant Akwaba', 'Librairie Papeterie Sagesse', 'Alimentation Générale Yéhé',
  'Atelier Couture Awoulaba', 'Dépôt Boissons Fraîcheur', 'Coiffure Reine Pokou',
  'Superette Le Panier', 'Cave Le Baobab', 'Pressing Net Service', 'Studio Photo Souvenir',
  'Quincaillerie Solide', 'Maquis Ambiance 225', 'Boutique Mode Abidjanaise',
  'Clinique Espoir Santé', 'École Les Petits Génies', 'Hôtel Résidence Palmier',
  'Station Lavage Auto Brillant', 'Ferme Avicole Bonne Ponte', 'Menuiserie Bois Précieux',
  'Agence Voyage Horizon', 'Imprimerie Rapide Plus', 'Boucherie Halal Barka',
];

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const phone = () => `+225 0${pick(['1', '5', '7'])} ${randInt(10, 99)} ${randInt(10, 99)} ${randInt(10, 99)} ${randInt(10, 99)}`;

// Weighted dispositions for a field day.
function randomDisposition() {
  const r = Math.random();
  if (r < 0.3) return 'no_answer';
  if (r < 0.45) return 'not_home';
  if (r < 0.6) return 'refused';
  if (r < 0.8) return 'interested';
  if (r < 0.9) return 'appointment_set';
  return 'sold';
}

async function ensureUser(spec) {
  const { data: existing } = await db
    .from('users')
    .select('id')
    .eq('username', spec.username)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await db.auth.admin.createUser({
    email: `${spec.username}@${DOMAIN}`,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { username: spec.username, full_name: spec.full_name },
  });
  if (error) throw new Error(`createUser ${spec.username}: ${error.message}`);
  const { error: upd } = await db
    .from('users')
    .update({
      role: spec.role,
      can_do_b2b: spec.role === 'rep',
      can_do_d2d: spec.role === 'rep',
      is_active: true,
      username: spec.username,
      full_name: spec.full_name,
    })
    .eq('id', created.user.id);
  if (upd) throw new Error(`promote ${spec.username}: ${upd.message}`);
  console.log(`+ Compte créé : ${spec.username} (${spec.role})`);
  return created.user.id;
}

async function main() {
  // 1. Ensure demo staff exists.
  const ids = {};
  for (const s of STAFF) ids[s.username] = await ensureUser(s);
  const repIds = STAFF.filter((s) => s.role === 'rep').map((s) => ids[s.username]);
  const techIds = STAFF.filter((s) => s.role === 'technician').map((s) => ids[s.username]);
  const demoIds = [...repIds, ...techIds];

  // 1b. Assign each rep their home secteur (keeps flagged_visits honest).
  const { data: allTerrs } = await db.from('territories').select('id, name');
  for (const s of STAFF.filter((x) => x.secteur)) {
    const terr = allTerrs?.find((t) => t.name === s.secteur);
    if (!terr) continue;
    await db
      .from('user_territories')
      .upsert({ user_id: ids[s.username], territory_id: terr.id }, { onConflict: 'user_id,territory_id' });
  }

  // 2. Wipe previous demo ACTIVITY (accounts stay).
  await db.from('visits').delete().in('rep_id', demoIds);
  await db.from('installations').delete().in('installer_id', techIds);
  await db.from('deals').delete().in('assigned_rep_id', demoIds);
  await db.from('contacts').delete().in('created_by', demoIds);
  console.log('→ Ancienne activité de démo purgée');

  // 3. Reference data.
  const { data: stages } = await db.from('pipeline_stages').select('id, name');
  const stageId = (name) => stages?.find((s) => s.name === name)?.id ?? null;
  const { data: products } = await db
    .from('products')
    .select('id, name, price_xof')
    .eq('is_active', true);
  if (!products?.length) {
    console.error('Aucun produit actif — lancez d’abord seed-demo.mjs');
    process.exit(1);
  }

  // 4. Generate ~10 days of activity per rep (skill varies per rep for a
  //    believable spread on the board).
  const skills = { [ids.awa]: 1.25, [ids.kofi]: 1.0, [ids.fatou]: 0.8, [ids.yao]: 0.55 };
  let nVisits = 0, nContacts = 0, nWon = 0, nInstalls = 0;
  const wonDeals = []; // for installations

  for (const s of STAFF.filter((x) => x.role === 'rep')) {
    const repId = ids[s.username];
    const [w, so, e, n] = s.zone;
    const skill = skills[repId] ?? 1;

    for (let daysAgo = 9; daysAgo >= 0; daysAgo--) {
      const day = new Date();
      day.setDate(day.getDate() - daysAgo);
      if (day.getDay() === 0) continue; // dimanche off
      const visitsToday = Math.round(randInt(8, 16) * skill);

      for (let i = 0; i < visitsToday; i++) {
        const at = new Date(day);
        at.setHours(randInt(8, 17), randInt(0, 59), randInt(0, 59), 0);
        if (at > new Date()) continue; // pas de visites dans le futur
        const lat = rand(so, n);
        const lng = rand(w, e);
        const disposition = randomDisposition();
        const engaged = ['interested', 'appointment_set', 'sold'].includes(disposition);

        let contactId = null;
        if (engaged) {
          const name = `${pick(BUSINESS_NAMES)} ${randInt(2, 99)}`;
          const sold = disposition === 'sold';
          const product = pick(products);
          const { data: contact, error: cErr } = await db
            .from('contacts')
            .insert({
              name,
              phone: phone(),
              address: 'Abidjan',
              lat, lng,
              lifecycle: sold ? 'customer' : 'lead',
              pipeline_stage_id: stageId(sold ? 'Gagné (Client)' : disposition === 'sold' ? 'Gagné (Client)' : disposition === 'appointment_set' ? 'RDV' : 'Intéressé'),
              priority: pick(['medium', 'medium', 'high', 'low']),
              source: 'd2d_knock',
              assigned_rep_id: repId,
              created_by: repId,
              value_xof: sold ? product.price_xof : null,
              converted_at: sold ? at.toISOString() : null,
              tags: ['demo'],
            })
            .select('id')
            .single();
          if (cErr) { console.error('contact:', cErr.message); continue; }
          contactId = contact.id;
          nContacts++;

          const { data: deal, error: dErr } = await db
            .from('deals')
            .insert({
              contact_id: contactId,
              title: product.name,
              product_id: product.id,
              value_xof: product.price_xof,
              pipeline_stage_id: stageId(sold ? 'Gagné (Client)' : disposition === 'appointment_set' ? 'RDV' : 'Intéressé'),
              status: sold ? 'won' : 'open',
              needs_installation: sold && Math.random() < 0.75,
              assigned_rep_id: repId,
              won_at: sold ? at.toISOString() : null,
              created_by: repId,
            })
            .select('id, needs_installation')
            .single();
          if (dErr) { console.error('deal:', dErr.message); continue; }
          if (sold) {
            nWon++;
            if (deal.needs_installation) {
              wonDeals.push({ dealId: deal.id, contactId, title: product.name, at });
            }
          }
        }

        const { error: vErr } = await db.from('visits').insert({
          contact_id: contactId,
          rep_id: repId,
          visit_type: 'd2d_knock',
          visited_at: at.toISOString(),
          lat, lng,
          disposition,
          appointment_date:
            disposition === 'appointment_set'
              ? new Date(at.getTime() + randInt(1, 5) * 86400_000).toISOString()
              : null,
          notes: null,
        });
        if (vErr) console.error('visit:', vErr.message);
        else nVisits++;
      }
    }
  }

  // 5. Installations for the technicians from the won deals.
  for (const w of wonDeals) {
    const installerId = pick(techIds);
    const r = Math.random();
    let fields;
    if (r < 0.55) {
      const completed = new Date(w.at.getTime() + randInt(1, 3) * 86400_000);
      fields = {
        status: 'done',
        started_at: new Date(completed.getTime() - 2 * 3600_000).toISOString(),
        completed_at: (completed > new Date() ? new Date() : completed).toISOString(),
      };
    } else if (r < 0.75) {
      fields = {
        status: 'scheduled',
        scheduled_date: new Date(Date.now() + randInt(1, 6) * 86400_000).toISOString().slice(0, 10),
      };
    } else if (r < 0.88) {
      fields = { status: 'in_progress', started_at: new Date().toISOString() };
    } else {
      fields = {
        status: 'needs_revisit',
        started_at: new Date(w.at.getTime() + 86400_000).toISOString(),
        next_visit_date: new Date(Date.now() + randInt(2, 7) * 86400_000).toISOString().slice(0, 10),
      };
    }
    const { error } = await db.from('installations').insert({
      contact_id: w.contactId,
      deal_id: w.dealId,
      title: w.title,
      installer_id: installerId,
      created_by: installerId,
      ...fields,
    });
    if (error) console.error('installation:', error.message);
    else nInstalls++;
  }

  console.log('----------------------------------------');
  console.log(`Visites : ${nVisits} · Contacts : ${nContacts} · Affaires gagnées : ${nWon} · Installations : ${nInstalls}`);
  console.log(`Comptes démo (mdp ${PASSWORD}) : ${STAFF.map((s) => s.username).join(', ')}`);
  console.log('Terminé — ouvrez /leaderboard.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Seed dummy data to test INSTALLATIONS.
 *
 *   node supabase/seed/seed-installations.mjs
 *
 * Prerequisite: migration 0005_technicians.sql must already be applied
 * (adds the `technician` role, `installation` visit type and the
 * `installations` table). The script probes for it and stops with a clear
 * message if it is missing.
 *
 * Creates (idempotent — safe to re-run):
 *   - a technician login  ..................  technicien / TechCRM2026!
 *   - 5 dummy customers (tagged "seed-install")
 *   - installation jobs across every status (pending / scheduled /
 *     in_progress / needs_revisit / done), incl. a customer with 2 jobs.
 *
 * Re-running deletes the previously seeded customers (installations cascade)
 * and recreates them, so counts stay stable.
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
  } catch {
    /* rely on the environment */
  }
}
loadEnv();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? 'crm.local';

if (!URL_ || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const supabase = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const CHECKLIST = [
  { key: 'site_ready', label: 'Site préparé', done: false },
  { key: 'unit_mounted', label: 'Unité montée', done: false },
  { key: 'wiring', label: 'Câblage effectué', done: false },
  { key: 'power_on', label: 'Mise sous tension', done: false },
  { key: 'function_test', label: 'Test fonctionnel', done: false },
  { key: 'customer_training', label: 'Formation client', done: false },
];
const checklist = (doneCount) =>
  CHECKLIST.map((s, i) => ({ ...s, done: i < doneCount }));

// --- 0. Probe that migration 0005 is applied --------------------------------
{
  const { error } = await supabase.from('installations').select('id').limit(1);
  if (error) {
    console.error('❌ The `installations` table is missing — apply migration 0005 first:');
    console.error('   Open Supabase → SQL editor → paste supabase/migrations/0005_technicians.sql → Run.');
    console.error(`   (details: ${error.message})`);
    process.exit(1);
  }
}

// --- 1. Ensure the technician login -----------------------------------------
const techUsername = 'technicien';
const techPassword = 'TechCRM2026!';
const techEmail = `${techUsername}@${DOMAIN}`;

async function findUserByEmail(email) {
  // Paginate through auth users (small project — a couple pages max).
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

let techId;
{
  const { data: created, error } = await supabase.auth.admin.createUser({
    email: techEmail,
    password: techPassword,
    email_confirm: true,
    user_metadata: { username: techUsername, full_name: 'Koffi Kouassi' },
  });
  if (created?.user) {
    techId = created.user.id;
  } else {
    const existing = await findUserByEmail(techEmail);
    if (!existing) {
      console.error('❌ Could not create or find the technician user:', error?.message);
      process.exit(1);
    }
    techId = existing.id;
  }
}

{
  const { error } = await supabase
    .from('users')
    .update({
      role: 'technician',
      full_name: 'Koffi Kouassi',
      username: techUsername,
      is_active: true,
    })
    .eq('id', techId);
  if (error) {
    console.error('❌ Could not set role=technician (is 0005 applied?):', error.message);
    process.exit(1);
  }
}
console.log(`✅ Technician login ready: ${techUsername} / ${techPassword}`);

// --- 2. Reset previously seeded customers (installations cascade) -----------
{
  const { data: old } = await supabase
    .from('contacts')
    .select('id')
    .contains('tags', ['seed-install']);
  const ids = (old ?? []).map((c) => c.id);
  if (ids.length) {
    await supabase.from('installations').delete().in('contact_id', ids);
    await supabase.from('contacts').delete().in('id', ids);
    console.log(`↺ Removed ${ids.length} previously seeded customer(s).`);
  }
}

// --- 3. Dummy customers (Cocody, Abidjan) -----------------------------------
const CUSTOMERS = [
  { name: 'Pharmacie Les Palmiers', phone: '+2250701020304', address: 'Cocody Riviera 2', lat: 5.3562, lng: -3.9881 },
  { name: 'Boulangerie du Plateau', phone: '+2250705060708', address: 'Cocody Angré 7e', lat: 5.3901, lng: -3.9762 },
  { name: 'Hôtel Ivoire Résidence', phone: '+2250709101112', address: 'Cocody Blockhauss', lat: 5.3288, lng: -3.9955 },
  { name: 'Restaurant Le Baobab', phone: '+2250713141516', address: 'Cocody Danga', lat: 5.3477, lng: -3.9902 },
  { name: 'Clinique Saint-Jean', phone: '+2250717181920', address: 'Cocody 2 Plateaux', lat: 5.3689, lng: -3.9847 },
];

const rows = CUSTOMERS.map((c) => ({
  name: c.name,
  phone: c.phone,
  address: c.address,
  lat: c.lat,
  lng: c.lng,
  lifecycle: 'customer',
  source: 'manual',
  tags: ['seed-install'],
  converted_at: daysAgo(10),
  created_by: techId,
}));

const { data: inserted, error: cErr } = await supabase
  .from('contacts')
  .insert(rows)
  .select('id, name');
if (cErr) {
  console.error('❌ Customer insert failed:', cErr.message);
  process.exit(1);
}
const byName = Object.fromEntries(inserted.map((c) => [c.name, c.id]));
console.log(`✅ Inserted ${inserted.length} dummy customers.`);

// --- 4. Installation jobs across every status -------------------------------
const jobs = [
  // Unassigned, waiting for dispatch.
  {
    contact_id: byName['Pharmacie Les Palmiers'],
    title: 'Climatiseur split 12000 BTU',
    status: 'pending',
    checklist: checklist(0),
    equipment: [],
    created_by: techId,
  },
  // Scheduled for the technician.
  {
    contact_id: byName['Boulangerie du Plateau'],
    title: 'Four électrique + onduleur',
    status: 'scheduled',
    installer_id: techId,
    scheduled_date: daysAhead(2),
    checklist: checklist(0),
    equipment: [],
    created_by: techId,
  },
  // In progress, half the checklist done, one unit installed.
  {
    contact_id: byName['Hôtel Ivoire Résidence'],
    title: 'Système de vidéosurveillance',
    status: 'in_progress',
    installer_id: techId,
    started_at: daysAgo(1),
    checklist: checklist(3),
    equipment: [{ label: 'NVR 8 canaux', serial: 'NVR-88213' }],
    created_by: techId,
  },
  // Needs a return visit.
  {
    contact_id: byName['Restaurant Le Baobab'],
    title: 'Chambre froide',
    status: 'needs_revisit',
    installer_id: techId,
    started_at: daysAgo(3),
    next_visit_date: daysAhead(4),
    checklist: checklist(2),
    equipment: [{ label: 'Groupe froid', serial: 'GF-4471' }],
    created_by: techId,
    notes: 'Manque une pièce — retour prévu.',
  },
  // Completed this week (feeds the "done (7d)" KPI).
  {
    contact_id: byName['Clinique Saint-Jean'],
    title: 'Panneaux solaires 3kW',
    status: 'done',
    installer_id: techId,
    started_at: daysAgo(5),
    completed_at: daysAgo(2),
    checklist: checklist(6),
    equipment: [
      { label: 'Panneau 550W', serial: 'PV-0091' },
      { label: 'Onduleur hybride', serial: 'INV-2210' },
      { label: 'Batterie LiFePO4', serial: 'BAT-7788' },
    ],
    created_by: techId,
  },
  // Second job on an existing customer — demonstrates multiple jobs per customer.
  {
    contact_id: byName['Hôtel Ivoire Résidence'],
    title: 'Contrôle d’accès portail',
    status: 'pending',
    checklist: checklist(0),
    equipment: [],
    created_by: techId,
  },
];

const { error: jErr } = await supabase.from('installations').insert(jobs);
if (jErr) {
  console.error('❌ Installation jobs insert failed:', jErr.message);
  process.exit(1);
}
console.log(`✅ Inserted ${jobs.length} installation jobs (pending/scheduled/in_progress/needs_revisit/done).`);
console.log('\n🎉 Done. Log in as the technician (technicien / TechCRM2026!) → "Enregistrer une installation",');
console.log('   or as admin → the customers above show their installation jobs, and the dashboard shows the KPIs.');

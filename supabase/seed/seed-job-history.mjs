/**
 * Job-history demo — RE-RUNNABLE.
 *
 * Builds installation jobs that actually have a story, so the "Historique du
 * chantier" panel, the follow-up tasks and the revisit tracking have something
 * to show before the team starts working:
 *
 *   A  one trip, finished          → first-time fix
 *   B  two trips (retour → fini)   → one return
 *   C  three trips (2 retours)     → the "how often" case
 *   D  two trips, still open       → open task, due in 3 days
 *   E  one trip, retour requis     → OVERDUE task
 *   F  one trip, still in progress → no task
 *   + two rendez-vous tasks for a commercial (one of them overdue)
 *   + four interventions that no sale produced (SAV planned, SAV resolved,
 *     warranty that needed a return, maintenance to come) — no deal, so no
 *     commission and nothing in the pipeline
 *
 * Every trip carries its own arrival/end photo pair metadata, the status the
 * technician concluded at that trip, and a snapshot of the protocol at that
 * moment — which is what the history panel reads.
 *
 * Run:    node supabase/seed/seed-job-history.mjs
 * Remove: node supabase/seed/seed-job-history.mjs --purge
 *
 * Rows use a fixed id namespace (0d000000-…) so the purge is exact and can
 * never touch real data. Photo paths are placeholders, so thumbnails fall back
 * to the check-in/check-out icons.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const purgeOnly = process.argv.includes('--purge');
/** Deterministic ids in a namespace that only this seed ever uses. */
const demoId = (n) => `0d000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const VISIT_IDS = Array.from({ length: 40 }, (_, i) => demoId(i + 1));
const TASK_IDS = Array.from({ length: 20 }, (_, i) => demoId(500 + i));
/** Interventions this seed CREATES (SAV etc.), as opposed to jobs it borrows. */
const INTERVENTION_IDS = Array.from({ length: 10 }, (_, i) => demoId(900 + i));

// ---------- purge ----------
const { data: oldVisits } = await db.from('visits').select('id, installation_id').in('id', VISIT_IDS);
const borrowed = [
  ...new Set(
    (oldVisits ?? [])
      .map((v) => v.installation_id)
      .filter((id) => id && !INTERVENTION_IDS.includes(id)),
  ),
];
await db.from('tasks').delete().in('id', TASK_IDS);
await db.from('visit_photos').delete().in('visit_id', VISIT_IDS);
await db.from('visits').delete().in('id', VISIT_IDS);
// Interventions are ours to delete outright; borrowed jobs are only restored.
await db.from('tasks').delete().in('installation_id', INTERVENTION_IDS);
await db.from('commission_entries').delete().in('installation_id', INTERVENTION_IDS);
const { data: killed } = await db
  .from('installations')
  .delete()
  .in('id', INTERVENTION_IDS)
  .select('id');
if (borrowed.length > 0) {
  await db.from('commission_entries').delete().in('installation_id', borrowed);
}
console.log(
  `purged ${(oldVisits ?? []).length} demo trips · ${borrowed.length} borrowed jobs · ${(killed ?? []).length} demo interventions`,
);
const touchedJobs = borrowed;

// ---------- protocol template ----------
const { data: stepRows } = await db
  .from('install_protocol_steps')
  .select('key, label')
  .eq('is_active', true)
  .order('sort_order');
const STEPS = (stepRows ?? []).map((s) => ({ key: s.key, label: s.label }));
if (STEPS.length === 0) throw new Error('no active protocol steps');
const snapshot = (doneCount) =>
  STEPS.map((s, i) => ({ ...s, done: i < doneCount }));

// Restore every job this seed had touched, then stop if only purging.
const freshChecklist = snapshot(0);
if (touchedJobs.length > 0) {
  await db
    .from('installations')
    .update({
      status: 'scheduled',
      started_at: null,
      completed_at: null,
      next_visit_date: null,
      notes: null,
      checklist: freshChecklist,
    })
    .in('id', touchedJobs);
}
if (purgeOnly) {
  console.log('restored the jobs it had used — nothing else to do');
  process.exit(0);
}

// ---------- who and where ----------
const { data: users } = await db.from('users').select('id, username, role');
const techIds = ['moussa', 'aicha'].map((u) => users.find((x) => x.username === u)?.id).filter(Boolean);
const repId = users.find((u) => u.username === 'kofi')?.id;
if (techIds.length < 2 || !repId) throw new Error('demo accounts missing — run seed-demo-board.mjs first');

// Jobs that don't already carry linked trips, so histories stay clean.
const { data: linked } = await db.from('visits').select('installation_id').not('installation_id', 'is', null);
const busy = new Set((linked ?? []).map((v) => v.installation_id));
const { data: jobRows } = await db
  .from('installations')
  .select('id, contact_id, deal_id, title, contacts(name, lat, lng)')
  .limit(60);
const jobs = (jobRows ?? []).filter((j) => !busy.has(j.id) && j.contact_id);
if (jobs.length < 6) throw new Error(`need 6 free jobs, found ${jobs.length}`);

const DAY = 864e5;
const at = (daysAgo, h, m) => {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setUTCHours(h, m, 0, 0);
  return d;
};

let visitCursor = 0;
let taskCursor = 0;
const jitter = () => (Math.random() - 0.5) * 0.0004;

/** One trip: a visits row + its arrival/end photo pair. */
async function trip(job, { tech, inAt, minutes, outcome, stepsDone, note }) {
  const id = VISIT_IDS[visitCursor++];
  const outAt = new Date(inAt.getTime() + minutes * 60_000);
  const lat = job.contacts?.lat ?? 5.3364;
  const lng = job.contacts?.lng ?? -4.0267;

  const { error } = await db.from('visits').insert({
    id,
    client_uuid: id,
    contact_id: job.contact_id,
    deal_id: job.deal_id ?? null,
    installation_id: job.id,
    rep_id: tech,
    visit_type: 'installation',
    visited_at: outAt.toISOString(),
    started_at: inAt.toISOString(),
    created_at: outAt.toISOString(),
    lat,
    lng,
    notes: note ?? null,
    install_status: outcome,
    checklist_snapshot: snapshot(stepsDone),
    next_visit_date: null,
  });
  if (error) throw error;

  await db.from('visit_photos').insert(
    ['arrival', 'completion'].map((kind, k) => ({
      visit_id: id,
      storage_path: `demo/jobdemo-${id}-${kind}.jpg`,
      kind,
      lat: lat + jitter(),
      lng: lng + jitter(),
      accuracy: 11 + k,
      captured_at: (k === 0 ? inAt : outAt).toISOString(),
      phash: Math.random().toString(16).slice(2, 18),
      taken_at: (k === 0 ? inAt : outAt).toISOString(),
    })),
  );
  return { inAt, outAt };
}

async function task(job, { owner, dueAt, title, details }) {
  const id = TASK_IDS[taskCursor++];
  const { error } = await db.from('tasks').insert({
    id,
    contact_id: job?.contact_id ?? null,
    deal_id: job?.deal_id ?? null,
    installation_id: job?.id ?? null,
    // A task hanging off a job is a return trip; one on a bare contact is a
    // rendez-vous. The RDV callers pass a job-shaped object with id: null, so
    // this has to test the id, not the object.
    kind: job?.id ? 'revisit' : 'rdv',
    title,
    details: details ?? null,
    due_at: dueAt.toISOString(),
    assigned_to: owner,
    created_by: owner,
    status: 'open',
  });
  if (error) throw error;
}

const pending = (n) =>
  `Reste à faire : ${STEPS.slice(n).map((s) => s.label).join(', ')}`;

// ---------- A · one trip, finished ----------
const A = jobs[0];
await trip(A, { tech: techIds[0], inAt: at(9, 8, 40), minutes: 95, outcome: 'done', stepsDone: STEPS.length, note: 'Installation complète, client formé.' });
await db.from('installations').update({
  status: 'done', installer_id: techIds[0], checklist: snapshot(STEPS.length),
  started_at: at(9, 8, 40).toISOString(), completed_at: at(9, 10, 15).toISOString(),
  next_visit_date: null, notes: 'Installation complète, client formé.',
}).eq('id', A.id);

// ---------- B · two trips: one return ----------
const B = jobs[1];
await trip(B, { tech: techIds[0], inAt: at(11, 9, 10), minutes: 70, outcome: 'needs_revisit', stepsDone: 3, note: 'Courant coupé dans le quartier, mise sous tension impossible.' });
await trip(B, { tech: techIds[0], inAt: at(7, 14, 5), minutes: 55, outcome: 'done', stepsDone: STEPS.length, note: 'Repris après retour du courant, tout est fonctionnel.' });
await db.from('installations').update({
  status: 'done', installer_id: techIds[0], checklist: snapshot(STEPS.length),
  started_at: at(11, 9, 10).toISOString(), completed_at: at(7, 15, 0).toISOString(),
  next_visit_date: null, notes: 'Repris après retour du courant, tout est fonctionnel.',
}).eq('id', B.id);

// ---------- C · three trips: two returns ----------
const C = jobs[2];
await trip(C, { tech: techIds[1], inAt: at(12, 8, 20), minutes: 60, outcome: 'needs_revisit', stepsDone: 2, note: 'Support mural à refaire par le client avant la pose.' });
await trip(C, { tech: techIds[1], inAt: at(8, 11, 0), minutes: 80, outcome: 'needs_revisit', stepsDone: 4, note: 'Onduleur non conforme, pièce commandée.' });
await trip(C, { tech: techIds[1], inAt: at(3, 9, 30), minutes: 65, outcome: 'done', stepsDone: STEPS.length, note: 'Onduleur remplacé, test fonctionnel OK.' });
await db.from('installations').update({
  status: 'done', installer_id: techIds[1], checklist: snapshot(STEPS.length),
  started_at: at(12, 8, 20).toISOString(), completed_at: at(3, 10, 35).toISOString(),
  next_visit_date: null, notes: 'Onduleur remplacé, test fonctionnel OK.',
}).eq('id', C.id);

// ---------- D · two trips, still open + task due in 3 days ----------
const D = jobs[3];
const dDue = new Date(Date.now() + 3 * DAY);
await trip(D, { tech: techIds[0], inAt: at(6, 10, 0), minutes: 50, outcome: 'needs_revisit', stepsDone: 2, note: 'Accès au tableau électrique impossible, gérant absent.' });
await trip(D, { tech: techIds[0], inAt: at(2, 15, 20), minutes: 45, outcome: 'needs_revisit', stepsDone: 3, note: 'Câblage entamé, il manque une gaine.' });
await db.from('installations').update({
  status: 'needs_revisit', installer_id: techIds[0], checklist: snapshot(3),
  started_at: at(6, 10, 0).toISOString(), completed_at: null,
  next_visit_date: dDue.toISOString().slice(0, 10), notes: 'Câblage entamé, il manque une gaine.',
}).eq('id', D.id);
await task(D, {
  owner: techIds[0], dueAt: dDue,
  title: `Retour chantier — ${D.contacts?.name ?? D.title ?? 'client'}`,
  details: `${pending(3)} — Câblage entamé, il manque une gaine.`,
});

// ---------- E · one trip, return OVERDUE ----------
const E = jobs[4];
const eDue = new Date(Date.now() - 2 * DAY);
await trip(E, { tech: techIds[1], inAt: at(5, 13, 45), minutes: 40, outcome: 'needs_revisit', stepsDone: 1, note: 'Local non préparé, retour à programmer.' });
await db.from('installations').update({
  status: 'needs_revisit', installer_id: techIds[1], checklist: snapshot(1),
  started_at: at(5, 13, 45).toISOString(), completed_at: null,
  next_visit_date: eDue.toISOString().slice(0, 10), notes: 'Local non préparé, retour à programmer.',
}).eq('id', E.id);
await task(E, {
  owner: techIds[1], dueAt: eDue,
  title: `Retour chantier — ${E.contacts?.name ?? E.title ?? 'client'}`,
  details: `${pending(1)} — Local non préparé, retour à programmer.`,
});

// ---------- F · one trip, still in progress ----------
const F = jobs[5];
await trip(F, { tech: techIds[0], inAt: at(1, 8, 55), minutes: 110, outcome: 'in_progress', stepsDone: 4, note: 'Pose avancée, test prévu au prochain passage.' });
await db.from('installations').update({
  status: 'in_progress', installer_id: techIds[0], checklist: snapshot(4),
  started_at: at(1, 8, 55).toISOString(), completed_at: null,
  next_visit_date: null, notes: 'Pose avancée, test prévu au prochain passage.',
}).eq('id', F.id);

// ---------- interventions: jobs no sale produced ----------
// These prove the after-sales path: raised by a technician, no deal, no
// commission, and invisible to the pipeline.
const { data: customerRows } = await db
  .from('contacts')
  .select('id, name, lat, lng')
  .eq('lifecycle', 'customer')
  .not('lat', 'is', null)
  .limit(20);
const customers = (customerRows ?? []).filter((c) => !jobs.slice(0, 6).some((j) => j.contact_id === c.id));

let interventionCursor = 0;
async function intervention({ customer, origin, title, reason, tech, status, scheduledDate, trips = [] }) {
  const id = INTERVENTION_IDS[interventionCursor++];
  const { error } = await db.from('installations').insert({
    id,
    contact_id: customer.id,
    deal_id: null,
    origin,
    reason,
    title,
    status,
    checklist: snapshot(0),
    equipment: [],
    installer_id: tech,
    scheduled_date: scheduledDate ?? null,
    created_by: tech,
  });
  if (error) throw error;
  const job = { id, contact_id: customer.id, deal_id: null, title, contacts: customer };
  for (const spec of trips) await trip(job, { tech, ...spec });
  return job;
}

if (customers.length >= 4) {
  // 1 · reported yesterday, technician goes in two days — sits in the queue
  await intervention({
    customer: customers[0],
    origin: 'service',
    title: 'SAV — climatiseur',
    reason: 'Le climatiseur ne refroidit plus depuis deux jours.',
    tech: techIds[0],
    status: 'scheduled',
    scheduledDate: new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10),
  });

  // 2 · called in the morning, fixed the same afternoon
  const fixed = await intervention({
    customer: customers[1],
    origin: 'service',
    title: 'SAV — disjoncteur',
    reason: 'Disjoncteur qui saute au démarrage du four.',
    tech: techIds[1],
    status: 'done',
    trips: [
      { inAt: at(4, 14, 10), minutes: 55, outcome: 'done', stepsDone: STEPS.length, note: 'Disjoncteur sous-dimensionné remplacé, test OK.' },
    ],
  });
  await db.from('installations').update({
    started_at: at(4, 14, 10).toISOString(),
    completed_at: at(4, 15, 5).toISOString(),
    checklist: snapshot(STEPS.length),
    notes: 'Disjoncteur sous-dimensionné remplacé, test OK.',
  }).eq('id', fixed.id);

  // 3 · warranty return that itself needed a second trip
  const warranty = await intervention({
    customer: customers[2],
    origin: 'warranty',
    title: 'Garantie — onduleur',
    reason: 'Onduleur HS après trois semaines, sous garantie.',
    tech: techIds[0],
    status: 'done',
    trips: [
      { inAt: at(10, 9, 0), minutes: 45, outcome: 'needs_revisit', stepsDone: 2, note: 'Onduleur à remplacer, pièce sous garantie commandée.' },
      { inAt: at(6, 11, 30), minutes: 70, outcome: 'done', stepsDone: STEPS.length, note: 'Onduleur remplacé sous garantie, client satisfait.' },
    ],
  });
  await db.from('installations').update({
    started_at: at(10, 9, 0).toISOString(),
    completed_at: at(6, 12, 40).toISOString(),
    checklist: snapshot(STEPS.length),
    notes: 'Onduleur remplacé sous garantie, client satisfait.',
  }).eq('id', warranty.id);

  // 4 · planned upkeep, still to do
  await intervention({
    customer: customers[3],
    origin: 'maintenance',
    title: 'Entretien semestriel',
    reason: 'Nettoyage filtres et contrôle général.',
    tech: techIds[1],
    status: 'scheduled',
    scheduledDate: new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10),
  });
}

// ---------- two rendez-vous for the commercial ----------
const { data: leads } = await db
  .from('contacts')
  .select('id, name')
  .eq('assigned_rep_id', repId)
  .eq('lifecycle', 'lead')
  .limit(2);
if ((leads ?? []).length === 2) {
  await task(
    { contact_id: leads[0].id, deal_id: null, id: null },
    {
      owner: repId,
      dueAt: new Date(Date.now() + 0.6 * DAY),
      title: `Rendez-vous — ${leads[0].name}`,
      details: 'Présenter le forfait Power Up, le gérant veut comparer les prix.',
    },
  );
  await task(
    { contact_id: leads[1].id, deal_id: null, id: null },
    {
      owner: repId,
      dueAt: new Date(Date.now() - 1.2 * DAY),
      title: `Rendez-vous — ${leads[1].name}`,
      details: 'Devis promis la semaine dernière — relancer.',
    },
  );
}

console.log(`created ${visitCursor} trips across 6 jobs and ${taskCursor} open follow-ups`);
console.log('A 1 passage · B 2 (1 retour) · C 3 (2 retours) · D 2 en cours · E retour en retard · F en cours');
console.log(
  `+ ${interventionCursor} interventions sans vente : SAV planifié · SAV résolu · garantie avec retour · entretien à venir`,
);

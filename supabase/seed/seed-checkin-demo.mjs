/**
 * Check-In / Check-Out demo data — RE-RUNNABLE.
 *
 * Fills the Check-In and -Out page with a realistic week for the whole demo
 * team: four commercials doing paired visits and two technicians doing paired
 * site trips, over the last 6 working days (Sundays off).
 *
 * It also plants one of each anomaly on the most recent day, so every check on
 * the page fires at least once and you can see what a real alert looks like:
 *   kofi   — an engaged visit closed in 2 min      → Visites trop courtes
 *   fatou  — end photo 420 m from the arrival one  → Photos arrivée/fin éloignées
 *   awa    — photos 600 m from the customer's pin  → Photo loin du client
 *   yao    — the same photo on two visits          → Photos réutilisées
 *   aicha  — a trip synced 45 min late             → Décalage horloge
 *   moussa — an installation finished in 6 min     → Installations trop rapides
 *
 * Run:    node supabase/seed/seed-checkin-demo.mjs
 * Remove: node supabase/seed/seed-checkin-demo.mjs --purge
 *
 * NOTE: photo rows point at placeholder storage paths, so the journal shows
 * the dashed check-in/check-out icons instead of thumbnails. Visits logged
 * from the app carry real photos.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const TAG = '[journal-demo]';
const DAYS = 6;
const purgeOnly = process.argv.includes('--purge');

/** Seeded PRNG so re-runs reproduce the same week. */
let seed = 20260818;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));

// ---------- purge previous run ----------
const { data: oldVisits } = await db.from('visits').select('id').eq('notes', TAG);
const oldIds = (oldVisits ?? []).map((r) => r.id);
if (oldIds.length > 0) {
  await db.from('visit_photos').delete().in('visit_id', oldIds);
  await db.from('visits').delete().in('id', oldIds);
}
const { data: oldInstalls } = await db.from('installations').select('id').eq('notes', TAG);
if ((oldInstalls ?? []).length > 0) {
  await db.from('installations').delete().in('id', (oldInstalls ?? []).map((r) => r.id));
}
console.log(`purged ${oldIds.length} passages + ${(oldInstalls ?? []).length} installations`);
if (purgeOnly) process.exit(0);

// ---------- who ----------
const { data: users } = await db.from('users').select('id, username, role');
const idOf = (u) => users.find((x) => x.username === u)?.id;
const REPS = ['kofi', 'fatou', 'awa', 'yao'].map((u) => ({ username: u, id: idOf(u) }));
const TECHS = ['moussa', 'aicha'].map((u) => ({ username: u, id: idOf(u) }));
if ([...REPS, ...TECHS].some((p) => !p.id)) {
  throw new Error('demo accounts missing — run seed-demo-board.mjs first');
}

// Each rep works their own contacts; technicians visit customers.
const contactsFor = async (repId) => {
  const { data } = await db
    .from('contacts')
    .select('id, lat, lng')
    .eq('assigned_rep_id', repId)
    .not('lat', 'is', null)
    .limit(40);
  return data ?? [];
};
const { data: customerRows } = await db
  .from('contacts')
  .select('id, lat, lng')
  .eq('lifecycle', 'customer')
  .not('lat', 'is', null)
  .limit(40);
const customers = customerRows ?? [];

const DISPOSITIONS = [
  'no_answer',
  'no_answer',
  'not_home',
  'refused',
  'interested',
  'interested',
  'appointment_set',
  'sold',
];

const day0 = new Date();
day0.setUTCHours(0, 0, 0, 0);
const dayStart = (back) => new Date(day0.getTime() - back * 864e5);
const jitter = (m = 0.0004) => (rnd() - 0.5) * m;

let passages = 0;
const rows = [];

/** One passage = a visit row + its arrival/end photo pair. */
async function passage({
  personId,
  contact,
  inAt,
  minutes,
  disposition = null,
  kind = 'd2d_knock',
  photoOffset = 0, // metres between arrival and end photo
  contactOffset = 0, // metres between the photos and the customer pin
  phash = null,
  syncedLateMin = 0,
}) {
  const outAt = new Date(inAt.getTime() + minutes * 60_000);
  const degPerM = 1 / 111_320;
  const baseLat = contact.lat + contactOffset * degPerM;
  const baseLng = contact.lng;

  const { data: visit, error } = await db
    .from('visits')
    .insert({
      client_uuid: crypto.randomUUID(),
      contact_id: contact.id,
      rep_id: personId,
      visit_type: kind,
      visited_at: outAt.toISOString(),
      started_at: inAt.toISOString(),
      created_at: new Date(outAt.getTime() + syncedLateMin * 60_000).toISOString(),
      lat: contact.lat,
      lng: contact.lng,
      disposition: kind === 'installation' ? null : disposition,
      notes: TAG,
    })
    .select('id')
    .single();
  if (error) throw error;

  await db.from('visit_photos').insert(
    ['arrival', 'completion'].map((k, i) => ({
      visit_id: visit.id,
      storage_path: `demo/journal-${visit.id}-${k}.jpg`,
      kind: k,
      lat: baseLat + jitter() + (i === 1 ? photoOffset * degPerM : 0),
      lng: baseLng + jitter(),
      accuracy: between(8, 20),
      captured_at: (i === 0 ? inAt : outAt).toISOString(),
      phash: phash ?? Math.random().toString(16).slice(2, 18),
      taken_at: (i === 0 ? inAt : outAt).toISOString(),
    })),
  );
  passages++;
  return visit.id;
}

// ---------- the week ----------
for (const rep of REPS) {
  const pool = await contactsFor(rep.id);
  if (pool.length === 0) continue;
  let ci = 0;
  for (let back = 0; back < DAYS; back++) {
    const d = dayStart(back);
    if (d.getUTCDay() === 0) continue; // Sunday off
    // Start between 07:45 and 08:40, then work through the day.
    let cursor = new Date(d.getTime() + (between(465, 520) * 60_000));
    const stops = between(4, 8);
    for (let s = 0; s < stops; s++) {
      const contact = pool[ci++ % pool.length];
      const disposition = pick(DISPOSITIONS);
      // Engaged calls take longer than a door that doesn't open.
      const engaged = ['interested', 'appointment_set', 'sold'].includes(disposition);
      const minutes = engaged ? between(14, 55) : between(3, 11);
      await passage({ personId: rep.id, contact, inAt: cursor, minutes, disposition });
      // Travel + a lunch break around midday.
      const noon = new Date(d.getTime() + 12 * 3600_000);
      const after = new Date(cursor.getTime() + minutes * 60_000);
      const gap = after < noon && new Date(after.getTime() + 30 * 60_000) > noon
        ? between(70, 100)
        : between(9, 35);
      cursor = new Date(after.getTime() + gap * 60_000);
      if (cursor.getUTCHours() >= 17) break;
    }
  }
  rows.push(`${rep.username}: visites`);
}

for (const tech of TECHS) {
  if (customers.length === 0) break;
  let ci = 0;
  for (let back = 0; back < DAYS; back++) {
    const d = dayStart(back);
    if (d.getUTCDay() === 0) continue;
    let cursor = new Date(d.getTime() + between(490, 540) * 60_000);
    const stops = between(2, 3);
    for (let s = 0; s < stops; s++) {
      const contact = customers[ci++ % customers.length];
      const minutes = between(45, 165);
      await passage({ personId: tech.id, contact, inAt: cursor, minutes, kind: 'installation' });
      cursor = new Date(cursor.getTime() + (minutes + between(25, 60)) * 60_000);
      if (cursor.getUTCHours() >= 17) break;
    }
  }
  rows.push(`${tech.username}: chantiers`);
}

// ---------- one of each anomaly, on the most recent day ----------
const today = dayStart(0);
const anomalyAt = (h, m) => new Date(today.getTime() + (h * 60 + m) * 60_000);

const kofiPool = await contactsFor(idOf('kofi'));
const fatouPool = await contactsFor(idOf('fatou'));
const awaPool = await contactsFor(idOf('awa'));
const yaoPool = await contactsFor(idOf('yao'));

// 1. engaged visit closed in 2 minutes
if (kofiPool.length)
  await passage({
    personId: idOf('kofi'),
    contact: kofiPool[7 % kofiPool.length],
    inAt: anomalyAt(15, 40),
    minutes: 2,
    disposition: 'sold',
  });
// 2. end photo 420 m from the arrival photo
if (fatouPool.length)
  await passage({
    personId: idOf('fatou'),
    contact: fatouPool[5 % fatouPool.length],
    inAt: anomalyAt(15, 10),
    minutes: 18,
    disposition: 'interested',
    photoOffset: 420,
  });
// 3. photos 600 m away from the customer's pin
if (awaPool.length)
  await passage({
    personId: idOf('awa'),
    contact: awaPool[3 % awaPool.length],
    inAt: anomalyAt(16, 5),
    minutes: 22,
    disposition: 'appointment_set',
    contactOffset: 600,
  });
// 4. the same image on two different visits
if (yaoPool.length >= 2) {
  const reused = 'a1b2c3d4e5f60718';
  await passage({
    personId: idOf('yao'),
    contact: yaoPool[1],
    inAt: anomalyAt(14, 20),
    minutes: 16,
    disposition: 'interested',
    phash: reused,
  });
  await passage({
    personId: idOf('yao'),
    contact: yaoPool[2 % yaoPool.length],
    inAt: anomalyAt(15, 30),
    minutes: 12,
    disposition: 'interested',
    phash: reused,
  });
}
// 5. a trip that reached the server 45 min late (offline sync)
if (customers.length)
  await passage({
    personId: idOf('aicha'),
    contact: customers[3 % customers.length],
    inAt: anomalyAt(13, 15),
    minutes: 75,
    kind: 'installation',
    syncedLateMin: 45,
  });
// 6. an installation marked done 6 minutes after it started
if (customers.length) {
  const c = customers[5 % customers.length];
  const started = anomalyAt(11, 30);
  await db.from('installations').insert({
    contact_id: c.id,
    installer_id: idOf('moussa'),
    title: 'Pose express (démo)',
    status: 'done',
    scheduled_date: today.toISOString().slice(0, 10),
    started_at: started.toISOString(),
    completed_at: new Date(started.getTime() + 6 * 60_000).toISOString(),
    created_by: idOf('moussa'),
    notes: TAG,
  });
}

console.log(`created ${passages} paired passages over ${DAYS} days`);
console.log(rows.join(' · '));
console.log('anomalies planted: tooShort, pairFar, farFromContact, duplicates, clockDrift, fastInstall');

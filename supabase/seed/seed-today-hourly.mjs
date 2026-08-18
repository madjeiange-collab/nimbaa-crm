/**
 * A day shaped to exercise "Journée en cours".
 *
 * The matrix only proves itself against hours that are genuinely mixed, so this
 * plants the cases a random generator rarely produces:
 *   · an hour with a sale, a refusal and a no-answer together
 *   · an hour where everything sold, next to one where nothing did
 *   · a wall of refusals in a short hour — a wall, not a slow patch
 *   · a busy hour (6 passages) to see the fill hold up when slices get thin
 *   · one long negotiation alone in its hour
 *   · technicians on one site for over an hour, one finishing, one parking
 *   · somebody who never started, and somebody who went quiet at midday
 *
 * Everything is stamped [hourly-demo] in the notes, so:
 *   node supabase/seed/seed-today-hourly.mjs --purge
 * removes exactly this and nothing else.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const TAG = '[hourly-demo]';
const purgeOnly = process.argv.includes('--purge');

const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

// ---------------------------------------------------------------- purge -----
const { data: mine } = await db.from('visits').select('id').eq('notes', TAG);
const ids = (mine ?? []).map((v) => v.id);
if (ids.length) {
  const { data: ph } = await db.from('visit_photos').select('storage_path').in('visit_id', ids);
  const paths = (ph ?? []).map((p) => p.storage_path).filter((p) => !p.startsWith('demo/'));
  if (paths.length) await db.storage.from('visit-photos').remove(paths);
  await db.from('visit_photos').delete().in('visit_id', ids);
  await db.from('visits').delete().in('id', ids);
}
console.log(`purged ${ids.length} previous ${TAG} passages`);
if (purgeOnly) process.exit(0);

// ---------------------------------------------------------------- people ----
const { data: users } = await db
  .from('users')
  .select('id, username, full_name, role')
  .eq('is_active', true);
const by = (u) => (users ?? []).find((x) => x.username === u);
const kofi = by('kofi');
const fatou = by('fatou');
const yao = by('yao');
const moussa = by('moussa');
const aicha = by('aicha');
if (!kofi || !fatou || !yao || !moussa || !aicha) {
  console.error('expected demo users kofi, fatou, yao, moussa, aicha');
  process.exit(1);
}
// awa is left with nothing on purpose — she is the "never started" case.

const { data: contacts } = await db
  .from('contacts')
  .select('id, name, lat, lng')
  .not('lat', 'is', null)
  .limit(60);
if (!contacts || contacts.length < 20) {
  console.error('need at least 20 contacts with coordinates');
  process.exit(1);
}
let ci = 0;
const nextContact = () => contacts[ci++ % contacts.length];

const { data: jobs } = await db
  .from('installations')
  .select('id, contact_id, contacts(name, lat, lng)')
  .limit(20);

// ---------------------------------------------------------------- helpers ---
/** Midnight in Abidjan (= UTC), so "8h" here is 8h there. */
const midnight = new Date();
midnight.setUTCHours(0, 0, 0, 0);
const at = (h, m = 0) => new Date(midnight.getTime() + (h * 60 + m) * 60_000);
const jitter = () => (Math.random() - 0.5) * 0.0004;

const visits = [];
const photos = [];

function passage({ person, contact, h, m, minutes, disposition = null, installStatus = null, installId = null }) {
  const inAt = at(h, m);
  const outAt = new Date(inAt.getTime() + minutes * 60_000);
  const id = crypto.randomUUID();
  visits.push({
    id,
    client_uuid: crypto.randomUUID(),
    contact_id: contact.id,
    rep_id: person.id,
    visit_type: installId ? 'installation' : 'd2d_knock',
    visited_at: outAt.toISOString(),
    started_at: inAt.toISOString(),
    created_at: outAt.toISOString(),
    lat: contact.lat,
    lng: contact.lng,
    disposition: installId ? null : disposition,
    install_status: installStatus,
    installation_id: installId,
    notes: TAG,
  });
  for (const kind of ['arrival', 'completion']) {
    photos.push({
      visit_id: id,
      storage_path: `demo/hourly-${id}-${kind}.jpg`,
      kind,
      lat: contact.lat + jitter(),
      lng: contact.lng + jitter(),
      accuracy: 12,
      captured_at: (kind === 'arrival' ? inAt : outAt).toISOString(),
      taken_at: (kind === 'arrival' ? inAt : outAt).toISOString(),
    });
  }
}

const V = (p, h, m, minutes, disposition) =>
  passage({ person: p, contact: nextContact(), h, m, minutes, disposition });

// -------------------------------------------------------------- the day -----
// Kofi — the mixed hours. 9h carries a sale, a refusal and a no-answer.
V(kofi, 7, 20, 9, 'no_answer');
V(kofi, 8, 5, 26, 'interested');
V(kofi, 8, 40, 14, 'refused');
V(kofi, 9, 10, 31, 'sold');
V(kofi, 9, 48, 6, 'refused');
V(kofi, 9, 58, 4, 'not_home');
V(kofi, 11, 5, 22, 'appointment_set');
V(kofi, 11, 35, 18, 'interested');
V(kofi, 14, 10, 47, 'sold'); // one long negotiation, alone in its hour
V(kofi, 16, 20, 12, 'no_answer');

// Fatou — the busy hour, then a wall of refusals, then a perfect one.
for (const [m, mins, d] of [
  [2, 7, 'not_home'],
  [12, 9, 'interested'],
  [24, 6, 'no_answer'],
  [33, 11, 'interested'],
  [47, 5, 'refused'],
  [54, 4, 'no_answer'],
]) V(fatou, 8, m, mins, d);
V(fatou, 10, 5, 4, 'refused');
V(fatou, 10, 15, 3, 'refused');
V(fatou, 10, 25, 5, 'refused'); // 12 min of wall
V(fatou, 12, 10, 29, 'sold');
V(fatou, 12, 45, 24, 'sold'); // an hour where everything sold
V(fatou, 15, 30, 19, 'appointment_set');

// Yao — thin morning, then silent from midday: the "silencieux" case.
V(yao, 8, 15, 8, 'no_answer');
V(yao, 9, 5, 21, 'interested');
V(yao, 9, 40, 13, 'refused');
V(yao, 11, 50, 16, 'appointment_set');

// Technicians — long stays on few sites, one finishing, one parking a return.
const jobA = (jobs ?? [])[0];
const jobB = (jobs ?? [])[1];
const siteOf = (j, fallback) =>
  j?.contacts?.lat != null ? { id: j.contact_id, lat: j.contacts.lat, lng: j.contacts.lng } : fallback;

if (jobA) {
  const s = siteOf(jobA, nextContact());
  passage({ person: moussa, contact: s, h: 8, m: 10, minutes: 68, installStatus: 'in_progress', installId: jobA.id });
  passage({ person: moussa, contact: s, h: 10, m: 5, minutes: 74, installStatus: 'done', installId: jobA.id });
}
if (jobB) {
  const s = siteOf(jobB, nextContact());
  passage({ person: aicha, contact: s, h: 9, m: 20, minutes: 82, installStatus: 'in_progress', installId: jobB.id });
  passage({ person: aicha, contact: s, h: 13, m: 15, minutes: 55, installStatus: 'needs_revisit', installId: jobB.id });
}

// -------------------------------------------------------------- insert ------
// install_status / installation_id are 0026; fall back if this DB predates it.
let { error } = await db.from('visits').insert(visits);
if (error && /install_status|installation_id/.test(error.message)) {
  console.log('pre-0026 database — inserting without the trip columns');
  ({ error } = await db.from('visits').insert(
    visits.map(({ install_status, installation_id, ...v }) => {
      void install_status;
      void installation_id;
      return v;
    }),
  ));
}
if (error) {
  console.error('visits:', error.message);
  process.exit(1);
}

let { error: pErr } = await db.from('visit_photos').insert(photos);
if (pErr && /accuracy|captured_at|phash|kind/.test(pErr.message)) {
  ({ error: pErr } = await db.from('visit_photos').insert(
    photos.map((p) => ({ visit_id: p.visit_id, storage_path: p.storage_path, taken_at: p.taken_at })),
  ));
}
if (pErr) console.error('photos:', pErr.message);

console.log(`\ninserted ${visits.length} passages and ${photos.length} photos, all tagged ${TAG}`);
console.log('  Kofi   10 passages · 9h mixes a sale, a refusal and a no-answer');
console.log('  Fatou  12 passages · 8h busy (6), 10h three refusals in 12 min, 12h all sold');
console.log('  Yao     4 passages · nothing after 12h06 → silencieux');
console.log('  Moussa  2 trips on one site · 68 then 74 min, finishing it');
console.log('  Aïcha   2 trips on one site · 82 then 55 min, left needing a return');
console.log('  Awa     nothing at all → "rien enregistré ce matin"');

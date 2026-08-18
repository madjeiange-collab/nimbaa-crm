/**
 * Check-In / Check-Out demo day — RE-RUNNABLE.
 * Creates one realistic day of paired visits (arrival + end photo metadata,
 * true durations, a lunch gap) for demo rep `kofi`, so the journal on
 * /dashboard/controls has something to show before the team starts logging.
 *
 * Run:    node supabase/seed/seed-checkin-demo.mjs
 * Remove: node supabase/seed/seed-checkin-demo.mjs --purge
 *
 * NOTE: photo rows point at placeholder storage paths, so the journal shows
 * the dashed check-in/check-out icons instead of thumbnails. Real visits
 * logged from the app carry real photos.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

const TAG = '[journal-demo]';
const purgeOnly = process.argv.includes('--purge');

// ---------- purge previous run ----------
const { data: old } = await db.from('visits').select('id').eq('notes', TAG);
const oldIds = (old ?? []).map((r) => r.id);
if (oldIds.length > 0) {
  await db.from('visit_photos').delete().in('visit_id', oldIds);
  await db.from('visits').delete().in('id', oldIds);
}
console.log(`purged ${oldIds.length} previous demo passages`);
if (purgeOnly) process.exit(0);

// ---------- lookups ----------
const { data: rep } = await db.from('users').select('id').eq('username', 'kofi').single();
if (!rep) throw new Error('demo rep "kofi" not found — run seed-demo-board.mjs first');
const { data: contacts } = await db
  .from('contacts')
  .select('id, lat, lng')
  .eq('assigned_rep_id', rep.id)
  .not('lat', 'is', null)
  .limit(6);
if ((contacts ?? []).length < 6) throw new Error('not enough geolocated contacts for kofi');

// ---------- one day on the field ----------
const day = new Date();
day.setUTCHours(0, 0, 0, 0); // Abidjan = UTC
const at = (h, m) => new Date(day.getTime() + (h * 60 + m) * 60_000);

// [hour, minute, minutes on site, disposition]
const PLAN = [
  [8, 12, 19, 'interested'],
  [8, 47, 6, 'no_answer'],
  [9, 20, 34, 'appointment_set'],
  [10, 15, 8, 'refused'],
  [11, 5, 52, 'sold'],
  [14, 30, 12, 'not_home'], // after the lunch break
];

for (let i = 0; i < PLAN.length; i++) {
  const [h, m, dur, disposition] = PLAN[i];
  const c = contacts[i];
  const inAt = at(h, m);
  const outAt = new Date(inAt.getTime() + dur * 60_000);
  const jitter = () => (Math.random() - 0.5) * 0.0004; // ≈ 20 m, as a real GPS fix drifts

  const { data: visit, error } = await db
    .from('visits')
    .insert({
      client_uuid: crypto.randomUUID(),
      contact_id: c.id,
      rep_id: rep.id,
      visit_type: 'd2d_knock',
      visited_at: outAt.toISOString(),
      started_at: inAt.toISOString(),
      created_at: outAt.toISOString(), // saved on the spot → no clock-drift flag
      lat: c.lat,
      lng: c.lng,
      disposition,
      notes: TAG,
    })
    .select('id')
    .single();
  if (error) throw error;

  await db.from('visit_photos').insert(
    ['arrival', 'completion'].map((kind, k) => ({
      visit_id: visit.id,
      storage_path: `demo/journal-${visit.id}-${kind}.jpg`,
      kind,
      lat: c.lat + jitter(),
      lng: c.lng + jitter(),
      accuracy: 12 + k,
      captured_at: (k === 0 ? inAt : outAt).toISOString(),
      phash: Math.random().toString(16).slice(2, 18),
      taken_at: (k === 0 ? inAt : outAt).toISOString(),
    })),
  );
}

const onSite = PLAN.reduce((s, p) => s + p[2], 0);
const span = (at(...PLAN.at(-1).slice(0, 2)).getTime() + PLAN.at(-1)[2] * 60_000 - at(...PLAN[0].slice(0, 2)).getTime()) / 60_000;
console.log(
  `created ${PLAN.length} paired passages for kofi on ${day.toISOString().slice(0, 10)} — ` +
    `${onSite} min on site over ${Math.round(span)} min (${Math.round((onSite / span) * 100)} % client time)`,
);

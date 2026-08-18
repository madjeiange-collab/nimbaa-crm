/**
 * Go-live: empty the operational data, keep the configuration.
 *
 * Everything currently in the database is demo material — seeded contacts,
 * seeded visits, seeded chantiers and the commissions computed from them. Real
 * customers must not land on top of it, or every statistic, leaderboard,
 * commission total and morning brief is computed over fiction.
 *
 * DELETED   contacts, contact_people, deals, visits, visit_photos (rows AND
 *           the stored images), installations, tasks, subscriptions,
 *           commission_entries, activities, and the generated recaps.
 * KEPT      users, products, pipeline_stages, territories, protocol steps,
 *           app_settings — the configuration you set up deliberately.
 *
 * Dry run by default: it counts and prints, and changes nothing.
 *   node supabase/seed/purge-demo-data.mjs              # report only
 *   node supabase/seed/purge-demo-data.mjs --confirm    # actually delete
 *
 * Accounts are deliberately NOT touched here — deleting demo personas and
 * rotating passwords is a separate, human decision.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const CONFIRM = process.argv.includes('--confirm');
const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

/** Children before parents, so nothing is orphaned mid-way. */
const ORDER = [
  'visit_photos',
  'visits',
  'tasks',
  'commission_entries',
  'subscriptions',
  'installations',
  'activities',
  'contact_people',
  'deals',
  'contacts',
  'daily_recaps',
  'user_recaps',
  'manager_recaps',
  'ai_usage',
];

const KEPT = ['users', 'products', 'pipeline_stages', 'territories', 'install_protocol_steps', 'app_settings'];

async function countOf(table) {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
  return error ? null : count;
}

console.log(CONFIRM ? '=== PURGE (deleting) ===' : '=== DRY RUN — nothing will be deleted ===');
console.log();

// --- what would go -----------------------------------------------------------
let total = 0;
const present = [];
for (const t of ORDER) {
  const c = await countOf(t);
  if (c === null) {
    console.log(`  ${t.padEnd(20)} —  (no such table, skipped)`);
    continue;
  }
  present.push(t);
  total += c;
  console.log(`  ${t.padEnd(20)} ${String(c).padStart(6)} rows`);
}

// --- stored photos -----------------------------------------------------------
const { data: photoRows } = await db.from('visit_photos').select('storage_path');
const paths = [...new Set((photoRows ?? []).map((p) => p.storage_path).filter(Boolean))];
console.log(`\n  visit-photos bucket  ${String(paths.length).padStart(6)} stored images`);
console.log(`\n  TOTAL                ${String(total).padStart(6)} rows + ${paths.length} images`);

console.log('\nKEPT untouched:');
for (const t of KEPT) {
  const c = await countOf(t);
  if (c !== null) console.log(`  ${t.padEnd(20)} ${String(c).padStart(6)} rows`);
}

if (!CONFIRM) {
  console.log('\nNothing was deleted. Re-run with --confirm to carry it out.');
  process.exit(0);
}

// --- do it -------------------------------------------------------------------
console.log('\nDeleting stored images…');
for (let i = 0; i < paths.length; i += 100) {
  const batch = paths.slice(i, i + 100);
  const { error } = await db.storage.from('visit-photos').remove(batch);
  if (error) console.log(`  batch ${i}: ${error.message}`);
}
console.log(`  ${paths.length} images removed`);

console.log('\nDeleting rows…');
for (const t of present) {
  // A filter that matches everything — PostgREST refuses an unqualified delete.
  const { error } = await db.from(t).delete().not('id', 'is', null);
  const left = await countOf(t);
  console.log(`  ${t.padEnd(20)} ${error ? 'ERROR ' + error.message : `${left} rows left`}`);
}

console.log('\nDone. Verify the app shows an empty state before letting anyone in.');

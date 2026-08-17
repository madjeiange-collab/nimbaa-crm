/**
 * Full-table JSON export for backups. Runs in the weekly GitHub Action
 * (secrets SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) or locally with
 * .env.local. Writes one JSON file per table into ./backup/.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if ((!url || !key) && existsSync('.env.local')) {
  const env = readFileSync('.env.local', 'utf8');
  const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
  url = url || get('NEXT_PUBLIC_SUPABASE_URL');
  key = key || get('SUPABASE_SERVICE_ROLE_KEY');
}
if (!url) {
  console.error('::error::SUPABASE_URL env is missing.');
  process.exit(1);
}
if (!key) {
  console.error(
    '::error::SUPABASE_SERVICE_ROLE_KEY secret is missing or empty — add it under repo Settings → Secrets → Actions, then start a FRESH "Run workflow" (re-runs of old runs may not see new secrets).',
  );
  process.exit(1);
}
key = key.trim();

const admin = createClient(url, key);
const TABLES = [
  'users', 'territories', 'user_territories', 'contacts', 'contact_people',
  'visits', 'visit_photos', 'activities', 'deals', 'products',
  'installations', 'install_protocol_steps', 'pipeline_stages',
  'do_not_knock_list', 'app_settings', 'daily_recaps', 'manager_recaps',
  'user_recaps', 'ai_usage',
];
const PAGE = 1000;

mkdirSync('backup', { recursive: true });
const failures = [];
for (const table of TABLES) {
  const rows = [];
  let failed = false;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select('*').range(from, from + PAGE - 1);
    if (error) {
      console.error(`${table}: ${error.message}`);
      failed = true;
      break;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  if (failed) {
    failures.push(table);
    continue;
  }
  writeFileSync(`backup/${table}.json`, JSON.stringify(rows));
  console.log(`${table}: ${rows.length} rows`);
}
if (failures.length > 0) {
  console.error(`::error::Backup incomplete — failed tables: ${failures.join(', ')}`);
  process.exit(1); // a partial backup must never look green
}
console.log(`Backup complete: ${TABLES.length} tables exported.`);

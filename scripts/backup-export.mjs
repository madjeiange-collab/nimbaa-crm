/**
 * Full-table JSON export for backups — dependency-free (plain fetch against
 * the Supabase REST API). Runs in the weekly GitHub Action (secrets
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) or locally with .env.local.
 * Writes one JSON file per table into ./backup/.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

let url = process.env.SUPABASE_URL;
let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if ((!url || !key) && existsSync('.env.local')) {
  const env = readFileSync('.env.local', 'utf8');
  const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
  url = url || get('NEXT_PUBLIC_SUPABASE_URL');
  key = key || get('SUPABASE_SERVICE_ROLE_KEY');
}
// ::error:: on stdout → shows up as a GitHub annotation.
if (!url || !url.trim()) {
  console.log('::error::SUPABASE_URL env is missing.');
  process.exit(1);
}
if (!key || !key.trim()) {
  console.log(
    '::error::SUPABASE_SERVICE_ROLE_KEY secret is missing or empty — add it under repo Settings → Secrets → Actions.',
  );
  process.exit(1);
}
url = url.trim().replace(/\/$/, '');
key = key.trim();

const TABLES = [
  'users', 'territories', 'user_territories', 'contacts', 'contact_people',
  'visits', 'visit_photos', 'activities', 'deals', 'products',
  'installations', 'install_protocol_steps', 'pipeline_stages',
  'do_not_knock_list', 'app_settings', 'daily_recaps', 'manager_recaps',
  'user_recaps', 'ai_usage',
];
const PAGE = 1000;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

mkdirSync('backup', { recursive: true });
const failures = [];
for (const table of TABLES) {
  const rows = [];
  let failed = false;
  for (let offset = 0; ; offset += PAGE) {
    try {
      const res = await fetch(
        `${url}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${offset}`,
        { headers },
      );
      if (!res.ok) {
        console.log(`::error::${table}: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
        failed = true;
        break;
      }
      const data = await res.json();
      rows.push(...data);
      if (data.length < PAGE) break;
    } catch (e) {
      console.log(`::error::${table}: ${e.message}`);
      failed = true;
      break;
    }
  }
  if (failed) {
    failures.push(table);
    continue;
  }
  writeFileSync(`backup/${table}.json`, JSON.stringify(rows));
  console.log(`${table}: ${rows.length} rows`);
}
if (failures.length > 0) {
  console.log(`::error::Backup incomplete — failed tables: ${failures.join(', ')}`);
  process.exit(1); // a partial backup must never look green
}
console.log(`Backup complete: ${TABLES.length} tables exported.`);

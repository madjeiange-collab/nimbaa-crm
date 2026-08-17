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
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');

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
for (const table of TABLES) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select('*').range(from, from + PAGE - 1);
    if (error) {
      console.error(`${table}: ${error.message}`);
      break;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  writeFileSync(`backup/${table}.json`, JSON.stringify(rows));
  console.log(`${table}: ${rows.length} rows`);
}

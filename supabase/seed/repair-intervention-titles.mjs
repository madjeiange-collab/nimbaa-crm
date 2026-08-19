/**
 * Repair job titles that were written as an unresolved i18n key.
 *
 * The intervention form asked the 'installation' namespace for a label that
 * lives in 'intervention', so next-intl handed back the key path itself and it
 * was stored on the job: "installation.origin_maintenance" appeared as the
 * title in À installer. The form is fixed; these are the rows it already wrote.
 *
 *   node supabase/seed/repair-intervention-titles.mjs          # dry run
 *   node supabase/seed/repair-intervention-titles.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync('.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim();
const db = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'));

// The French labels the form shows on its own buttons.
const LABEL = {
  service: 'SAV',
  warranty: 'Garantie',
  maintenance: 'Entretien',
};

const apply = process.argv.includes('--apply');

const { data: bad } = await db
  .from('installations')
  .select('id, title, origin, contact_id')
  .like('title', 'installation.origin_%');

if (!bad?.length) {
  console.log('rien à réparer.');
  process.exit(0);
}

console.log(`${bad.length} chantier(s) à corriger :\n`);
for (const j of bad) {
  // Trust the origin column, not the broken title: it is the field the form
  // actually meant to record.
  const to = LABEL[j.origin] ?? null;
  console.log(`  ${j.title.padEnd(34)} → ${to ?? '(vide)'}   [origin ${j.origin}]`);
  if (apply) await db.from('installations').update({ title: to }).eq('id', j.id);
}

console.log(apply ? '\ncorrigés.' : '\nessai à blanc — relancer avec --apply pour écrire.');

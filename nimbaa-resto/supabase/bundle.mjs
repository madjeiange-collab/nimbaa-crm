/**
 * Rassemble les migrations en un seul fichier, dans l'ordre, pour le SQL
 * Editor de Supabase.
 *
 *   node supabase/bundle.mjs          engendre supabase/schema.sql
 *   node supabase/bundle.mjs --check  échoue s'il n'est plus à jour (CI)
 *
 * Cinq collages dans un éditeur web, c'est cinq occasions de se tromper
 * d'ordre ou de n'en coller que la moitié. Un seul, il n'y en a plus.
 *
 * Le fichier est VERSIONNÉ, alors qu'un fichier engendré ne devrait pas
 * l'être : mettre en service une base ne doit pas exiger d'avoir Node et pnpm
 * installés d'abord. On ouvre schema.sql sur GitHub, on copie, on colle. Le
 * risque du doublon — dériver de sa source — est tenu par --check en
 * intégration continue : modifier une migration sans réengendrer fait rougir
 * la CI, ce qui est exactement la protection qu'on aurait perdue.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

if (files.length === 0) {
  console.error('❌ Aucune migration trouvée dans supabase/migrations.');
  process.exit(1);
}

const parts = [
  '-- Nimbaa — schéma complet, engendré par supabase/bundle.mjs.',
  '-- NE PAS MODIFIER ICI : modifiez la migration, puis « pnpm db:bundle ».',
  `-- ${files.length} migrations : ${files.join(', ')}`,
  '--',
  '-- À coller dans Supabase → SQL Editor → New query → Run.',
  '',
  '-- Une transaction : ou tout est appliqué, ou rien. Si le SQL Editor ouvre',
  '-- déjà la sienne, un avertissement « there is already a transaction in',
  '-- progress » apparaît — sans conséquence, la garantie tient quand même.',
  'begin;',
  '',
];
for (const f of files) {
  parts.push(`-- ${'='.repeat(70)}`, `-- ${f}`, `-- ${'='.repeat(70)}`, '');
  parts.push(readFileSync(join(dir, f), 'utf8').trimEnd(), '');
}
parts.push('commit;', '');

const out = join(here, 'schema.sql');
const built = parts.join('\n');

if (process.argv.includes('--check')) {
  let current = null;
  try { current = readFileSync(out, 'utf8'); } catch { /* absent */ }
  if (current === built) {
    console.log(`✅ supabase/schema.sql est à jour (${files.length} migrations).`);
    process.exit(0);
  }
  console.error('❌ supabase/schema.sql ne correspond plus aux migrations.');
  console.error('   Lancez « pnpm db:bundle » et committez le résultat.');
  process.exit(1);
}

writeFileSync(out, built);
console.log(`✅ ${files.length} migrations rassemblées → supabase/schema.sql (${built.split('\n').length} lignes)`);
console.log('   Committez-le : c\'est ce fichier qu\'on colle dans le SQL Editor.');

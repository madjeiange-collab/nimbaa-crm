/**
 * Rassemble les migrations en un seul fichier, dans l'ordre, pour le SQL
 * Editor de Supabase.
 *
 *   node supabase/bundle.mjs
 *
 * Pourquoi un fichier engendré plutôt qu'un fichier versionné : un doublon
 * versionné dérive. Celui-ci est produit à la demande depuis les migrations
 * elles-mêmes, donc il ne peut pas être en retard sur elles.
 *
 * Cinq collages dans un éditeur web, c'est cinq occasions de se tromper
 * d'ordre ou de n'en coller que la moitié. Un seul, il n'y en a plus.
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
  '-- Ne pas modifier ici : modifier la migration, puis réengendrer.',
  `-- ${files.length} migrations : ${files.join(', ')}`,
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
// Une transaction, donc : ou tout est appliqué, ou rien ne l'est. Un schéma à
// moitié appliqué est le pire des trois états — l'application démarre et
// échoue plus tard, loin de la cause.
parts.push('commit;', '');

const out = join(here, '.bundle.sql');
writeFileSync(out, parts.join('\n'));

const lines = parts.join('\n').split('\n').length;
console.log(`✅ ${files.length} migrations rassemblées → supabase/.bundle.sql (${lines} lignes)`);
console.log('   Ouvrez ce fichier, copiez tout, collez dans Supabase → SQL Editor → Run.');

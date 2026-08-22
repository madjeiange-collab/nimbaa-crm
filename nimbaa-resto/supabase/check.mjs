/**
 * Vérifie qu'un projet Supabase est correctement câblé, avant de perdre une
 * heure à chercher pourquoi l'application ne montre rien.
 *
 *   node supabase/check.mjs
 *
 * Chaque échec dit quoi faire. Les trois pannes de configuration coûteuses —
 * un schéma non exposé, une migration à moitié appliquée, un seau de stockage
 * absent — donnent toutes le même symptôme dans le navigateur (une page vide),
 * et aucune ne se distingue des deux autres sans demander au serveur.
 */
import { readFileSync } from 'node:fs';

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* on s'appuie sur l'environnement */ }
}
loadEnv();

const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const rows = [];
const say = (ok, label, detail = '', fix = '') =>
  rows.push({ ok, label, detail, fix });

if (!URL_ || !ANON) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requis.');
  console.error('   Copiez .env.local.example vers .env.local et renseignez les clés.');
  process.exit(1);
}

const rest = async (path, { schema, key = ANON, method = 'GET', body } = {}) => {
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  if (schema) headers[method === 'GET' ? 'accept-profile' : 'content-profile'] = schema;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(`${URL_}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text };
};

// ------------------------------------------------------------- joignable
try {
  const r = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: ANON } });
  say(r.status < 500, 'le projet répond', `HTTP ${r.status}`,
      'Vérifiez NEXT_PUBLIC_SUPABASE_URL (elle finit par .supabase.co, sans /rest).');
} catch (e) {
  say(false, 'le projet répond', e.message, 'URL injoignable : vérifiez NEXT_PUBLIC_SUPABASE_URL.');
}

// --------------------------------------------------- schéma core exposé
const cur = await rest('/rest/v1/currencies?select=code,decimals&limit=100', { schema: 'core' });
const xof = cur.json?.find?.((c) => c.code === 'XOF');
say(cur.status === 200 && !!xof,
    'schéma « core » exposé, migration 0001 appliquée',
    cur.status === 200 ? `${cur.json?.length ?? 0} monnaies, XOF à ${xof?.decimals} décimale(s)`
                       : `HTTP ${cur.status} — ${cur.json?.message ?? cur.text.slice(0, 80)}`,
    'Project Settings → API → Exposed schemas : ajoutez « core » et « resto ». '
    + 'Si le schéma est exposé, c\'est la migration 0001 qui manque.');

// -------------------------------------------------- schéma resto exposé
const res = await rest('/rest/v1/restaurants?select=id&limit=1', { schema: 'resto' });
say(res.status === 200,
    'schéma « resto » exposé, migration 0002 appliquée',
    res.status === 200 ? 'lisible' : `HTTP ${res.status} — ${res.json?.message ?? res.text.slice(0, 80)}`,
    'Project Settings → API → Exposed schemas : ajoutez « resto ».');

// RLS : un visiteur sans compte ne doit voir AUCUN restaurant. Une liste non
// vide ici ne serait pas un détail — ce serait la base grande ouverte.
if (res.status === 200) {
  say(Array.isArray(res.json) && res.json.length === 0,
      'RLS active : un visiteur anonyme ne voit rien',
      `${res.json?.length ?? '?'} ligne(s) rendue(s) à la clé anon`,
      'ALARME : les policies ne sont pas en place. Réappliquez le schéma complet.');
}

// ------------------------------------------------- migrations 0003–0005
const checks = [
  ['0003 — carte et salle', '/rest/v1/menu_items?select=id,price,prep_station_id&limit=1'],
  ['0004 — photo des plats', '/rest/v1/menu_items?select=photo_path&limit=1'],
  ['0005 — ordre et photo des catégories', '/rest/v1/menu_categories?select=sort,active,photo_path&limit=1'],
];
for (const [label, path] of checks) {
  const r = await rest(path, { schema: 'resto' });
  say(r.status === 200, `migration ${label}`,
      r.status === 200 ? 'colonnes présentes' : `HTTP ${r.status} — ${r.json?.message ?? ''}`,
      'Réappliquez le schéma complet : node supabase/bundle.mjs, puis collez supabase/.bundle.sql.');
}

// L'ordre de la carte passe par une fonction, pas par des UPDATE : si elle
// manque, les flèches ne feront rien et rien ne le dira.
const rpc = await rest('/rest/v1/rpc/move_category', {
  schema: 'resto', method: 'POST',
  body: { p_id: '00000000-0000-0000-0000-000000000000', p_dir: 1 },
});
const missing = rpc.status === 404 || /PGRST202|Could not find the function/i.test(rpc.text);
say(!missing, 'fonction resto.move_category en place',
    missing ? 'introuvable' : 'présente (elle refuse un identifiant inconnu, c\'est attendu)',
    'Migration 0005 non appliquée.');

// ------------------------------------------------------------ stockage
if (SERVICE) {
  const b = await fetch(`${URL_}/storage/v1/bucket/menu`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  });
  const bj = await b.json().catch(() => null);
  say(b.status === 200 && bj?.public === true,
      'seau de stockage « menu », public en lecture',
      b.status === 200 ? `public=${bj?.public}, limite=${Math.round((bj?.file_size_limit ?? 0) / 1024)} Ko`
                       : `HTTP ${b.status}`,
      'Migration 0004 non appliquée, ou appliquée sur un Postgres sans schéma storage.');
} else {
  say(true, 'seau de stockage — non vérifié',
      'SUPABASE_SERVICE_ROLE_KEY absente de .env.local',
      '');
}

// ---------------------------------------------------------- le domaine
say(true, 'domaine des comptes personnel',
    process.env.STAFF_EMAIL_DOMAIN ?? 'staff.nimbaa.app (défaut)',
    '');

// ---------------------------------------------------------------- sortie
const pad = Math.max(...rows.map((r) => r.label.length));
console.log('');
for (const r of rows) {
  console.log(`${r.ok ? '  ✅' : '  ❌'} ${r.label.padEnd(pad)}  ${r.detail}`);
  if (!r.ok && r.fix) console.log(`      → ${r.fix}`);
}
const bad = rows.filter((r) => !r.ok).length;
console.log('');
console.log(bad === 0
  ? '✅ Projet Supabase prêt. Créez maintenant votre premier restaurant :\n'
    + '   pnpm db:bootstrap -- --org "…" --slug … --resto "…" --user … --password "…"'
  : `❌ ${bad} point(s) à corriger avant de continuer.`);
process.exit(bad === 0 ? 0 : 1);

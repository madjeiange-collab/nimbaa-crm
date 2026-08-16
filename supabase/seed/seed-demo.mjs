/**
 * Données de simulation : 5 secteurs d'Abidjan + portefeuille de produits.
 * Idempotent — les secteurs/produits déjà présents (même nom) sont ignorés.
 * Les secteurs créés sont assignés à l'admin pour que « Mon secteur » et le
 * contrôle hors-zone fonctionnent tout de suite.
 *
 *   node supabase/seed/seed-demo.mjs [username]   (défaut : admin)
 *
 * Nécessite dans .env.local :
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// --- Charge .env.local sans dépendance externe ---------------------------
function loadEnv() {
  try {
    const raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // .env.local absent — on s'appuie sur l'environnement.
  }
}
loadEnv();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.');
  process.exit(1);
}
const db = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } });

// --- Secteurs (rectangles approximatifs, WKT lng lat) ---------------------
// Sud = Treichville/Marcory/Koumassi/Port-Bouët · Nord = Abobo/Anyama
// Est = Cocody/Bingerville · Ouest = Yopougon/Attécoubé · Grand = tout Abidjan
const rect = (w, s, e, n) =>
  `SRID=4326;POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;

const TERRITORIES = [
  {
    name: 'Abidjan Sud',
    type: 'mixed',
    polygon: rect(-4.07, 5.21, -3.88, 5.305),
    description: 'Treichville, Marcory, Koumassi, Port-Bouët',
  },
  {
    name: 'Abidjan Nord',
    type: 'mixed',
    polygon: rect(-4.12, 5.36, -3.96, 5.52),
    description: 'Abobo, Anyama',
  },
  {
    name: 'Abidjan Est',
    type: 'mixed',
    polygon: rect(-3.99, 5.29, -3.78, 5.42),
    description: 'Cocody, Bingerville',
  },
  {
    name: 'Abidjan Ouest',
    type: 'mixed',
    polygon: rect(-4.2, 5.27, -4.03, 5.43),
    description: 'Yopougon, Attécoubé',
  },
  {
    name: 'Grand Abidjan',
    type: 'mixed',
    polygon: rect(-4.26, 5.14, -3.72, 5.56),
    description: 'Toute la ville — Abidjan et environs',
  },
];

// --- Produits de démonstration (prix FCFA + % commission) ------------------
const PRODUCTS = [
  { name: 'Kit Solaire Basic', price_xof: 150_000, commission_pct: 5, sort_order: 1 },
  { name: 'Kit Solaire Premium', price_xof: 350_000, commission_pct: 7, sort_order: 2 },
  { name: 'Climatiseur Split 1.5CV', price_xof: 450_000, commission_pct: 6, sort_order: 3 },
  { name: 'Caméra de surveillance', price_xof: 200_000, commission_pct: 8, sort_order: 4 },
  { name: 'Abonnement Internet Fibre', price_xof: 25_000, commission_pct: 10, sort_order: 5 },
  { name: 'Contrat de maintenance annuel', price_xof: 100_000, commission_pct: 4, sort_order: 6 },
];

async function main() {
  const username = process.argv[2] ?? 'admin';

  // Utilisateur cible pour l'assignation des secteurs.
  const { data: user, error: userErr } = await db
    .from('users')
    .select('id, username, role')
    .eq('username', username)
    .single();
  if (userErr || !user) {
    console.error(`Utilisateur "${username}" introuvable :`, userErr?.message);
    process.exit(1);
  }

  // --- Secteurs -----------------------------------------------------------
  const { data: existingTerrs, error: terrReadErr } = await db
    .from('territories')
    .select('id, name');
  if (terrReadErr) {
    console.error('Lecture des secteurs impossible :', terrReadErr.message);
    process.exit(1);
  }
  const byName = new Map(existingTerrs.map((t) => [t.name, t.id]));

  for (const t of TERRITORIES) {
    if (byName.has(t.name)) {
      // Déjà présent — on complète juste la description (colonne 0010).
      const { error } = await db
        .from('territories')
        .update({ description: t.description })
        .eq('id', byName.get(t.name));
      console.log(
        error
          ? `= Secteur ${t.name} : description non mise à jour (${error.message})`
          : `= Secteur déjà présent : ${t.name} (description à jour)`,
      );
      continue;
    }
    const { data, error } = await db
      .from('territories')
      .insert({ name: t.name, type: t.type, polygon: t.polygon, description: t.description })
      .select('id')
      .single();
    if (error) {
      console.error(`✗ Secteur ${t.name} :`, error.message);
      continue;
    }
    byName.set(t.name, data.id);
    console.log(`+ Secteur créé : ${t.name}`);
  }

  // Assignation à l'utilisateur (upsert sur la clé composite → idempotent).
  const links = TERRITORIES.filter((t) => byName.has(t.name)).map((t) => ({
    user_id: user.id,
    territory_id: byName.get(t.name),
  }));
  const { error: linkErr } = await db
    .from('user_territories')
    .upsert(links, { onConflict: 'user_id,territory_id' });
  if (linkErr) console.error('✗ Assignation :', linkErr.message);
  else console.log(`→ ${links.length} secteurs assignés à ${user.username}`);

  // --- Produits -----------------------------------------------------------
  const { data: existingProds, error: prodReadErr } = await db
    .from('products')
    .select('name');
  if (prodReadErr) {
    console.error('Lecture des produits impossible :', prodReadErr.message);
    process.exit(1);
  }
  const prodNames = new Set(existingProds.map((p) => p.name));

  for (const p of PRODUCTS) {
    if (prodNames.has(p.name)) {
      console.log(`= Produit déjà présent : ${p.name}`);
      continue;
    }
    const { error } = await db.from('products').insert(p);
    if (error) console.error(`✗ Produit ${p.name} :`, error.message);
    else console.log(`+ Produit créé : ${p.name} (${p.price_xof.toLocaleString('fr-FR')} FCFA, ${p.commission_pct}%)`);
  }

  console.log('Terminé.');
}

main();

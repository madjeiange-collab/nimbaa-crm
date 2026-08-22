/**
 * Crée une organisation, son abonnement Resto, son premier restaurant et son
 * patron. À exécuter une fois par client, après avoir appliqué les migrations.
 *
 *   node supabase/seed/bootstrap-owner.mjs \
 *     --org "Le Bambou SARL" --slug le-bambou --resto "Le Bambou Plateau" \
 *     --user fatou --password "MotDePasseFort" [--name "Fatou Camara"] \
 *     [--currency XOF] [--country CI]
 *
 *   node supabase/seed/bootstrap-owner.mjs --slug le-bambou --reset \
 *     --user fatou --password "NouveauMotDePasse"
 *
 * La console plateforme (invitations, TOTP, facturation) arrive plus tard ;
 * pour les premiers clients ce script EST l'amorçage, et --reset est aussi
 * l'histoire de récupération.
 *
 * Nécessite dans .env.local : NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, STAFF_EMAIL_DOMAIN (optionnel).
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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
const DOMAIN = process.env.STAFF_EMAIL_DOMAIN ?? 'staff.nimbaa.app';
if (!URL_ || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  process.exit(1);
}

// --- arguments ------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const slug     = flag('slug');
const username = flag('user');
const password = flag('password');
const reset    = has('reset');
const orgName  = flag('org');
const restoName= flag('resto');
const display  = flag('name');
const currency = flag('currency') ?? 'XOF';
const country  = flag('country')  ?? 'CI';

const usage = () => {
  console.error(
    'Usage :\n' +
    '  bootstrap-owner.mjs --org "<Organisation>" --slug <slug> --resto "<Restaurant>" \\\n' +
    '                      --user <identifiant> --password "<mot de passe>" [--name "<Nom>"] \\\n' +
    '                      [--currency XOF] [--country CI]\n' +
    '  bootstrap-owner.mjs --slug <slug> --reset --user <identifiant> --password "<nouveau>"',
  );
  process.exit(1);
};
if (!slug || !username || !password) usage();
if (!reset && (!orgName || !restoName)) usage();
if (password.length < 8) {
  console.error('❌ Mot de passe : 8 caractères au minimum.');
  process.exit(1);
}

const db = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const core  = () => db.schema('core');
const resto = () => db.schema('resto');
const email = `${username.toLowerCase()}@${slug.toLowerCase()}.${DOMAIN}`;

const fail = (label, error) => {
  console.error(`❌ ${label} :`, error?.message ?? error);
  process.exit(1);
};

async function findUser() {
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) fail('Lecture des comptes', error);
  return data.users.find((u) => u.email === email) ?? null;
}

// --- réinitialisation -----------------------------------------------------
if (reset) {
  const user = await findUser();
  if (!user) fail('Réinitialisation', new Error(`Aucun compte ${email}.`));
  const { error } = await db.auth.admin.updateUserById(user.id, { password });
  if (error) fail('Réinitialisation', error);
  const { error: flagErr } = await resto()
    .from('staff_accounts').update({ must_change_password: true }).eq('user_id', user.id);
  if (flagErr) fail('Marquage du compte', flagErr);
  console.log(`✅ Mot de passe réinitialisé pour « ${username} ».`);
  console.log('   Il devra en choisir un autre à la prochaine connexion.');
  process.exit(0);
}

// --- organisation ---------------------------------------------------------
let { data: org } = await core()
  .from('organizations').select('id, name, currency').eq('slug', slug).maybeSingle();
if (!org) {
  const { data, error } = await core().from('organizations')
    .insert({ slug, name: orgName, country, currency })
    .select('id, name, currency').single();
  if (error) fail("Création de l'organisation", error);
  org = data;
  console.log(`· Organisation « ${org.name} » créée (${org.currency}).`);
} else {
  console.log(`· Organisation « ${org.name} » déjà présente.`);
}

// --- abonnement Resto -----------------------------------------------------
// Posé à la main : la facturation arrivera écrire dans cette même table.
const { data: sub } = await core()
  .from('product_subscriptions').select('id, status').eq('org_id', org.id).eq('product', 'resto').maybeSingle();
if (!sub) {
  const { error } = await core().from('product_subscriptions')
    .insert({ org_id: org.id, product: 'resto', status: 'active' });
  if (error) fail("Création de l'abonnement", error);
  console.log('· Abonnement Resto : active.');
} else {
  console.log(`· Abonnement Resto déjà présent (${sub.status}).`);
}

// --- restaurant -----------------------------------------------------------
// currency laissée nulle : le lieu hérite de son organisation. Un restaurant
// d'un autre pays posera la sienne depuis l'administration.
let { data: restaurant } = await resto()
  .from('restaurants').select('id, name').eq('slug', slug).maybeSingle();
if (!restaurant) {
  const { data, error } = await resto().from('restaurants')
    .insert({ org_id: org.id, slug, name: restoName })
    .select('id, name').single();
  if (error) fail('Création du restaurant', error);
  restaurant = data;
  console.log(`· Restaurant « ${restaurant.name} » créé.`);
} else {
  console.log(`· Restaurant « ${restaurant.name} » déjà présent.`);
}

// --- compte du patron -----------------------------------------------------
if (await findUser()) fail('Création du compte', new Error(`« ${username} » existe déjà.`));

const { data: created, error: createErr } = await db.auth.admin.createUser({
  email, password, email_confirm: true,
  // app_metadata n'est pas modifiable par l'utilisateur, contrairement à
  // user_metadata. Reste un indicateur de commodité : l'autorité, c'est core.
  app_metadata: { kind: 'staff' },
  user_metadata: { username },
});
if (createErr) fail('Création du compte', createErr);
const userId = created.user.id;

const rollback = async () => {
  await core().from('product_access').delete().eq('user_id', userId);
  await core().from('org_members').delete().eq('user_id', userId);
  await resto().from('staff_accounts').delete().eq('user_id', userId);
  await db.auth.admin.deleteUser(userId);
};

for (const [label, op] of [
  ['org_members', () => core().from('org_members')
      .insert({ org_id: org.id, user_id: userId, org_role: 'owner' })],
  ['product_access', () => core().from('product_access')
      .insert({ org_id: org.id, user_id: userId, product: 'resto', role: 'owner' })],
  ['staff_accounts', () => resto().from('staff_accounts')
      .insert({ user_id: userId, restaurant_id: restaurant.id,
                username: username.toLowerCase(), display_name: display ?? null })],
]) {
  const { error } = await op();
  if (error) { await rollback(); fail(`Écriture de ${label}`, error); }
}

console.log(`✅ Patron « ${username} » créé pour ${restaurant.name}.`);
console.log(`   Connexion : /r/${slug}/login`);
console.log('   Il devra choisir son propre mot de passe à la première connexion.');

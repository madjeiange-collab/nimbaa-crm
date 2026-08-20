/**
 * Crée un restaurant et son PREMIER patron. À exécuter une fois par restaurant,
 * après avoir appliqué les migrations.
 *
 *   node supabase/seed/bootstrap-owner.mjs <slug> "<Nom>" <identifiant> "<mot de passe>" ["Nom affiché"]
 *   node supabase/seed/bootstrap-owner.mjs <slug> --reset <identifiant> "<nouveau mot de passe>"
 *
 * La console plateforme (invitations, TOTP, journal d'accès) arrive plus tard ;
 * pour un à trois restaurants pilotes, ce script EST l'amorçage — et le
 * --reset est aussi l'histoire de récupération : un patron qui perd son mot de
 * passe est à une commande de le retrouver.
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

const [, , slug, second, username, password, displayName] = process.argv;
const reset = second === '--reset';
const name = reset ? null : second;

if (!slug || !second || !username || !password) {
  console.error(
    'Usage : bootstrap-owner.mjs <slug> "<Nom>" <identifiant> "<mot de passe>" ["Nom affiché"]\n' +
    '        bootstrap-owner.mjs <slug> --reset <identifiant> "<nouveau mot de passe>"',
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error('❌ Mot de passe : 8 caractères au minimum.');
  process.exit(1);
}

const db = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const email = `${username.toLowerCase()}@${slug.toLowerCase()}.${DOMAIN}`;

const fail = (label, error) => {
  console.error(`❌ ${label} :`, error.message ?? error);
  process.exit(1);
};

/** Retrouve un compte par son adresse synthétique. */
async function findUser() {
  // listUsers pagine ; à l'échelle d'un pilote une page suffit largement.
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (error) fail('Lecture des comptes', error);
  return data.users.find((u) => u.email === email) ?? null;
}

if (reset) {
  const user = await findUser();
  if (!user) fail('Réinitialisation', new Error(`Aucun compte ${email}.`));

  const { error } = await db.auth.admin.updateUserById(user.id, { password });
  if (error) fail('Réinitialisation', error);

  // Le mot de passe donné de vive voix ne doit pas survivre au service.
  const { error: flagErr } = await db
    .from('staff_accounts')
    .update({ must_change_password: true })
    .eq('user_id', user.id);
  if (flagErr) fail('Marquage du compte', flagErr);

  console.log(`✅ Mot de passe réinitialisé pour « ${username} » chez ${slug}.`);
  console.log('   Il devra en choisir un autre à la prochaine connexion.');
  process.exit(0);
}

// ------------------------------------------------------------- restaurant
let { data: restaurant } = await db
  .from('restaurants')
  .select('id, name')
  .eq('slug', slug)
  .maybeSingle();

if (!restaurant) {
  const { data, error } = await db
    .from('restaurants')
    .insert({ slug, name })
    .select('id, name')
    .single();
  if (error) fail('Création du restaurant', error);
  restaurant = data;
  console.log(`· Restaurant « ${restaurant.name} » créé.`);
} else {
  console.log(`· Restaurant « ${restaurant.name} » déjà présent.`);
}

// ------------------------------------------------------------------ compte
if (await findUser()) {
  fail('Création du compte', new Error(`« ${username} » existe déjà chez ${slug}.`));
}

const { data: created, error: createErr } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  // app_metadata n'est pas modifiable par l'utilisateur, contrairement à
  // user_metadata. Reste un indicateur de commodité : l'autorité, c'est
  // restaurant_members.
  app_metadata: { kind: 'staff' },
  user_metadata: { username },
});
if (createErr) fail('Création du compte', createErr);

const userId = created.user.id;

const { error: accountErr } = await db.from('staff_accounts').insert({
  user_id: userId,
  restaurant_id: restaurant.id,
  username: username.toLowerCase(),
  display_name: displayName ?? null,
  must_change_password: true,
});
if (accountErr) {
  await db.auth.admin.deleteUser(userId); // pas de compte auth orphelin
  fail('Écriture de staff_accounts', accountErr);
}

const { error: memberErr } = await db.from('restaurant_members').insert({
  restaurant_id: restaurant.id,
  user_id: userId,
  role: 'owner',
  active: true,
});
if (memberErr) {
  await db.from('staff_accounts').delete().eq('user_id', userId);
  await db.auth.admin.deleteUser(userId);
  fail('Écriture de restaurant_members', memberErr);
}

console.log(`✅ Patron « ${username} » créé pour ${restaurant.name}.`);
console.log(`   Connexion : /r/${slug}/login`);
console.log('   Il devra choisir son propre mot de passe à la première connexion.');

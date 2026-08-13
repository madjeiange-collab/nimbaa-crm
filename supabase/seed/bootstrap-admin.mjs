/**
 * Crée le PREMIER administrateur (l'UI de gestion des utilisateurs arrive en
 * Phase 6). À exécuter une fois, après avoir appliqué les migrations.
 *
 *   node supabase/seed/bootstrap-admin.mjs <username> <password> "<Nom complet>"
 *
 * Nécessite dans .env.local :
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   NEXT_PUBLIC_AUTH_EMAIL_DOMAIN (optionnel, défaut crm.local)
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
const DOMAIN = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? 'crm.local';

if (!URL_ || !SERVICE_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  process.exit(1);
}

const [, , usernameArg, passwordArg, fullNameArg] = process.argv;
const username = (usernameArg ?? 'admin').trim().toLowerCase();
const password = passwordArg ?? 'admin1234';
const fullName = fullNameArg ?? 'Administrateur';
const email = `${username}@${DOMAIN}`;

const supabase = createClient(URL_, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { username, full_name: fullName },
});

if (createErr) {
  console.error('❌ Création échouée :', createErr.message);
  process.exit(1);
}

// Le trigger a inséré public.users ; on promeut le compte en admin.
const { error: updErr } = await supabase
  .from('users')
  .update({ role: 'admin', can_do_b2b: true, can_do_d2d: true, is_active: true, username })
  .eq('id', created.user.id);

if (updErr) {
  console.error('⚠️  Compte créé mais promotion admin échouée :', updErr.message);
  process.exit(1);
}

console.log(`✅ Admin créé : ${username} (mot de passe : ${password})`);
console.log(`   Connectez-vous avec le nom d'utilisateur « ${username} ».`);

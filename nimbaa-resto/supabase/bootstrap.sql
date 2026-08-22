-- Amorcer un client depuis le navigateur, sans terminal.
--
-- supabase/seed/bootstrap-owner.mjs fait la même chose mieux — il crée aussi
-- le compte Auth, et il défait tout si une étape échoue. Mais il demande Node,
-- pnpm et la clé de service sur une machine, ce qui n'a pas de sens quand on
-- ouvre un restaurant depuis un téléphone. Ceci est le chemin d'à côté : deux
-- gestes dans le tableau de bord.
--
-- ── 1. Créer le compte du patron ──────────────────────────────────────────
--   Authentication → Users → Add user → Create new user
--     Email     : <identifiant>@<slug-du-restaurant>.staff.nimbaa.app
--                 par exemple  fatou@le-bambou.staff.nimbaa.app
--     Password  : celui que vous lui direz de vive voix
--     ☑ Auto Confirm User
--
--   L'adresse n'a pas besoin d'exister : elle n'est jamais lue, et l'employé
--   ne la voit jamais. Mais sa FORME compte — c'est exactement ce que
--   l'application recompose à partir de l'identifiant tapé et du slug de
--   l'URL. Un point de travers et la connexion échoue sans rien dire d'utile.
--
--   Le domaine « staff.nimbaa.app » doit être le même que STAFF_EMAIL_DOMAIN
--   dans les variables d'environnement. Tant que vous n'y touchez pas, c'est
--   celui-ci.
--
-- ── 2. Exécuter cette requête ─────────────────────────────────────────────
--   Collez ce fichier entier dans le SQL Editor, ajustez le dernier bloc,
--   Run. Réexécutable sans dommage : rien n'est créé deux fois.

create or replace function core.bootstrap_client(
  p_login       text,             -- l'adresse créée à l'étape 1
  p_org_name    text,
  p_org_slug    text,
  p_resto_name  text,
  p_resto_slug  text,
  p_display     text default null,
  p_currency    text default 'XOF',
  p_country     text default 'CI'
) returns text
language plpgsql volatile security definer set search_path = core, resto, public as $$
declare
  v_user  uuid;
  v_org   uuid;
  v_resto uuid;
  v_username text := split_part(p_login, '@', 1);
begin
  select id into v_user from auth.users where lower(email) = lower(p_login);
  if v_user is null then
    raise exception 'Aucun compte Auth pour %. Créez-le d''abord : Authentication → Users → Add user.', p_login;
  end if;

  if not exists (select 1 from core.currencies where code = p_currency) then
    raise exception 'Monnaie % inconnue. Ajoutez-la à core.currencies.', p_currency;
  end if;

  -- L'organisation : le client qui paie. Un groupe de trois restaurants est
  -- UNE organisation et trois lignes dans resto.restaurants.
  insert into core.organizations (slug, name, country, currency)
  values (p_org_slug, p_org_name, p_country, p_currency)
  on conflict (slug) do update set name = excluded.name
  returning id into v_org;

  -- L'abonnement. Sans lui, core.has_product répond faux et l'application est
  -- fermée — ce n'est pas une formalité administrative, c'est l'interrupteur.
  insert into core.product_subscriptions (org_id, product, status)
  values (v_org, 'resto', 'active')
  on conflict (org_id, product) do update set status = 'active';

  insert into core.org_members (org_id, user_id, org_role)
  values (v_org, v_user, 'owner')
  on conflict (org_id, user_id) do update set org_role = 'owner', active = true;

  insert into core.product_access (org_id, user_id, product, role)
  values (v_org, v_user, 'resto', 'owner')
  on conflict (org_id, user_id, product) do update set role = 'owner', active = true;

  insert into resto.restaurants (org_id, slug, name)
  values (v_org, p_resto_slug, p_resto_name)
  on conflict (slug) do update set name = excluded.name
  returning id into v_resto;

  -- must_change_password vaut true par défaut : un mot de passe donné de vive
  -- voix ne doit pas survivre au premier service.
  insert into resto.staff_accounts (user_id, restaurant_id, username, display_name)
  values (v_user, v_resto, v_username, p_display)
  on conflict (user_id) do update
    set restaurant_id = excluded.restaurant_id,
        username      = excluded.username,
        display_name  = coalesce(excluded.display_name, resto.staff_accounts.display_name);

  return format('OK — %s (%s) · organisation %s · patron %s · connexion /r/%s/login',
                p_resto_name, p_currency, p_org_name, v_username, p_resto_slug);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- À AJUSTER, puis exécuter. Le slug est ce qui apparaît dans l'URL.
select core.bootstrap_client(
  p_login      => 'fatou@le-bambou.staff.nimbaa.app',
  p_org_name   => 'Le Bambou SARL',
  p_org_slug   => 'le-bambou',
  p_resto_name => 'Le Bambou Plateau',
  p_resto_slug => 'le-bambou',
  p_display    => 'Fatou Camara',
  p_currency   => 'XOF',
  p_country    => 'CI'
);

-- Ajouter un deuxième restaurant au MÊME groupe : reprenez p_org_slug tel
-- quel et changez p_resto_slug — l'organisation et l'abonnement sont
-- retrouvés, pas recréés.

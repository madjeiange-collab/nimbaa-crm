-- 0001 — Le socle : locataires, membres, comptes du personnel.
--
-- Trois tables, pas six. Les invitations, la console plateforme et son journal
-- d'accès arriveront quand il y aura des restaurants à assister ; pour les
-- premiers pilotes, le patron est créé par un script de démarrage, comme
-- l'admin du CRM l'a toujours été.
--
-- Deux règles tiennent le fichier.
--
-- 1. Chaque table porte restaurant_id EN CLAIR, jamais « atteignable par
--    jointure ». Une policy qui doit traverser deux jointures pour trouver son
--    locataire est une policy que personne n'écrit juste à 2h du matin, et que
--    Postgres planifie mal.
--
-- 2. is_member() est SECURITY DEFINER, et ce n'est pas un détail de style : la
--    policy de restaurant_members interroge restaurant_members. Sans SECURITY
--    DEFINER la policy s'appellerait elle-même — récursion infinie au premier
--    select, et c'est le piège classique de RLS sur Supabase.

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------- locataires
create table if not exists restaurants (
  id                uuid primary key default uuid_generate_v4(),
  slug              text not null unique,
  name              text not null,
  timezone          text not null default 'Africa/Conakry',
  -- Le GNF et le XOF n'ont pas de subdivision, l'EUR en a deux. Les montants
  -- sont partout des entiers dans l'unité la plus petite ; ce champ ne sert
  -- qu'à placer la virgule à l'affichage, jamais au calcul.
  currency          text not null default 'GNF',
  currency_decimals smallint not null default 0,
  service_charge_bp int  not null default 0,   -- points de base, 0 = aucun
  tax_mode          text not null default 'none'
                      check (tax_mode in ('inclusive','exclusive','none')),
  status            text not null default 'active'
                      check (status in ('active','suspended')),
  created_at        timestamptz not null default now()
);

-- --------------------------------------------------------------- membres
-- Le droit d'agir dans un restaurant, et la seule autorité en la matière.
-- app_metadata peut porter un indicateur de commodité ; il ne décide rien, et
-- user_metadata encore moins — l'utilisateur peut le réécrire lui-même.
create table if not exists restaurant_members (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id       uuid not null references auth.users(id)  on delete cascade,
  role          text not null
                  check (role in ('owner','manager','waiter','kitchen','cashier')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id, role)
);
create index if not exists rm_user_ix on restaurant_members (user_id) where active;

-- ------------------------------------------------------ comptes personnel
-- Identifiant + mot de passe, distribués par le patron. Supabase Auth exige
-- une adresse e-mail : on en stocke une synthétique que l'employé ne voit
-- jamais, et l'identifiant lisible vit ici. Rien d'autre — pas de contact de
-- récupération tant qu'il n'y a pas de flux qui s'en serve : un patron qui
-- perd son mot de passe relance le script de démarrage.
create table if not exists staff_accounts (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  restaurant_id        uuid not null references restaurants(id) on delete cascade,
  username             text not null,
  display_name         text,
  must_change_password boolean not null default true,
  disabled_at          timestamptz,
  created_at           timestamptz not null default now(),
  unique (restaurant_id, username)
);

-- ------------------------------------------------------------- prédicats
create or replace function is_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from restaurant_members m
    where m.restaurant_id = rid and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function has_role(rid uuid, allowed text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from restaurant_members m
    where m.restaurant_id = rid and m.user_id = auth.uid()
      and m.active and m.role = any(allowed)
  );
$$;

-- ------------------------------------------------------------------- RLS
alter table restaurants        enable row level security;
alter table restaurant_members enable row level security;
alter table staff_accounts     enable row level security;

drop policy if exists resto_read on restaurants;
create policy resto_read on restaurants for select using (is_member(id));

drop policy if exists resto_write on restaurants;
create policy resto_write on restaurants for update
  using (has_role(id, array['owner','manager']))
  with check (has_role(id, array['owner','manager']));

drop policy if exists rm_read on restaurant_members;
create policy rm_read on restaurant_members for select using (is_member(restaurant_id));

-- Seul un patron nomme un patron ou un gérant. Un gérant recrute en salle et
-- en cuisine, jamais ses propres pairs : c'est ce qui empêche une compromission
-- moyenne de devenir totale.
drop policy if exists rm_grant on restaurant_members;
create policy rm_grant on restaurant_members for insert with check (
  has_role(restaurant_id, array['owner'])
  or (has_role(restaurant_id, array['manager'])
      and role in ('waiter','kitchen','cashier'))
);

drop policy if exists rm_revoke on restaurant_members;
create policy rm_revoke on restaurant_members for update
  using (has_role(restaurant_id, array['owner']))
  with check (has_role(restaurant_id, array['owner']));

drop policy if exists sa_read on staff_accounts;
create policy sa_read on staff_accounts for select
  using (user_id = auth.uid() or is_member(restaurant_id));

drop policy if exists sa_manage on staff_accounts;
create policy sa_manage on staff_accounts for update
  using (has_role(restaurant_id, array['owner','manager']))
  with check (has_role(restaurant_id, array['owner','manager']));

-- --------------------------------------------------- premier mot de passe
-- Un employé doit pouvoir lever SON drapeau must_change_password, et rien
-- d'autre. Lui ouvrir staff_accounts en écriture reviendrait à le laisser
-- changer son identifiant, son restaurant, ou effacer son disabled_at — donc
-- se réactiver lui-même. Une fonction qui ne touche qu'une colonne et qu'une
-- ligne, la sienne, coûte trois lignes et ferme la question.
create or replace function clear_must_change_password() returns void
language sql volatile security definer set search_path = public as $$
  update staff_accounts
     set must_change_password = false
   where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------- droits
-- Supabase accorde ces droits par défaut aux nouvelles tables de public ; on
-- les écrit quand même, pour que la migration se suffise à elle-même et
-- s'applique telle quelle sur un Postgres nu — en test, en CI, en local.
--
-- Large en apparence : c'est le modèle Supabase, où la barrière est RLS et non
-- le GRANT. anon n'a aucune policy sur ces trois tables, donc anon ne lit rien.
grant usage on schema public to anon, authenticated, service_role;
grant all on restaurants, restaurant_members, staff_accounts
  to anon, authenticated, service_role;
grant execute on function is_member(uuid) to anon, authenticated, service_role;
grant execute on function has_role(uuid, text[]) to anon, authenticated, service_role;
grant execute on function clear_must_change_password() to anon, authenticated, service_role;

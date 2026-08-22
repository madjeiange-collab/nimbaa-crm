-- 0002 — resto : les lieux, et qui y travaille.
--
-- Tout ce qui suit s'appuie sur core (0001). Le rôle d'une personne dans le
-- produit vit dans core.product_access ; ici on ne garde que ce qui est propre
-- au restaurant : où elle travaille, et sous quel identifiant elle se connecte.

create schema if not exists resto;

create table if not exists resto.restaurants (
  id         uuid primary key default uuid_generate_v4(),
  org_id     uuid not null references core.organizations(id) on delete cascade,
  slug       text not null unique,
  name       text not null,
  timezone   text not null default 'Africa/Abidjan',
  -- NULL = « celle de l'organisation ». Un groupe peut tenir un restaurant à
  -- Abidjan et un autre à Paris ; le premier n'a rien à déclarer, le second
  -- pose EUR ici. Une seule colonne, et aucune chance que les deux niveaux se
  -- contredisent en silence.
  currency   text references core.currencies(code),
  service_charge_bp int not null default 0,
  tax_mode   text not null default 'none'
               check (tax_mode in ('inclusive','exclusive','none')),
  status     text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now()
);
create index if not exists r_org_ix on resto.restaurants (org_id);

-- Identifiant + mot de passe, distribués par le patron. Supabase Auth exige une
-- adresse e-mail : on en stocke une synthétique que l'employé ne voit jamais.
-- Le personnel de salle n'a pas d'e-mail à lui ; un patron qui utilise aussi le
-- CRM se connecte avec sa vraie adresse, et n'a pas de ligne ici.
create table if not exists resto.staff_accounts (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  restaurant_id        uuid not null references resto.restaurants(id) on delete cascade,
  username             text not null,
  display_name         text,
  must_change_password boolean not null default true,
  disabled_at          timestamptz,
  created_at           timestamptz not null default now(),
  unique (restaurant_id, username)
);

-- --------------------------------------------------------------- monnaie
-- La monnaie effective d'un lieu : la sienne, sinon celle de l'organisation.
create or replace function resto.currency_of(rid uuid) returns text
language sql stable security definer set search_path = resto, core, public as $$
  select coalesce(r.currency, o.currency)
  from resto.restaurants r
  join core.organizations o on o.id = r.org_id
  where r.id = rid;
$$;

-- --------------------------------------------------------------- prédicat
-- Travailler ici, c'est trois choses à la fois : être affecté à ce restaurant,
-- et que l'organisation qui le détient ait un abonnement resto vivant sur
-- lequel on a un rôle. core.has_product porte les deux dernières.
create or replace function resto.works_at(rid uuid) returns boolean
language sql stable security definer set search_path = resto, core, public as $$
  select exists (
    select 1
    from resto.restaurants r
    join resto.staff_accounts sa
      on sa.restaurant_id = r.id and sa.user_id = auth.uid() and sa.disabled_at is null
    where r.id = rid and core.has_product(r.org_id, 'resto')
  );
$$;

-- ------------------------------------------------------------------- RLS
alter table resto.restaurants    enable row level security;
alter table resto.staff_accounts enable row level security;

drop policy if exists r_read on resto.restaurants;
create policy r_read on resto.restaurants for select
  using (resto.works_at(id) or core.has_product(org_id, 'resto'));

drop policy if exists r_write on resto.restaurants;
create policy r_write on resto.restaurants for update
  using (core.has_product_role(org_id, 'resto', array['owner','manager']))
  with check (core.has_product_role(org_id, 'resto', array['owner','manager']));

drop policy if exists sa_read on resto.staff_accounts;
create policy sa_read on resto.staff_accounts for select
  using (user_id = auth.uid() or resto.works_at(restaurant_id));

drop policy if exists sa_manage on resto.staff_accounts;
create policy sa_manage on resto.staff_accounts for update
  using (exists (select 1 from resto.restaurants r where r.id = restaurant_id
                 and core.has_product_role(r.org_id, 'resto', array['owner','manager'])))
  with check (exists (select 1 from resto.restaurants r where r.id = restaurant_id
                      and core.has_product_role(r.org_id, 'resto', array['owner','manager'])));

-- Un employé doit pouvoir lever SON drapeau must_change_password, et rien
-- d'autre : lui ouvrir la table reviendrait à le laisser changer son
-- identifiant, son restaurant, ou effacer son disabled_at — donc se réactiver.
create or replace function resto.clear_must_change_password() returns void
language sql volatile security definer set search_path = resto, public as $$
  update resto.staff_accounts
     set must_change_password = false
   where user_id = auth.uid();
$$;

grant usage on schema resto to anon, authenticated, service_role;
grant all on all tables in schema resto to anon, authenticated, service_role;
grant execute on all functions in schema resto to anon, authenticated, service_role;

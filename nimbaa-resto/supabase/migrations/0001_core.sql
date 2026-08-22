-- 0001 — core : la couche plateforme.
--
-- Une personne s'abonne à Nimbaa une fois, puis ajoute des applications. Trois
-- faits doivent être vrais pour qu'une ligne d'un produit soit visible :
--   la personne appartient à l'organisation,
--   l'organisation a un abonnement vivant à ce produit,
--   la personne a un rôle dans ce produit.
-- Le deuxième est ce qui rend chaque application vendable séparément.

create extension if not exists "uuid-ossp";
create schema if not exists core;

-- ------------------------------------------------------------- monnaies
-- Table de référence plutôt qu'une colonne « decimals » recopiée partout :
-- deux colonnes qui se répètent finissent par se contredire, et un XOF à deux
-- décimales est un bug qu'on ne voit qu'au moment d'encaisser.
create table if not exists core.currencies (
  code     text primary key,
  decimals smallint not null,
  symbol   text
);
insert into core.currencies (code, decimals, symbol) values
  ('XOF', 0, 'FCFA'), ('XAF', 0, 'FCFA'), ('GNF', 0, 'FG'),
  ('EUR', 2, '€'),    ('USD', 2, '$'),    ('MAD', 2, 'DH'),
  ('NGN', 2, '₦'),    ('GHS', 2, 'GH₵')
on conflict (code) do nothing;

-- --------------------------------------------------------- organisations
-- Le client qui paie. Sa monnaie est le DÉFAUT de ce qu'il exploite ; un lieu
-- particulier peut en décider autrement (voir resto.restaurants.currency).
create table if not exists core.organizations (
  id         uuid primary key default uuid_generate_v4(),
  slug       text not null unique,
  name       text not null,
  country    text,
  currency   text not null default 'XOF' references core.currencies(code),
  status     text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table if not exists core.org_members (
  org_id     uuid not null references core.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_role   text not null check (org_role in ('owner','admin','member')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists om_user_ix on core.org_members (user_id, org_id) where active;

-- ------------------------------------------------------------ abonnements
create table if not exists core.product_subscriptions (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid not null references core.organizations(id) on delete cascade,
  product      text not null check (product in ('crm','resto')),
  plan         text not null default 'standard',
  -- past_due donne encore accès : couper le service d'un restaurant à 20h
  -- parce qu'une carte a été refusée est une faute, pas une politique.
  status       text not null
                 check (status in ('trialing','active','past_due','cancelled','suspended')),
  -- Ce que Nimbaa facture. Indépendant de la monnaie que le client exploite :
  -- un groupe parisien peut payer en EUR un restaurant qui vend en XOF.
  price_amount     bigint,
  billing_currency text references core.currencies(code),
  period_start timestamptz not null default now(),
  period_end   timestamptz,
  grace_until  timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, product)
);
create index if not exists ps_live_ix on core.product_subscriptions (org_id, product)
  where status in ('trialing','active','past_due');

create table if not exists core.product_access (
  org_id     uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  product    text not null,
  role       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, product),
  -- L'accès produit ne survit pas à l'appartenance : on ne garde pas quelqu'un
  -- dans la cuisine d'une organisation qu'il a quittée.
  foreign key (org_id, user_id) references core.org_members(org_id, user_id) on delete cascade
);

-- ------------------------------------------------------------- prédicats
create or replace function core.decimals_of(cur text) returns smallint
language sql stable security definer set search_path = core, public as $$
  select decimals from core.currencies where code = cur;
$$;

create or replace function core.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = core, public as $$
  select exists (
    select 1 from core.org_members m
    where m.org_id = org and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function core.subscription_live(org uuid, prod text) returns boolean
language sql stable security definer set search_path = core, public as $$
  select exists (
    select 1 from core.product_subscriptions s
    where s.org_id = org and s.product = prod
      and (
        -- Payé ou en essai : vivant jusqu'à la fin de période.
        (s.status in ('trialing','active')
          and (s.period_end is null or s.period_end > now()))
        or
        -- En retard : vivant seulement pendant le délai de grâce. Un OR à plat
        -- sur period_end laisserait passer un impayé indéfiniment, la période
        -- n'étant renseignée qu'une fois la facturation branchée.
        (s.status = 'past_due'
          and s.grace_until is not null and s.grace_until > now())
      )
  );
$$;

create or replace function core.has_product(org uuid, prod text) returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.is_org_member(org)
     and core.subscription_live(org, prod)
     and exists (
       select 1 from core.product_access a
       where a.org_id = org and a.user_id = auth.uid()
         and a.product = prod and a.active
     );
$$;

create or replace function core.has_product_role(org uuid, prod text, roles text[])
returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.has_product(org, prod)
     and exists (
       select 1 from core.product_access a
       where a.org_id = org and a.user_id = auth.uid()
         and a.product = prod and a.active and a.role = any(roles)
     );
$$;

-- ------------------------------------------------------------------- RLS
alter table core.currencies            enable row level security;
alter table core.organizations         enable row level security;
alter table core.org_members           enable row level security;
alter table core.product_subscriptions enable row level security;
alter table core.product_access        enable row level security;

-- Les monnaies sont un référentiel public : il faut pouvoir en proposer la
-- liste à l'écran de réglages avant même de savoir qui regarde.
drop policy if exists cur_read on core.currencies;
create policy cur_read on core.currencies for select using (true);

drop policy if exists org_read on core.organizations;
create policy org_read on core.organizations for select using (core.is_org_member(id));

drop policy if exists org_write on core.organizations;
create policy org_write on core.organizations for update
  using (exists (select 1 from core.org_members m
                 where m.org_id = id and m.user_id = auth.uid()
                   and m.active and m.org_role in ('owner','admin')))
  with check (exists (select 1 from core.org_members m
                      where m.org_id = id and m.user_id = auth.uid()
                        and m.active and m.org_role in ('owner','admin')));

drop policy if exists om_read on core.org_members;
create policy om_read on core.org_members for select using (core.is_org_member(org_id));

drop policy if exists ps_read on core.product_subscriptions;
create policy ps_read on core.product_subscriptions for select using (core.is_org_member(org_id));

drop policy if exists pa_read on core.product_access;
create policy pa_read on core.product_access for select using (core.is_org_member(org_id));

-- Pas de politique d'écriture sur les abonnements ni sur les accès : ils sont
-- posés à la main via la clé de service tant que la facturation n'existe pas.
-- Un client qui pourrait s'accorder un abonnement ne serait pas un client.

grant usage on schema core to anon, authenticated, service_role;
grant all on all tables in schema core to anon, authenticated, service_role;
grant execute on all functions in schema core to anon, authenticated, service_role;

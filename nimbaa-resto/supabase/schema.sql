-- Nimbaa — schéma complet, engendré par supabase/bundle.mjs.
-- NE PAS MODIFIER ICI : modifiez la migration, puis « pnpm db:bundle ».
-- 5 migrations : 0001_core.sql, 0002_resto.sql, 0003_menu_and_floor.sql, 0004_menu_photos.sql, 0005_category_order.sql
--
-- À coller dans Supabase → SQL Editor → New query → Run.

-- Une transaction : ou tout est appliqué, ou rien. Si le SQL Editor ouvre
-- déjà la sienne, un avertissement « there is already a transaction in
-- progress » apparaît — sans conséquence, la garantie tient quand même.
begin;

-- ======================================================================
-- 0001_core.sql
-- ======================================================================

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

-- ======================================================================
-- 0002_resto.sql
-- ======================================================================

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

-- ======================================================================
-- 0003_menu_and_floor.sql
-- ======================================================================

-- 0003 — la carte et la salle.
--
-- Tout appartient au RESTAURANT, pas à l'organisation : un groupe qui tient un
-- lieu à Abidjan et un autre à Paris n'a ni la même carte, ni les mêmes prix,
-- ni la même monnaie. Copier une carte d'un lieu à l'autre viendra quand un
-- groupe le demandera ; la partager par défaut serait faux dès le deuxième.

-- ------------------------------------------------------------- prédicats
-- Lire : appartenir à l'organisation du lieu et avoir accès au produit.
create or replace function resto.can_read(rid uuid) returns boolean
language sql stable security definer set search_path = resto, core, public as $$
  select exists (
    select 1 from resto.restaurants r
    where r.id = rid and core.has_product(r.org_id, 'resto')
  );
$$;

-- Écrire : être patron ou gérant. Pas besoin d'être affecté au lieu — un patron
-- de groupe administre ses trois restaurants sans travailler dans aucun.
create or replace function resto.can_manage(rid uuid) returns boolean
language sql stable security definer set search_path = resto, core, public as $$
  select exists (
    select 1 from resto.restaurants r
    where r.id = rid
      and core.has_product_role(r.org_id, 'resto', array['owner','manager'])
  );
$$;

-- ---------------------------------------------------------------- salle
create table if not exists resto.areas (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references resto.restaurants(id) on delete cascade,
  name          text not null,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table if not exists resto.tables (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references resto.restaurants(id) on delete cascade,
  area_id       uuid references resto.areas(id) on delete set null,
  label         text not null,
  seats         int not null default 4,
  status        text not null default 'open' check (status in ('open','closed')),
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, label)
);
create index if not exists t_resto_ix on resto.tables (restaurant_id, sort);

-- -------------------------------------------------------------- postes
-- Un poste de préparation : cuisine, bar, grill. Un plat sans poste est servi
-- directement — c'est l'absence de poste qui exprime le service direct, pas un
-- indicateur séparé qu'il faudrait tenir à jour.
create table if not exists resto.prep_stations (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references resto.restaurants(id) on delete cascade,
  name          text not null,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);

-- --------------------------------------------------------------- carte
create table if not exists resto.menu_categories (
  id            uuid primary key default uuid_generate_v4(),
  restaurant_id uuid not null references resto.restaurants(id) on delete cascade,
  name          text not null,
  sort          int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table if not exists resto.menu_items (
  id              uuid primary key default uuid_generate_v4(),
  restaurant_id   uuid not null references resto.restaurants(id) on delete cascade,
  category_id     uuid references resto.menu_categories(id) on delete set null,
  name            text not null,
  description     text,
  -- Entier dans l'unité la plus petite de la monnaie du lieu. Jamais un
  -- flottant : le nombre de décimales vient de core.currencies au moment de
  -- l'affichage, et nulle part ailleurs.
  price           bigint not null default 0 check (price >= 0),
  -- NULL = servi directement, sans passer par un poste.
  prep_station_id uuid references resto.prep_stations(id) on delete set null,
  -- L'interrupteur « 86 » : plus de poisson ce soir.
  available       boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  unique (restaurant_id, name)
);
create index if not exists mi_cat_ix on resto.menu_items (restaurant_id, category_id, sort);

-- ------------------------------------------------------------------- RLS
-- Écrites à plat plutôt qu'en boucle : une policy qu'on ne peut pas lire
-- telle quelle est une policy que personne ne relit.
-- Lire la carte n'est pas la changer — d'où une policy par verbe.

alter table resto.areas enable row level security;
drop policy if exists areas_read on resto.areas;
create policy areas_read on resto.areas
    for select using (resto.can_read(restaurant_id));
drop policy if exists areas_ins on resto.areas;
create policy areas_ins on resto.areas
    for insert with check (resto.can_manage(restaurant_id));
drop policy if exists areas_upd on resto.areas;
create policy areas_upd on resto.areas
    for update using (resto.can_manage(restaurant_id))
    with check (resto.can_manage(restaurant_id));
drop policy if exists areas_del on resto.areas;
create policy areas_del on resto.areas
    for delete using (resto.can_manage(restaurant_id));

alter table resto.tables enable row level security;
drop policy if exists tables_read on resto.tables;
create policy tables_read on resto.tables
    for select using (resto.can_read(restaurant_id));
drop policy if exists tables_ins on resto.tables;
create policy tables_ins on resto.tables
    for insert with check (resto.can_manage(restaurant_id));
drop policy if exists tables_upd on resto.tables;
create policy tables_upd on resto.tables
    for update using (resto.can_manage(restaurant_id))
    with check (resto.can_manage(restaurant_id));
drop policy if exists tables_del on resto.tables;
create policy tables_del on resto.tables
    for delete using (resto.can_manage(restaurant_id));

alter table resto.prep_stations enable row level security;
drop policy if exists prep_stations_read on resto.prep_stations;
create policy prep_stations_read on resto.prep_stations
    for select using (resto.can_read(restaurant_id));
drop policy if exists prep_stations_ins on resto.prep_stations;
create policy prep_stations_ins on resto.prep_stations
    for insert with check (resto.can_manage(restaurant_id));
drop policy if exists prep_stations_upd on resto.prep_stations;
create policy prep_stations_upd on resto.prep_stations
    for update using (resto.can_manage(restaurant_id))
    with check (resto.can_manage(restaurant_id));
drop policy if exists prep_stations_del on resto.prep_stations;
create policy prep_stations_del on resto.prep_stations
    for delete using (resto.can_manage(restaurant_id));

alter table resto.menu_categories enable row level security;
drop policy if exists menu_categories_read on resto.menu_categories;
create policy menu_categories_read on resto.menu_categories
    for select using (resto.can_read(restaurant_id));
drop policy if exists menu_categories_ins on resto.menu_categories;
create policy menu_categories_ins on resto.menu_categories
    for insert with check (resto.can_manage(restaurant_id));
drop policy if exists menu_categories_upd on resto.menu_categories;
create policy menu_categories_upd on resto.menu_categories
    for update using (resto.can_manage(restaurant_id))
    with check (resto.can_manage(restaurant_id));
drop policy if exists menu_categories_del on resto.menu_categories;
create policy menu_categories_del on resto.menu_categories
    for delete using (resto.can_manage(restaurant_id));

alter table resto.menu_items enable row level security;
drop policy if exists menu_items_read on resto.menu_items;
create policy menu_items_read on resto.menu_items
    for select using (resto.can_read(restaurant_id));
drop policy if exists menu_items_ins on resto.menu_items;
create policy menu_items_ins on resto.menu_items
    for insert with check (resto.can_manage(restaurant_id));
drop policy if exists menu_items_upd on resto.menu_items;
create policy menu_items_upd on resto.menu_items
    for update using (resto.can_manage(restaurant_id))
    with check (resto.can_manage(restaurant_id));
drop policy if exists menu_items_del on resto.menu_items;
create policy menu_items_del on resto.menu_items
    for delete using (resto.can_manage(restaurant_id));

grant all on all tables in schema resto to anon, authenticated, service_role;
grant execute on all functions in schema resto to anon, authenticated, service_role;

-- ======================================================================
-- 0004_menu_photos.sql
-- ======================================================================

-- 0004 — la photo du plat.
--
-- Elle n'est pas décorative. Sur un marché où une partie du personnel et des
-- clients lit mal, c'est la photo qui porte l'information ; le nom est ce qui
-- reste pour ceux qui lisent. Le plan la prévoyait dès le départ, la migration
-- 0003 l'a oubliée.
--
-- Chemin : menu/<restaurant_id>/<uuid>.webp — le premier dossier EST le
-- restaurant, ce qui permet à la policy de savoir de qui est la photo sans
-- avoir à la joindre à quoi que ce soit.

alter table resto.menu_items add column if not exists photo_path text;

-- ------------------------------------------------------------- le seau
-- Sur un Postgres nu (tests, CI) le schéma storage n'existe pas : on le
-- traverse en silence plutôt que de rendre la migration inapplicable hors
-- Supabase.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then

    -- Seau public en LECTURE : une photo de plat n'est pas un secret, et en
    -- phase 2 elle sera de toute façon affichée au client qui scanne. L'écriture,
    -- elle, reste tenue par les policies ci-dessous.
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('menu', 'menu', true, 2097152,
              array['image/webp','image/jpeg','image/png'])
      on conflict (id) do update
        set public = true,
            file_size_limit = 2097152,
            allowed_mime_types = array['image/webp','image/jpeg','image/png']
    $q$;

    -- 2 Mo est déjà dix fois la cible (25–40 Ko après compression côté client).
    -- La limite n'est pas un objectif : c'est le garde-fou du jour où la
    -- compression échoue silencieusement.

    execute $q$ drop policy if exists menu_photo_read on storage.objects $q$;
    execute $q$
      create policy menu_photo_read on storage.objects for select
        using (bucket_id = 'menu')
    $q$;

    -- Écrire dans le dossier d'un restaurant : il faut le gérer. Un serveur
    -- d'un autre restaurant ne peut pas déposer une image dans ce dossier, et
    -- un serveur de CE restaurant non plus.
    for i in 1..3 loop
      execute format($q$ drop policy if exists %I on storage.objects $q$,
                     'menu_photo_' || (array['ins','upd','del'])[i]);
    end loop;

    execute $q$
      create policy menu_photo_ins on storage.objects for insert to authenticated
        with check (bucket_id = 'menu'
                    and resto.can_manage(((storage.foldername(name))[1])::uuid))
    $q$;
    execute $q$
      create policy menu_photo_upd on storage.objects for update to authenticated
        using (bucket_id = 'menu'
               and resto.can_manage(((storage.foldername(name))[1])::uuid))
    $q$;
    execute $q$
      create policy menu_photo_del on storage.objects for delete to authenticated
        using (bucket_id = 'menu'
               and resto.can_manage(((storage.foldername(name))[1])::uuid))
    $q$;
  end if;
end $$;

-- ======================================================================
-- 0005_category_order.sql
-- ======================================================================

-- 0005 — l'ordre de la carte, et la photo des catégories.
--
-- « La position est une mémoire » : le même plat au même endroit, tous les
-- jours, se reconnaît sans être lu. C'était un principe de conception et pas
-- une préférence — et il ne tenait pas, parce que sort valait 0 partout.
-- Postgres départageait les ex æquo comme il voulait, donc l'ordre changeait
-- sans prévenir. Pour quelqu'un qui navigue à la position plutôt qu'à la
-- lecture, un ordre instable est pire que pas d'ordre du tout.

alter table resto.menu_categories add column if not exists photo_path text;

-- Renumérotation des lignes existantes : on fige l'ordre courant plutôt que
-- d'en inventer un. Ce qui était arbitraire le reste, mais cesse de bouger.
with ranked as (
  select id, row_number() over (partition by restaurant_id order by sort, created_at, name) - 1 as n
  from resto.menu_categories
)
update resto.menu_categories c set sort = ranked.n
from ranked where ranked.id = c.id and c.sort is distinct from ranked.n;

with ranked as (
  select id, row_number() over (
           partition by restaurant_id, category_id order by sort, created_at, name) - 1 as n
  from resto.menu_items
)
update resto.menu_items i set sort = ranked.n
from ranked where ranked.id = i.id and i.sort is distinct from ranked.n;

-- Deux positions identiques dans un même restaurant redeviendraient un ordre
-- arbitraire. On l'interdit, en différé pour que la renumérotation d'un
-- déplacement puisse passer par un état transitoire à l'intérieur d'une
-- transaction.
create unique index if not exists mc_sort_ux
  on resto.menu_categories (restaurant_id, sort);
alter table resto.menu_categories
  drop constraint if exists mc_sort_unique;
alter table resto.menu_categories
  add constraint mc_sort_unique unique using index mc_sort_ux deferrable initially deferred;

-- --------------------------------------------------------- la position
-- Échanger deux positions demande UNE transaction : PostgREST en ouvre une par
-- appel, donc deux .update() successifs valideraient un doublon au premier des
-- deux. D'où une fonction, qui fait les deux écritures ensemble.
--
-- SECURITY DEFINER, donc RLS ne s'applique pas à l'intérieur : le contrôle de
-- droit est fait ici, explicitement, et il ne peut pas être oublié.
create or replace function resto.move_category(p_id uuid, p_dir int) returns void
language plpgsql volatile security definer set search_path = resto, core, public as $$
declare r_id uuid; my_sort int; nb_id uuid; nb_sort int;
begin
  select restaurant_id, sort into r_id, my_sort
    from resto.menu_categories where id = p_id;
  if r_id is null then raise exception 'catégorie introuvable'; end if;
  if not resto.can_manage(r_id) then
    raise exception 'réservé au patron et au gérant' using errcode = '42501';
  end if;

  if p_dir < 0 then
    select id, sort into nb_id, nb_sort from resto.menu_categories
     where restaurant_id = r_id and sort < my_sort order by sort desc limit 1;
  else
    select id, sort into nb_id, nb_sort from resto.menu_categories
     where restaurant_id = r_id and sort > my_sort order by sort asc limit 1;
  end if;
  if nb_id is null then return; end if;  -- déjà en bout de liste, rien à faire

  update resto.menu_categories set sort = nb_sort where id = p_id;
  update resto.menu_categories set sort = my_sort where id = nb_id;
end $$;

create or replace function resto.move_item(p_id uuid, p_dir int) returns void
language plpgsql volatile security definer set search_path = resto, core, public as $$
declare r_id uuid; c_id uuid; my_sort int; nb_id uuid; nb_sort int;
begin
  select restaurant_id, category_id, sort into r_id, c_id, my_sort
    from resto.menu_items where id = p_id;
  if r_id is null then raise exception 'plat introuvable'; end if;
  if not resto.can_manage(r_id) then
    raise exception 'réservé au patron et au gérant' using errcode = '42501';
  end if;

  if p_dir < 0 then
    select id, sort into nb_id, nb_sort from resto.menu_items
     where restaurant_id = r_id and category_id is not distinct from c_id
       and sort < my_sort order by sort desc limit 1;
  else
    select id, sort into nb_id, nb_sort from resto.menu_items
     where restaurant_id = r_id and category_id is not distinct from c_id
       and sort > my_sort order by sort asc limit 1;
  end if;
  if nb_id is null then return; end if;

  update resto.menu_items set sort = nb_sort where id = p_id;
  update resto.menu_items set sort = my_sort where id = nb_id;
end $$;

-- ------------------------------------------------- la position à la création
-- Une nouvelle catégorie se range à la fin, pas à la place d'une autre. Sans
-- cela l'insertion viole l'unicité dès la deuxième, et surtout : ce qu'on
-- ajoute n'a aucune raison de bousculer ce que l'équipe connaît déjà.
create or replace function resto.category_tail_sort() returns trigger
language plpgsql as $$
begin
  if new.sort is null or new.sort = 0 then
    select coalesce(max(sort) + 1, 0) into new.sort
      from resto.menu_categories where restaurant_id = new.restaurant_id;
  end if;
  return new;
end $$;
drop trigger if exists mc_tail_sort on resto.menu_categories;
create trigger mc_tail_sort before insert on resto.menu_categories
  for each row execute function resto.category_tail_sort();

create or replace function resto.item_tail_sort() returns trigger
language plpgsql as $$
begin
  if new.sort is null or new.sort = 0 then
    select coalesce(max(sort) + 1, 0) into new.sort
      from resto.menu_items
     where restaurant_id = new.restaurant_id
       and category_id is not distinct from new.category_id;
  end if;
  return new;
end $$;
drop trigger if exists mi_tail_sort on resto.menu_items;
create trigger mi_tail_sort before insert on resto.menu_items
  for each row execute function resto.item_tail_sort();

grant execute on all functions in schema resto to anon, authenticated, service_role;

commit;

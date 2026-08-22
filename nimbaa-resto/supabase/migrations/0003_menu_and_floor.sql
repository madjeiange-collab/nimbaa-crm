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

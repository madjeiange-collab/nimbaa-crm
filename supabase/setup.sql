-- =============================================================================
-- CRM Terrain — schéma initial (Phase 1)
-- Postgres + PostGIS. À appliquer sur un projet Supabase avec l'extension
-- PostGIS activée (voir README).
-- =============================================================================

-- ============ EXTENSIONS ============
create extension if not exists postgis;
create extension if not exists "uuid-ossp";

-- ============ ENUMS ============
create type user_role         as enum ('rep','manager','admin');
create type territory_type    as enum ('b2b','d2d','mixed');
create type visit_type        as enum ('b2b_visit','d2d_knock');
create type disposition_type  as enum ('no_answer','not_home','refused','interested','appointment_set','sold','do_not_knock');
create type contact_lifecycle as enum ('lead','customer','lost');
create type priority_level    as enum ('vip','high','medium','low');
create type contact_source    as enum ('d2d_knock','b2b_field','referral','walk_in','import','manual');
create type activity_type     as enum ('call','whatsapp','note');

-- ============ USERS (liés à auth.users) ============
create table users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text unique not null,          -- email synthétique <username>@<domaine>
  username   text unique,                    -- identifiant défini par l'admin
  full_name  text,
  role       user_role not null default 'rep',
  can_do_b2b boolean not null default false,
  can_do_d2d boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ TERRITORIES + JOINTURE ============
create table territories (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  type        territory_type not null,
  manager_id  uuid references users(id),
  polygon     geography(POLYGON,4326),
  description text,
  created_at  timestamptz not null default now()
);
create index territories_polygon_gix on territories using gist (polygon);

create table user_territories (
  user_id      uuid references users(id) on delete cascade,
  territory_id uuid references territories(id) on delete cascade,
  primary key (user_id, territory_id)
);

-- ============ ÉTAPES DU PIPELINE (modifiables par l'admin) ============
create table pipeline_stages (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  sort_order int  not null default 0,
  is_won     boolean not null default false,
  is_lost    boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============ CONTACTS (Prospects + Clients, une seule table) ============
create table contacts (
  id                uuid primary key default uuid_generate_v4(),
  client_uuid       uuid unique,                    -- idempotence hors-ligne
  name              text,
  phone             text,
  address           text,
  lat               double precision,
  lng               double precision,
  geom              geography(POINT,4326) generated always as
                      (st_setsrid(st_makepoint(lng,lat),4326)::geography) stored,
  lifecycle         contact_lifecycle not null default 'lead',
  pipeline_stage_id uuid references pipeline_stages(id),
  priority          priority_level not null default 'medium',
  is_active         boolean not null default true,
  tags              text[] not null default '{}',   -- inclut la "Branche" + tout tag
  source            contact_source not null default 'd2d_knock',
  assigned_rep_id   uuid references users(id),
  territory_id      uuid references territories(id),
  value_xof         bigint,
  lost_reason       text,
  do_not_contact    boolean not null default false,
  converted_at      timestamptz,
  created_by        uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index contacts_geom_gix  on contacts using gist (geom);
create index contacts_tags_gix  on contacts using gin  (tags);
create index contacts_terr_ix   on contacts (territory_id);
create index contacts_stage_ix  on contacts (pipeline_stage_id);
create index contacts_life_ix   on contacts (lifecycle);
create index contacts_rep_ix    on contacts (assigned_rep_id);

-- ============ VISITS (couche "porte frappée" / visite terrain) ============
create table visits (
  id               uuid primary key default uuid_generate_v4(),
  client_uuid      uuid unique,
  contact_id       uuid references contacts(id),    -- NULL pour une porte "morte"
  rep_id           uuid references users(id) not null,
  visit_type       visit_type not null,
  visited_at       timestamptz not null,
  lat              double precision,
  lng              double precision,
  geom             geography(POINT,4326) generated always as
                     (st_setsrid(st_makepoint(lng,lat),4326)::geography) stored,
  notes            text,
  disposition      disposition_type,
  appointment_date timestamptz,
  next_visit_date  date,
  synced_at        timestamptz default now(),
  created_at       timestamptz not null default now()
);
create index visits_geom_gix    on visits using gist (geom);
create index visits_rep_ix      on visits (rep_id, visited_at desc);
create index visits_contact_ix  on visits (contact_id);
create index visits_type_ix     on visits (visit_type, disposition);

-- ============ PHOTOS DE VISITE ============
create table visit_photos (
  id           uuid primary key default uuid_generate_v4(),
  visit_id     uuid references visits(id) on delete cascade,
  storage_path text not null,
  caption      text,
  taken_at     timestamptz not null default now()
);
create index visit_photos_visit_ix on visit_photos (visit_id);

-- ============ ACTIVITÉS (suivi sur un contact) ============
create table activities (
  id          uuid primary key default uuid_generate_v4(),
  client_uuid uuid unique,
  type        activity_type not null,
  contact_id  uuid references contacts(id) on delete cascade,
  rep_id      uuid references users(id),
  content     text,
  created_at  timestamptz not null default now()
);
create index activities_contact_ix on activities (contact_id, created_at desc);

-- ============ LISTE NE-PAS-FRAPPER (liste noire globale) ============
create table do_not_knock_list (
  id       uuid primary key default uuid_generate_v4(),
  address  text,
  lat      double precision not null,
  lng      double precision not null,
  geom     geography(POINT,4326) generated always as
             (st_setsrid(st_makepoint(lng,lat),4326)::geography) stored,
  reason   text,
  added_by uuid references users(id),
  added_at timestamptz not null default now()
);
create index dnk_geom_gix on do_not_knock_list using gist (geom);

-- ============ CONFLITS DE SYNCHRONISATION ============
create table sync_conflicts (
  id          uuid primary key default uuid_generate_v4(),
  table_name  text not null,
  record_id   uuid,
  rep_id      uuid references users(id),
  local_data  jsonb,
  remote_data jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolution  text
);

-- ============ FONCTIONS UTILITAIRES ============
create or replace function current_user_role() returns user_role
  language sql stable security definer set search_path = public, extensions as
  $$ select role from users where id = auth.uid() $$;

create or replace function my_territory_ids() returns setof uuid
  language sql stable security definer set search_path = public, extensions as
  $$ select territory_id from user_territories where user_id = auth.uid() $$;

-- Proximité 20 m avec la liste ne-pas-frapper (revérifiée côté serveur).
create or replace function near_do_not_knock(p_lat double precision, p_lng double precision)
  returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from do_not_knock_list
    where st_dwithin(geom, st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography, 20)
  ) $$;

-- Le point est-il dans l'un des secteurs assignés au commercial ?
create or replace function point_in_my_turf(p_lat double precision, p_lng double precision)
  returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from territories t
    join user_territories ut on ut.territory_id = t.id
    where ut.user_id = auth.uid()
      and st_covers(t.polygon, st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography)
  ) $$;

-- ============ VUE : VISITES SIGNALÉES (anti-fraude, toujours à jour) ============
create or replace view flagged_visits with (security_invoker = on) as
with rates as (
  select rep_id, visited_at,
    count(*) over (partition by rep_id order by visited_at
      range between interval '1 hour' preceding and current row) as knocks_last_hour,
    lag(visited_at) over (partition by rep_id order by visited_at) as prev_at
  from visits where visit_type = 'd2d_knock'
)
select v.*,
  not exists (
    select 1 from territories t
    join user_territories ut on ut.territory_id = t.id and ut.user_id = v.rep_id
    where st_covers(t.polygon, v.geom)
  ) as out_of_turf,
  (r.knocks_last_hour > 40) as implausible_rate,
  (extract(epoch from (v.visited_at - r.prev_at)) < 3) as rapid_fire
from visits v
join rates r on r.rep_id = v.rep_id and r.visited_at = v.visited_at
where v.visit_type = 'd2d_knock'
  and (
    r.knocks_last_hour > 40
    or extract(epoch from (v.visited_at - r.prev_at)) < 3
    or not exists (
      select 1 from territories t
      join user_territories ut on ut.territory_id = t.id and ut.user_id = v.rep_id
      where st_covers(t.polygon, v.geom)
    )
  );

-- ============ CRÉATION AUTO public.users À L'INSCRIPTION ============
create or replace function handle_new_user() returns trigger
  language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.users (id, email, username, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- ============ ROW LEVEL SECURITY ============
alter table users             enable row level security;
alter table territories       enable row level security;
alter table user_territories  enable row level security;
alter table pipeline_stages   enable row level security;
alter table contacts          enable row level security;
alter table visits            enable row level security;
alter table visit_photos      enable row level security;
alter table activities        enable row level security;
alter table do_not_knock_list enable row level security;
alter table sync_conflicts    enable row level security;

-- users
create policy users_read  on users for select
  using (id = auth.uid() or current_user_role() in ('manager','admin'));
create policy users_admin on users for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- territories
create policy terr_read on territories for select
  using (id in (select my_territory_ids()) or current_user_role() in ('manager','admin'));
create policy terr_admin on territories for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- user_territories
create policy ut_read  on user_territories for select
  using (user_id = auth.uid() or current_user_role() in ('manager','admin'));
create policy ut_admin on user_territories for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- pipeline_stages : lecture par tous, écriture admin
create policy stages_read  on pipeline_stages for select using (true);
create policy stages_admin on pipeline_stages for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- contacts
create policy contacts_read on contacts for select
  using (territory_id in (select my_territory_ids())
         or assigned_rep_id = auth.uid()
         or current_user_role() in ('manager','admin'));
create policy contacts_ins on contacts for insert
  with check (territory_id in (select my_territory_ids())
              or current_user_role() in ('manager','admin'));
create policy contacts_upd on contacts for update
  using (territory_id in (select my_territory_ids())
         or assigned_rep_id = auth.uid()
         or current_user_role() in ('manager','admin'));

-- visits
create policy visits_read on visits for select
  using (rep_id = auth.uid() or current_user_role() in ('manager','admin'));
create policy visits_ins on visits for insert with check (rep_id = auth.uid());
create policy visits_upd on visits for update using (rep_id = auth.uid());

-- visit_photos (via la visite parente)
create policy photos_read on visit_photos for select
  using (exists (select 1 from visits v where v.id = visit_id
                 and (v.rep_id = auth.uid() or current_user_role() in ('manager','admin'))));
create policy photos_ins on visit_photos for insert
  with check (exists (select 1 from visits v where v.id = visit_id and v.rep_id = auth.uid()));

-- activities
create policy acts_read on activities for select
  using (rep_id = auth.uid() or current_user_role() in ('manager','admin'));
create policy acts_ins on activities for insert with check (rep_id = auth.uid());

-- do_not_knock : lecture par tous (nécessaire hors-ligne), écriture admin
create policy dnk_read  on do_not_knock_list for select using (true);
create policy dnk_admin on do_not_knock_list for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- sync_conflicts
create policy sc_ins  on sync_conflicts for insert with check (rep_id = auth.uid());
create policy sc_read on sync_conflicts for select
  using (rep_id = auth.uid() or current_user_role() in ('manager','admin'));
create policy sc_upd  on sync_conflicts for update
  using (current_user_role() in ('manager','admin'));

-- ============ DONNÉES INITIALES : étapes du pipeline (français) ============
insert into pipeline_stages (name, sort_order, is_won, is_lost) values
  ('Nouveau',         1, false, false),
  ('Contacté',        2, false, false),
  ('Intéressé',       3, false, false),
  ('RDV',             4, false, false),
  ('Négociation',     5, false, false),
  ('Gagné (Client)',  6, true,  false),
  ('Perdu',           7, false, true);

-- ====== 0002_functions.sql ======

-- =============================================================================
-- Fonctions RPC applicatives (appelées depuis l'app via supabase.rpc)
-- =============================================================================

-- Crée un secteur à partir d'un polygone GeoJSON dessiné dans l'admin.
-- Convertit le GeoJSON en geography(POLYGON,4326). Réservé aux admins.
create or replace function create_territory(
  p_name        text,
  p_type        territory_type,
  p_geojson     jsonb,
  p_description text default null
) returns uuid
  language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if current_user_role() is distinct from 'admin' then
    raise exception 'Non autorisé' using errcode = '42501';
  end if;

  insert into territories (name, type, polygon, description)
  values (
    p_name,
    p_type,
    st_setsrid(st_geomfromgeojson(p_geojson::text), 4326)::geography,
    nullif(trim(p_description), '')
  )
  returning id into v_id;

  return v_id;
end $$;

-- Renvoie les secteurs avec leur polygone en GeoJSON (pour affichage carte).
create or replace function territories_geojson()
  returns table (
    id         uuid,
    name       text,
    type       territory_type,
    created_at timestamptz,
    geojson    jsonb
  )
  language sql stable security definer set search_path = public, extensions as $$
  select t.id, t.name, t.type, t.created_at,
         st_asgeojson(t.polygon)::jsonb as geojson
  from territories t
  where current_user_role() in ('manager','admin')
     or t.id in (select my_territory_ids())
  order by t.created_at desc
$$;

-- ====== 0003_storage.sql ======

-- =============================================================================
-- Stockage des photos de visite (preuve de passage géo-horodatée)
-- Bucket privé + politiques RLS sur storage.objects.
-- Chemin des objets : <uid_du_commercial>/<uuid>.jpg
-- =============================================================================

-- Bucket privé (accès uniquement via RLS / URLs signées)
insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', false)
on conflict (id) do nothing;

-- Un commercial téléverse uniquement dans SON dossier (préfixe = son uid).
create policy "visit_photos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lecture : le propriétaire, ou un manager / admin.
create policy "visit_photos_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'visit-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.current_user_role() in ('manager', 'admin')
    )
  );

-- Suppression : le propriétaire ou un admin (archivage à venir).
create policy "visit_photos_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'visit-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.current_user_role() = 'admin'
    )
  );

-- ====== 0004_shared_contacts.sql ======

-- =============================================================================
-- Contacts partagés : un contact a un commercial assigné (par défaut), mais
-- TOUS les commerciaux peuvent le consulter, enregistrer des activités/visites
-- et voir le journal complet (qui a fait quoi).
-- =============================================================================

-- Contacts : lecture / création / mise à jour par tout commercial connecté.
drop policy if exists contacts_read on contacts;
create policy contacts_read on contacts for select using (auth.uid() is not null);

drop policy if exists contacts_ins on contacts;
create policy contacts_ins on contacts for insert with check (auth.uid() is not null);

drop policy if exists contacts_upd on contacts;
create policy contacts_upd on contacts for update using (auth.uid() is not null);

-- Activités : tout le monde voit le journal complet (chaque insert garde rep_id).
drop policy if exists acts_read on activities;
create policy acts_read on activities for select using (auth.uid() is not null);

-- Visites : lecture partagée (le fil d'un contact montre toutes les visites).
drop policy if exists visits_read on visits;
create policy visits_read on visits for select using (auth.uid() is not null);

-- Photos de visite : lecture partagée (miniatures dans le fil).
drop policy if exists photos_read on visit_photos;
create policy photos_read on visit_photos for select using (auth.uid() is not null);


-- ====== 0005_technicians.sql ======

-- =============================================================================
-- Technicians + installation protocol. A technician installs the product on
-- site once a customer is won. Installation trips reuse `visits`
-- (visit_type='installation'); the protocol lives in `installations`.
-- =============================================================================

alter type user_role  add value if not exists 'technician';
alter type visit_type add value if not exists 'installation';

do $$ begin
  create type install_status as enum
    ('pending','scheduled','in_progress','done','needs_revisit');
exception when duplicate_object then null; end $$;

create table if not exists installations (
  id              uuid primary key default uuid_generate_v4(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  title           text,
  installer_id    uuid references users(id),
  status          install_status not null default 'pending',
  checklist       jsonb not null default '[]',
  equipment       jsonb not null default '[]',
  scheduled_date  date,
  started_at      timestamptz,
  completed_at    timestamptz,
  next_visit_date date,
  notes           text,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists installations_contact_ix   on installations (contact_id);
create index if not exists installations_installer_ix on installations (installer_id);
create index if not exists installations_status_ix    on installations (status);

alter table installations enable row level security;

drop policy if exists installations_read on installations;
create policy installations_read on installations for select using (auth.uid() is not null);
drop policy if exists installations_ins on installations;
create policy installations_ins on installations for insert with check (auth.uid() is not null);
drop policy if exists installations_upd on installations;
create policy installations_upd on installations for update using (auth.uid() is not null);


-- ====== 0006_install_protocol.sql ======

create table if not exists install_protocol_steps (
  id         uuid primary key default uuid_generate_v4(),
  key        text not null,
  label      text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists install_protocol_order_ix on install_protocol_steps (sort_order);

alter table install_protocol_steps enable row level security;

drop policy if exists ips_read on install_protocol_steps;
create policy ips_read on install_protocol_steps for select using (auth.uid() is not null);
drop policy if exists ips_admin on install_protocol_steps;
create policy ips_admin on install_protocol_steps for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

insert into install_protocol_steps (key, label, sort_order)
select * from (values
  ('site_ready',        'Site préparé',        1),
  ('unit_mounted',      'Unité montée',        2),
  ('wiring',            'Câblage effectué',    3),
  ('power_on',          'Mise sous tension',   4),
  ('function_test',     'Test fonctionnel',    5),
  ('customer_training', 'Formation client',    6)
) as v(key, label, sort_order)
where not exists (select 1 from install_protocol_steps);


-- ====== 0007_deals.sql ======

do $$ begin
  create type deal_status as enum ('open','won','lost');
exception when duplicate_object then null; end $$;

create table if not exists deals (
  id                 uuid primary key default uuid_generate_v4(),
  contact_id         uuid not null references contacts(id) on delete cascade,
  title              text,
  value_xof          bigint,
  pipeline_stage_id  uuid references pipeline_stages(id),
  status             deal_status not null default 'open',
  needs_installation boolean not null default false,
  lost_reason        text,
  assigned_rep_id    uuid references users(id),
  won_at             timestamptz,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists deals_contact_ix on deals (contact_id);
create index if not exists deals_stage_ix   on deals (pipeline_stage_id);
create index if not exists deals_status_ix  on deals (status);
create index if not exists deals_rep_ix     on deals (assigned_rep_id);

alter table installations add column if not exists deal_id uuid references deals(id) on delete cascade;
create index if not exists installations_deal_ix on installations (deal_id);

alter table deals enable row level security;
drop policy if exists deals_read on deals;
create policy deals_read on deals for select using (auth.uid() is not null);
drop policy if exists deals_ins on deals;
create policy deals_ins on deals for insert with check (auth.uid() is not null);
drop policy if exists deals_upd on deals;
create policy deals_upd on deals for update using (auth.uid() is not null);
drop policy if exists deals_del on deals;
create policy deals_del on deals for delete using (auth.uid() is not null);

alter table visits add column if not exists deal_id uuid references deals(id) on delete set null;
create index if not exists visits_deal_ix on visits (deal_id);


-- ====== 0009_products.sql ======

create table if not exists products (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null,
  price_xof      bigint not null default 0,
  commission_pct numeric(5,2) not null default 0,
  is_active      boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists products_order_ix on products (sort_order);
alter table products enable row level security;
drop policy if exists products_read on products;
create policy products_read on products for select using (auth.uid() is not null);
drop policy if exists products_admin on products;
create policy products_admin on products for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

alter table deals add column if not exists product_id uuid references products(id);
create index if not exists deals_product_ix on deals (product_id);
-- =============================================================================
-- 0011 — AI assistant usage tracking
-- One row per user per day; the assistant route increments `questions` and
-- refuses once the daily cap is reached (cap lives in code: lib/ai/config.ts).
-- =============================================================================

create table if not exists ai_usage (
  user_id   uuid not null references users(id) on delete cascade,
  day       date not null,
  questions int  not null default 0,
  primary key (user_id, day)
);

alter table ai_usage enable row level security;
drop policy if exists ai_usage_own on ai_usage;
create policy ai_usage_own on ai_usage for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- =============================================================================
-- 0012 — Leaderboard extras
-- app_settings: small key/value store (first use: admin-configurable
-- leaderboard point values). daily_recaps: the AI-written daily recap shown
-- on the leaderboard (written by the server with the service role).
-- =============================================================================

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select using (auth.uid() is not null);
drop policy if exists settings_admin on app_settings;
create policy settings_admin on app_settings for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

create table if not exists daily_recaps (
  day        date primary key,
  content    text not null,
  created_at timestamptz not null default now()
);
alter table daily_recaps enable row level security;
drop policy if exists recaps_read on daily_recaps;
create policy recaps_read on daily_recaps for select using (auth.uid() is not null);
-- Writes happen via the service-role key only (no insert/update policy).
-- =============================================================================
-- 0013 — Photos de profil
-- Bucket PUBLIC `avatars` (lecture par URL publique — contenu peu sensible),
-- écriture limitée au dossier de l'utilisateur. Chemin : <uid>/avatar-<ts>.jpg
-- =============================================================================

alter table users add column if not exists avatar_path text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.current_user_role() = 'admin'
    )
  );
-- =============================================================================
-- 0014 — Interlocuteurs (contact persons per business)
-- A business (contacts row) can have several people — gérant, chef de projet,
-- comptable… Each deal can point at the person it is negotiated with.
-- =============================================================================

create table if not exists contact_people (
  id         uuid primary key default uuid_generate_v4(),
  contact_id uuid not null references contacts(id) on delete cascade,
  name       text not null,
  role       text,                                   -- « Gérant », « Chef de projet »…
  phone      text,
  email      text,
  notes      text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists contact_people_contact_ix on contact_people (contact_id);

alter table contact_people enable row level security;
drop policy if exists contact_people_all on contact_people;
create policy contact_people_all on contact_people for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- The person a deal is negotiated with (survives person deletion as NULL).
alter table deals add column if not exists contact_person_id uuid references contact_people(id) on delete set null;
-- =============================================================================
-- 0015 — Secteurs activables/désactivables
-- `is_active` sur territories. Un secteur désactivé disparaît des cartes, des
-- filtres et des contrôles hors-zone, mais reste en base (réactivable) et
-- visible dans l'admin.
-- =============================================================================

alter table territories add column if not exists is_active boolean not null default true;

-- Les cartes/filtres ne renvoient que les secteurs ACTIFS.
create or replace function territories_geojson()
  returns table (
    id         uuid,
    name       text,
    type       territory_type,
    created_at timestamptz,
    geojson    jsonb
  )
  language sql stable security definer set search_path = public, extensions as $$
  select t.id, t.name, t.type, t.created_at,
         st_asgeojson(t.polygon)::jsonb as geojson
  from territories t
  where t.is_active
    and (current_user_role() in ('manager','admin')
         or t.id in (select my_territory_ids()))
  order by t.created_at desc
$$;

-- Le contrôle « dans mon secteur ? » ignore les secteurs désactivés.
create or replace function point_in_my_turf(p_lat double precision, p_lng double precision)
  returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from territories t
    join user_territories ut on ut.territory_id = t.id
    where ut.user_id = auth.uid()
      and t.is_active
      and st_covers(t.polygon, st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography)
  ) $$;

-- Vue anti-fraude : un secteur désactivé ne « couvre » plus une visite.
-- DROP obligatoire : `visits` a gagné des colonnes depuis la création de la
-- vue (v.* change) et CREATE OR REPLACE refuse un changement de colonnes.
drop view if exists flagged_visits;
create view flagged_visits with (security_invoker = on) as
with rates as (
  select rep_id, visited_at,
    count(*) over (partition by rep_id order by visited_at
      range between interval '1 hour' preceding and current row) as knocks_last_hour,
    lag(visited_at) over (partition by rep_id order by visited_at) as prev_at
  from visits where visit_type = 'd2d_knock'
)
select v.*,
  not exists (
    select 1 from territories t
    join user_territories ut on ut.territory_id = t.id and ut.user_id = v.rep_id
    where t.is_active
      and st_covers(t.polygon, v.geom)
  ) as out_of_turf,
  (r.knocks_last_hour > 40) as implausible_rate,
  (extract(epoch from (v.visited_at - r.prev_at)) < 3) as rapid_fire
from visits v
join rates r on r.rep_id = v.rep_id and r.visited_at = v.visited_at
where v.visit_type = 'd2d_knock'
  and (
    r.knocks_last_hour > 40
    or extract(epoch from (v.visited_at - r.prev_at)) < 3
    or not exists (
      select 1 from territories t
      join user_territories ut on ut.territory_id = t.id and ut.user_id = v.rep_id
      where t.is_active
        and st_covers(t.polygon, v.geom)
    )
  );
-- =============================================================================
-- 0016 — Étapes du pipeline : clés système
-- Les automatismes (visite « Intéressé »/« RDV »/« Vendu » → étape) ciblaient
-- l'étape PAR NOM, ce qui interdisait de renommer. `system_key` identifie ces
-- étapes de façon stable ; l'éditeur admin peut alors renommer librement.
-- =============================================================================

alter table pipeline_stages add column if not exists system_key text unique;

update pipeline_stages set system_key = 'interested' where name = 'Intéressé'      and system_key is null;
update pipeline_stages set system_key = 'rdv'        where name = 'RDV'            and system_key is null;
update pipeline_stages set system_key = 'won'        where is_won                  and system_key is null;
update pipeline_stages set system_key = 'lost'       where is_lost                 and system_key is null;
-- =============================================================================
-- 0017 — Brief manager quotidien
-- Version détaillée du récap (par commercial / par technicien, avec CA et
-- points d'attention). Table séparée : la lecture est réservée aux
-- managers/admins (le récap public reste lisible par tous).
-- =============================================================================

create table if not exists manager_recaps (
  day        date primary key,
  content    text not null,
  created_at timestamptz not null default now()
);
alter table manager_recaps enable row level security;
drop policy if exists manager_recaps_read on manager_recaps;
create policy manager_recaps_read on manager_recaps for select
  using (current_user_role() in ('manager','admin'));
-- Écriture via la clé service uniquement (pas de policy d'insert/update).

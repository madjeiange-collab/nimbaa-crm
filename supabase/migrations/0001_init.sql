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
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  type       territory_type not null,
  manager_id uuid references users(id),
  polygon    geography(POLYGON,4326),
  created_at timestamptz not null default now()
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

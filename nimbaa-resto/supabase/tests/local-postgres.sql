-- Doublures de Supabase, pour faire tourner les migrations et la sonde sur un
-- Postgres nu — en intégration continue, ou sur votre machine.
--
-- À NE JAMAIS appliquer à un projet Supabase : là-bas, auth et storage
-- existent déjà, tenus par Supabase, et les recréer casserait le projet.
--
-- Ce que ces tables reproduisent, c'est uniquement ce dont les migrations et
-- la sonde ont besoin. GoTrue et PostgREST ne sont pas simulés : ce sont les
-- nôtres, de policies, qu'on éprouve ici.

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  email              text unique,
  phone              text unique,
  encrypted_password text,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);

-- Chez Supabase, auth.uid() lit la revendication « sub » du jeton. Ici on la
-- pose à la main : c'est ce qui permet à la sonde de jouer trois personnes
-- différentes dans une seule transaction.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  -- bypassrls comme chez Supabase : sans cela la clé de service est soumise
  -- aux policies, et le script d'amorçage ne peut plus rien créer.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role bypassrls;
  end if;
  alter role service_role bypassrls;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;

create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

-- « menu/<restaurant>/x.webp » → {menu, <restaurant>}. Le premier dossier est
-- le restaurant : c'est sur cela que reposent les policies de la 0004.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end $$;

grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;

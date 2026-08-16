-- =============================================================================
-- 0010 — Territory description
-- A free-text "covers roughly…" line shown under each secteur in the admin
-- list. Optional; admin fills it when drawing a secteur.
-- =============================================================================

alter table territories add column if not exists description text;

-- Recreate create_territory with the new optional description parameter.
-- (Drop the old 3-arg signature so PostgREST doesn't see two overloads.)
drop function if exists create_territory(text, territory_type, jsonb);
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

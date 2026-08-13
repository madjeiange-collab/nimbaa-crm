-- =============================================================================
-- Fonctions RPC applicatives (appelées depuis l'app via supabase.rpc)
-- =============================================================================

-- Crée un secteur à partir d'un polygone GeoJSON dessiné dans l'admin.
-- Convertit le GeoJSON en geography(POLYGON,4326). Réservé aux admins.
create or replace function create_territory(
  p_name    text,
  p_type    territory_type,
  p_geojson jsonb
) returns uuid
  language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if current_user_role() is distinct from 'admin' then
    raise exception 'Non autorisé' using errcode = '42501';
  end if;

  insert into territories (name, type, polygon)
  values (
    p_name,
    p_type,
    st_setsrid(st_geomfromgeojson(p_geojson::text), 4326)::geography
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

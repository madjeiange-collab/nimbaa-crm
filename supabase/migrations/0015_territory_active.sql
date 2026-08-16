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

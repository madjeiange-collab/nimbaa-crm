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

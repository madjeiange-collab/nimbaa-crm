-- Sonde d'étanchéité — trois acteurs, aucune ligne ne doit franchir la
-- frontière. À rejouer après CHAQUE migration : toute table ajoutée gagne sa
-- ligne ici dans le même commit que sa migration.
--
-- Tout se déroule dans une transaction annulée à la fin : la sonde ne laisse
-- rien derrière elle.
begin;

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-00000000000a','probe-a@test.invalid'),
  ('f0000000-0000-4000-8000-00000000000b','probe-b@test.invalid'),
  ('f0000000-0000-4000-8000-00000000000c','probe-c@test.invalid');
insert into restaurants (id, slug, name) values
  ('aaaaaaaa-0000-0000-0000-00000000000a','probe-a','Restaurant A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','probe-b','Restaurant B');
insert into restaurant_members values
  ('aaaaaaaa-0000-0000-0000-00000000000a','f0000000-0000-4000-8000-00000000000a','owner',true,now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','f0000000-0000-4000-8000-00000000000b','owner',true,now());

create or replace function pg_temp.as_user(sub uuid) returns void
language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', sub::text, true);
end $$;

create or replace function pg_temp.check(label text, got bigint, want bigint)
returns text language sql as $$
  select case when got = want then '  OK   ' else '  ÉCHEC' end
         || ' · ' || label || ' — attendu ' || want || ', obtenu ' || got;
$$;

set local role authenticated;

-- Le patron de A ne voit que A.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000000a');
select pg_temp.check('A voit les restaurants',      (select count(*) from restaurants), 1);
select pg_temp.check('A voit les membres',          (select count(*) from restaurant_members), 1);
select pg_temp.check('A ne voit pas B',
       (select count(*) from restaurants where slug = 'probe-b'), 0);

-- Le patron de B ne voit que B.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000000b');
select pg_temp.check('B ne voit pas A',
       (select count(*) from restaurants where slug = 'probe-a'), 0);

-- Le convive ne voit rien du tout.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000000c');
select pg_temp.check('Le convive ne voit aucun restaurant', (select count(*) from restaurants), 0);
select pg_temp.check('Le convive ne voit aucun membre',     (select count(*) from restaurant_members), 0);

reset role;
rollback;

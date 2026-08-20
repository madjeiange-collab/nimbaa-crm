-- Sonde du contexte employé — les requêtes que getStaffContext() exécute
-- réellement, jouées sous RLS avec de vrais acteurs.
--
-- Elle existe parce qu'elle a déjà trouvé un bug : un serveur ne peut PAS
-- lever son propre must_change_password par un UPDATE direct (la policy
-- sa_manage est réservée au patron et au gérant), et RLS ne renvoie pas
-- d'erreur — il filtre. L'UPDATE touchait zéro ligne en silence et l'employé
-- était renvoyé vers la page de mot de passe à chaque requête, indéfiniment.
--
-- Tout se déroule dans une transaction annulée : la sonde ne laisse rien.
begin;

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-00000000a001','probe-patron@test.invalid'),
  ('f0000000-0000-4000-8000-00000000a002','probe-serveur@test.invalid'),
  ('f0000000-0000-4000-8000-00000000b001','probe-autre@test.invalid');
insert into restaurants (id, slug, name) values
  ('f0000000-0000-4000-8000-0000000aaaaa','probe-a','Restaurant A'),
  ('f0000000-0000-4000-8000-0000000bbbbb','probe-b','Restaurant B');
insert into restaurant_members values
  ('f0000000-0000-4000-8000-0000000aaaaa','f0000000-0000-4000-8000-00000000a001','owner',true,now()),
  ('f0000000-0000-4000-8000-0000000aaaaa','f0000000-0000-4000-8000-00000000a002','waiter',true,now()),
  ('f0000000-0000-4000-8000-0000000bbbbb','f0000000-0000-4000-8000-00000000b001','owner',true,now());
insert into staff_accounts (user_id, restaurant_id, username, must_change_password) values
  ('f0000000-0000-4000-8000-00000000a001','f0000000-0000-4000-8000-0000000aaaaa','probe-patron',false),
  ('f0000000-0000-4000-8000-00000000a002','f0000000-0000-4000-8000-0000000aaaaa','probe-serveur',true),
  ('f0000000-0000-4000-8000-00000000b001','f0000000-0000-4000-8000-0000000bbbbb','probe-autre',false);

create or replace function pg_temp.as_user(sub uuid) returns void
language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', sub::text, true);
end $$;

create or replace function pg_temp.check(label text, got text, want text)
returns text language sql as $$
  select case when got is not distinct from want then '  OK   ' else '  ÉCHEC' end
         || ' · ' || label || ' — attendu ' || coalesce(want,'∅')
         || ', obtenu ' || coalesce(got,'∅');
$$;

set local role authenticated;

-- 1. Le serveur ouvre /r/probe-a : la lecture du restaurant EST le contrôle
--    d'appartenance, puisque la policy vaut is_member(id).
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a002');
select pg_temp.check('le serveur voit son restaurant',
       (select name from restaurants where slug = 'probe-a'), 'Restaurant A');
select pg_temp.check('le serveur a son rôle',
       (select string_agg(role, ',') from restaurant_members
         where restaurant_id = (select id from restaurants where slug = 'probe-a')
           and user_id = auth.uid() and active), 'waiter');
select pg_temp.check('le serveur lit son compte',
       (select username from staff_accounts where user_id = auth.uid()), 'probe-serveur');

-- 2. Le même serveur tape /r/probe-b : aucune ligne, donc redirection login.
select pg_temp.check('le serveur ne voit pas l''autre restaurant',
       (select name from restaurants where slug = 'probe-b'), null);

-- 3. LA RÉGRESSION : l'UPDATE direct doit rester sans effet…
update staff_accounts set must_change_password = false where user_id = auth.uid();
select pg_temp.check('UPDATE direct sans effet (RLS filtre, n''échoue pas)',
       (select must_change_password::text from staff_accounts where user_id = auth.uid()), 'true');

-- …et la fonction dédiée doit, elle, lever le drapeau.
select clear_must_change_password();
select pg_temp.check('clear_must_change_password() lève le drapeau',
       (select must_change_password::text from staff_accounts where user_id = auth.uid()), 'false');

-- 4. Et elle ne peut lever que le sien.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000b001');
update staff_accounts set must_change_password = true where username = 'probe-serveur';
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a001');
select pg_temp.check('un patron ne lève pas le drapeau d''autrui par la fonction',
       (select must_change_password::text from staff_accounts where username = 'probe-serveur'), 'false');

reset role;
rollback;

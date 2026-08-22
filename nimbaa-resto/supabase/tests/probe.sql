-- Sonde de la plateforme. Trois acteurs, deux organisations, et le droit
-- d'accès qui dépend d'un abonnement.
--
-- À rejouer après CHAQUE migration : toute table ajoutée gagne sa ligne ici,
-- dans le même commit que sa migration. Tout se déroule dans une transaction
-- annulée : la sonde ne laisse rien derrière elle.
begin;

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-00000000a001','probe-patron@test.invalid'),
  ('f0000000-0000-4000-8000-00000000a002','probe-serveur@test.invalid'),
  ('f0000000-0000-4000-8000-00000000b001','probe-autre@test.invalid');

insert into core.organizations (id, slug, name, country, currency) values
  ('f0000000-0000-4000-8000-0000000aaaaa','probe-a','Groupe A','CI','XOF'),
  ('f0000000-0000-4000-8000-0000000bbbbb','probe-b','Groupe B','CI','XOF');
insert into core.org_members values
  ('f0000000-0000-4000-8000-0000000aaaaa','f0000000-0000-4000-8000-00000000a001','owner',true,now()),
  ('f0000000-0000-4000-8000-0000000aaaaa','f0000000-0000-4000-8000-00000000a002','member',true,now()),
  ('f0000000-0000-4000-8000-0000000bbbbb','f0000000-0000-4000-8000-00000000b001','owner',true,now());
insert into core.product_subscriptions (org_id, product, status) values
  ('f0000000-0000-4000-8000-0000000aaaaa','resto','active'),
  ('f0000000-0000-4000-8000-0000000bbbbb','resto','active');
insert into core.product_access values
  ('f0000000-0000-4000-8000-0000000aaaaa','f0000000-0000-4000-8000-00000000a001','resto','owner',true,now()),
  ('f0000000-0000-4000-8000-0000000aaaaa','f0000000-0000-4000-8000-00000000a002','resto','waiter',true,now()),
  ('f0000000-0000-4000-8000-0000000bbbbb','f0000000-0000-4000-8000-00000000b001','resto','owner',true,now());

-- Groupe A tient deux lieux : Abidjan hérite du XOF, Paris déclare l'EUR.
insert into resto.restaurants (id, org_id, slug, name, currency) values
  ('f0000000-0000-4000-8000-00000000c001','f0000000-0000-4000-8000-0000000aaaaa','probe-abidjan','A · Abidjan', null),
  ('f0000000-0000-4000-8000-00000000c002','f0000000-0000-4000-8000-0000000aaaaa','probe-paris',  'A · Paris',   'EUR');
insert into resto.restaurants (id, org_id, slug, name) values
  ('f0000000-0000-4000-8000-00000000d001','f0000000-0000-4000-8000-0000000bbbbb','probe-b1','B · Un');
insert into resto.staff_accounts (user_id, restaurant_id, username) values
  ('f0000000-0000-4000-8000-00000000a001','f0000000-0000-4000-8000-00000000c001','probe-patron'),
  ('f0000000-0000-4000-8000-00000000a002','f0000000-0000-4000-8000-00000000c001','probe-serveur'),
  ('f0000000-0000-4000-8000-00000000b001','f0000000-0000-4000-8000-00000000d001','probe-autre');

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

-- ------------------------------------------------------- monnaie héritée
select pg_temp.check('Abidjan hérite du XOF de son organisation',
       resto.currency_of('f0000000-0000-4000-8000-00000000c001'), 'XOF');
select pg_temp.check('Paris impose son EUR',
       resto.currency_of('f0000000-0000-4000-8000-00000000c002'), 'EUR');
select pg_temp.check('XOF n''a pas de décimale', core.decimals_of('XOF')::text, '0');
select pg_temp.check('EUR en a deux',            core.decimals_of('EUR')::text, '2');

set local role authenticated;

-- ------------------------------------------------------------ étanchéité
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a002');
select pg_temp.check('le serveur voit les lieux de son groupe',
       (select string_agg(name, ', ' order by name) from resto.restaurants),
       'A · Abidjan, A · Paris');
select pg_temp.check('le serveur ne voit pas l''autre groupe',
       (select count(*)::text from resto.restaurants where slug = 'probe-b1'), '0');
select pg_temp.check('le serveur lit son compte',
       (select username from resto.staff_accounts where user_id = auth.uid()), 'probe-serveur');

-- ------------------------------------------------- le drapeau mot de passe
select pg_temp.check('drapeau posé à la création',
       (select must_change_password::text from resto.staff_accounts where user_id = auth.uid()), 'true');
update resto.staff_accounts set must_change_password = false where user_id = auth.uid();
select pg_temp.check('UPDATE direct sans effet (RLS filtre, n''échoue pas)',
       (select must_change_password::text from resto.staff_accounts where user_id = auth.uid()), 'true');
select resto.clear_must_change_password();
select pg_temp.check('la fonction dédiée lève le drapeau',
       (select must_change_password::text from resto.staff_accounts where user_id = auth.uid()), 'false');

-- --------------------------------------------------------- l'abonnement
reset role;
update core.product_subscriptions set status = 'cancelled'
 where org_id = 'f0000000-0000-4000-8000-0000000aaaaa';
set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a002');
select pg_temp.check('abonnement résilié → plus rien',
       (select count(*)::text from resto.restaurants), '0');

reset role;
update core.product_subscriptions set status = 'past_due', grace_until = now() + interval '7 days'
 where org_id = 'f0000000-0000-4000-8000-0000000aaaaa';
set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a002');
select pg_temp.check('impayé mais dans la grâce → toujours servi',
       (select count(*)::text from resto.restaurants), '2');

reset role;
update core.product_subscriptions set status = 'past_due', grace_until = now() - interval '1 day'
 where org_id = 'f0000000-0000-4000-8000-0000000aaaaa';
set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a002');
select pg_temp.check('grâce expirée → coupé',
       (select count(*)::text from resto.restaurants), '0');

-- ------------------------------------------- membre sans accès au produit
reset role;
update core.product_subscriptions set status = 'active', grace_until = null
 where org_id = 'f0000000-0000-4000-8000-0000000aaaaa';
delete from core.product_access
 where user_id = 'f0000000-0000-4000-8000-00000000a002' and product = 'resto';
set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a002');
select pg_temp.check('membre de l''organisation, sans accès resto → rien',
       (select count(*)::text from resto.restaurants), '0');

-- --------------------------------------------------------------- inconnu
select pg_temp.as_user('f0000000-0000-4000-8000-000000000099');
select pg_temp.check('inconnu → rien',
       (select count(*)::text from resto.restaurants), '0');

reset role;
rollback;

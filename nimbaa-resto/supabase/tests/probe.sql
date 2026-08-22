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

-- ---------------------------------------------------- la carte et la salle
-- Un serveur lit la carte ; il ne la change pas. Un patron fait les deux.
reset role;
insert into core.product_access values
  ('f0000000-0000-4000-8000-0000000aaaaa','f0000000-0000-4000-8000-00000000a002','resto','waiter',true,now())
  on conflict do nothing;
insert into resto.prep_stations (id, restaurant_id, name) values
  ('f0000000-0000-4000-8000-00000000e001','f0000000-0000-4000-8000-00000000c001','Cuisine');
insert into resto.menu_categories (id, restaurant_id, name) values
  ('f0000000-0000-4000-8000-00000000e002','f0000000-0000-4000-8000-00000000c001','Plats');
insert into resto.menu_items (restaurant_id, category_id, name, price, prep_station_id) values
  ('f0000000-0000-4000-8000-00000000c001','f0000000-0000-4000-8000-00000000e002','Poisson braisé', 3500,
   'f0000000-0000-4000-8000-00000000e001');
insert into resto.menu_items (restaurant_id, category_id, name, price) values
  ('f0000000-0000-4000-8000-00000000c001','f0000000-0000-4000-8000-00000000e002','Eau minérale', 500);
insert into resto.areas (id, restaurant_id, name) values
  ('f0000000-0000-4000-8000-00000000e003','f0000000-0000-4000-8000-00000000c001','Terrasse');
insert into resto.tables (restaurant_id, area_id, label, seats) values
  ('f0000000-0000-4000-8000-00000000c001','f0000000-0000-4000-8000-00000000e003','12', 4);
set local role authenticated;

select pg_temp.as_user('f0000000-0000-4000-8000-00000000a002');
select pg_temp.check('le serveur lit la carte',
       (select count(*)::text from resto.menu_items), '2');
select pg_temp.check('le serveur lit la salle',
       (select label from resto.tables), '12');
select pg_temp.check('le poisson passe par un poste',
       (select case when prep_station_id is null then 'direct' else 'poste' end
          from resto.menu_items where name = 'Poisson braisé'), 'poste');
select pg_temp.check('l''eau est servie directement',
       (select case when prep_station_id is null then 'direct' else 'poste' end
          from resto.menu_items where name = 'Eau minérale'), 'direct');

-- Le serveur ne change pas les prix.
update resto.menu_items set price = 1 where name = 'Poisson braisé';
select pg_temp.check('le serveur ne change pas un prix (RLS filtre)',
       (select price::text from resto.menu_items where name = 'Poisson braisé'), '3500');
-- RLS ne se comporte pas pareil selon le verbe, et c'est important pour le
-- code applicatif : SELECT, UPDATE et DELETE FILTRENT — zéro ligne, aucune
-- erreur — tandis qu'INSERT LÈVE une erreur sur le with check. Un appel qui
-- « réussit » sans rien faire et un appel qui explose ne se rattrapent pas de
-- la même façon.
create or replace function pg_temp.try_insert() returns text
language plpgsql as $$ begin
  insert into resto.menu_items (restaurant_id, name, price)
    values ('f0000000-0000-4000-8000-00000000c001','Ajout interdit', 100);
  return 'passé';
exception when insufficient_privilege then return 'refusé';
end $$;
select pg_temp.check('le serveur n''ajoute pas de plat (INSERT lève)',
       pg_temp.try_insert(), 'refusé');
select pg_temp.check('et la carte n''a pas bougé',
       (select count(*)::text from resto.menu_items), '2');

-- Le patron, si.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a001');
update resto.menu_items set price = 4000 where name = 'Poisson braisé';
select pg_temp.check('le patron change le prix',
       (select price::text from resto.menu_items where name = 'Poisson braisé'), '4000');

-- Et la carte de l'autre groupe reste invisible.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000b001');
select pg_temp.check('l''autre groupe ne voit pas cette carte',
       (select count(*)::text from resto.menu_items), '0');

-- ------------------------------------------------------------ l'ordre
-- « La position est une mémoire » : si l'ordre bouge, la mémoire spatiale de
-- l'équipe ne vaut plus rien. On vérifie donc qu'il se contrôle et qu'il tient.
reset role;
insert into resto.menu_categories (restaurant_id, name) values
  ('f0000000-0000-4000-8000-00000000c001','Boissons'),
  ('f0000000-0000-4000-8000-00000000c001','Desserts');
set local role authenticated;
-- Reprendre l'identité du patron de A : le bloc précédent s'est terminé sur le
-- patron de B, pour qui cette carte n'existe pas.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a001');

select pg_temp.check('les catégories se rangent à la suite',
       (select string_agg(name, ' → ' order by sort) from resto.menu_categories
         where restaurant_id = 'f0000000-0000-4000-8000-00000000c001'),
       'Plats → Boissons → Desserts');

select pg_temp.as_user('f0000000-0000-4000-8000-00000000a001');   -- patron
select resto.move_category(
  (select id from resto.menu_categories where name = 'Desserts'), -1);
select pg_temp.check('le patron remonte une catégorie',
       (select string_agg(name, ' → ' order by sort) from resto.menu_categories
         where restaurant_id = 'f0000000-0000-4000-8000-00000000c001'),
       'Plats → Desserts → Boissons');

select resto.move_category(
  (select id from resto.menu_categories where name = 'Plats'), -1);
select pg_temp.check('en tête de liste, monter ne fait rien',
       (select string_agg(name, ' → ' order by sort) from resto.menu_categories
         where restaurant_id = 'f0000000-0000-4000-8000-00000000c001'),
       'Plats → Desserts → Boissons');

-- move_category est SECURITY DEFINER : RLS ne s'applique PAS à l'intérieur, et
-- c'est son contrôle explicite qui protège. Donc on lui passe un identifiant
-- connu plutôt que de le chercher — sinon on testerait la visibilité, qui
-- n'est pas ce qui garde la porte ici.
create temporary table probe_ids as
  select id from resto.menu_categories where name = 'Plats';

create or replace function pg_temp.try_move() returns text
language plpgsql as $$ begin
  perform resto.move_category((select id from probe_ids), 1);
  return 'passé';
exception
  when insufficient_privilege then return 'refusé';
  when others then return 'erreur:' || sqlstate;
end $$;

select pg_temp.as_user('f0000000-0000-4000-8000-00000000a002');   -- serveur
select pg_temp.check('le serveur ne réordonne pas la carte', pg_temp.try_move(), 'refusé');
select pg_temp.check('et l''ordre n''a pas bougé',
       (select string_agg(name, ' → ' order by sort) from resto.menu_categories
         where restaurant_id = 'f0000000-0000-4000-8000-00000000c001'),
       'Plats → Desserts → Boissons');

-- Le patron d'un autre groupe connaît l'identifiant — il ne passe pas non plus.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000b001');
select pg_temp.check('ni le patron d''un autre groupe, identifiant en main',
       pg_temp.try_move(), 'refusé');

-- Supprimer une catégorie ne supprime pas ce qu'elle contenait.
reset role;
delete from resto.menu_categories where name = 'Plats';
set local role authenticated;
select pg_temp.as_user('f0000000-0000-4000-8000-00000000a001');
select pg_temp.check('supprimer une catégorie garde ses plats',
       (select count(*)::text from resto.menu_items
         where restaurant_id = 'f0000000-0000-4000-8000-00000000c001'), '2');
select pg_temp.check('...qui se retrouvent sans catégorie',
       (select count(*)::text from resto.menu_items
         where restaurant_id = 'f0000000-0000-4000-8000-00000000c001'
           and category_id is null), '2');

-- ------------------------------------------------------ les photos du seau
-- Le premier dossier du chemin EST l'identifiant du restaurant, donc la policy
-- sait à qui appartient la photo sans rien joindre. Reste à vérifier qu'elle
-- refuse bien le dossier du voisin.
--
-- Sur un Postgres nu, storage n'existe pas : on saute plutôt que d'échouer.
do $$
declare a uuid := 'f0000000-0000-4000-8000-00000000c001';   -- A · Abidjan
        b uuid := 'f0000000-0000-4000-8000-00000000d001';   -- B · Un
        patron_a uuid := 'f0000000-0000-4000-8000-00000000a001';
        serveur_a uuid := 'f0000000-0000-4000-8000-00000000a002';
        verdict text;
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice '  SAUTÉ · policies du seau (schéma storage absent)';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', patron_a::text, true);
  execute 'set local role authenticated';

  begin
    insert into storage.objects (bucket_id, name) values ('menu', a::text || '/plat.webp');
    verdict := 'accepté';
  exception when insufficient_privilege then verdict := 'refusé';
  end;
  raise notice '%', (select case when verdict = 'accepté' then '  OK   ' else '  ÉCHEC' end
    || ' · le patron dépose une photo chez lui — attendu accepté, obtenu ' || verdict);

  begin
    insert into storage.objects (bucket_id, name) values ('menu', b::text || '/vol.webp');
    verdict := 'accepté';
  exception when insufficient_privilege then verdict := 'refusé';
  end;
  raise notice '%', (select case when verdict = 'refusé' then '  OK   ' else '  ÉCHEC' end
    || ' · mais pas chez le voisin — attendu refusé, obtenu ' || verdict);

  perform set_config('request.jwt.claim.sub', serveur_a::text, true);
  begin
    insert into storage.objects (bucket_id, name) values ('menu', a::text || '/serveur.webp');
    verdict := 'accepté';
  exception when insufficient_privilege then verdict := 'refusé';
  end;
  raise notice '%', (select case when verdict = 'refusé' then '  OK   ' else '  ÉCHEC' end
    || ' · ni le serveur de la maison — attendu refusé, obtenu ' || verdict);

  -- Pas de reset role ici : on repasserait superutilisateur, RLS contourné, et
  -- les assertions suivantes passeraient pour de mauvaises raisons.
end $$;

-- --------------------------------------------------------------- inconnu
select pg_temp.as_user('f0000000-0000-4000-8000-000000000099');
select pg_temp.check('inconnu → rien',
       (select count(*)::text from resto.restaurants), '0');

reset role;
rollback;

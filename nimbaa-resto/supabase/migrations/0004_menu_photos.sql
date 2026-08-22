-- 0004 — la photo du plat.
--
-- Elle n'est pas décorative. Sur un marché où une partie du personnel et des
-- clients lit mal, c'est la photo qui porte l'information ; le nom est ce qui
-- reste pour ceux qui lisent. Le plan la prévoyait dès le départ, la migration
-- 0003 l'a oubliée.
--
-- Chemin : menu/<restaurant_id>/<uuid>.webp — le premier dossier EST le
-- restaurant, ce qui permet à la policy de savoir de qui est la photo sans
-- avoir à la joindre à quoi que ce soit.

alter table resto.menu_items add column if not exists photo_path text;

-- ------------------------------------------------------------- le seau
-- Sur un Postgres nu (tests, CI) le schéma storage n'existe pas : on le
-- traverse en silence plutôt que de rendre la migration inapplicable hors
-- Supabase.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then

    -- Seau public en LECTURE : une photo de plat n'est pas un secret, et en
    -- phase 2 elle sera de toute façon affichée au client qui scanne. L'écriture,
    -- elle, reste tenue par les policies ci-dessous.
    execute $q$
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('menu', 'menu', true, 2097152,
              array['image/webp','image/jpeg','image/png'])
      on conflict (id) do update
        set public = true,
            file_size_limit = 2097152,
            allowed_mime_types = array['image/webp','image/jpeg','image/png']
    $q$;

    -- 2 Mo est déjà dix fois la cible (25–40 Ko après compression côté client).
    -- La limite n'est pas un objectif : c'est le garde-fou du jour où la
    -- compression échoue silencieusement.

    execute $q$ drop policy if exists menu_photo_read on storage.objects $q$;
    execute $q$
      create policy menu_photo_read on storage.objects for select
        using (bucket_id = 'menu')
    $q$;

    -- Écrire dans le dossier d'un restaurant : il faut le gérer. Un serveur
    -- d'un autre restaurant ne peut pas déposer une image dans ce dossier, et
    -- un serveur de CE restaurant non plus.
    for i in 1..3 loop
      execute format($q$ drop policy if exists %I on storage.objects $q$,
                     'menu_photo_' || (array['ins','upd','del'])[i]);
    end loop;

    execute $q$
      create policy menu_photo_ins on storage.objects for insert to authenticated
        with check (bucket_id = 'menu'
                    and resto.can_manage(((storage.foldername(name))[1])::uuid))
    $q$;
    execute $q$
      create policy menu_photo_upd on storage.objects for update to authenticated
        using (bucket_id = 'menu'
               and resto.can_manage(((storage.foldername(name))[1])::uuid))
    $q$;
    execute $q$
      create policy menu_photo_del on storage.objects for delete to authenticated
        using (bucket_id = 'menu'
               and resto.can_manage(((storage.foldername(name))[1])::uuid))
    $q$;
  end if;
end $$;

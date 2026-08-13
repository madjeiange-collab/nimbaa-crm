-- =============================================================================
-- Stockage des photos de visite (preuve de passage géo-horodatée)
-- Bucket privé + politiques RLS sur storage.objects.
-- Chemin des objets : <uid_du_commercial>/<uuid>.jpg
-- =============================================================================

-- Bucket privé (accès uniquement via RLS / URLs signées)
insert into storage.buckets (id, name, public)
values ('visit-photos', 'visit-photos', false)
on conflict (id) do nothing;

-- Un commercial téléverse uniquement dans SON dossier (préfixe = son uid).
create policy "visit_photos_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'visit-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lecture : le propriétaire, ou un manager / admin.
create policy "visit_photos_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'visit-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.current_user_role() in ('manager', 'admin')
    )
  );

-- Suppression : le propriétaire ou un admin (archivage à venir).
create policy "visit_photos_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'visit-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.current_user_role() = 'admin'
    )
  );

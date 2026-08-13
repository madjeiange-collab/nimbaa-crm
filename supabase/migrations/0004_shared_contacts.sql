-- =============================================================================
-- Contacts partagés : un contact a un commercial assigné (par défaut), mais
-- TOUS les commerciaux peuvent le consulter, enregistrer des activités/visites
-- et voir le journal complet (qui a fait quoi).
-- =============================================================================

-- Contacts : lecture / création / mise à jour par tout commercial connecté.
drop policy if exists contacts_read on contacts;
create policy contacts_read on contacts for select using (auth.uid() is not null);

drop policy if exists contacts_ins on contacts;
create policy contacts_ins on contacts for insert with check (auth.uid() is not null);

drop policy if exists contacts_upd on contacts;
create policy contacts_upd on contacts for update using (auth.uid() is not null);

-- Activités : tout le monde voit le journal complet (chaque insert garde rep_id).
drop policy if exists acts_read on activities;
create policy acts_read on activities for select using (auth.uid() is not null);

-- Visites : lecture partagée (le fil d'un contact montre toutes les visites).
drop policy if exists visits_read on visits;
create policy visits_read on visits for select using (auth.uid() is not null);

-- Photos de visite : lecture partagée (miniatures dans le fil).
drop policy if exists photos_read on visit_photos;
create policy photos_read on visit_photos for select using (auth.uid() is not null);

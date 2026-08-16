-- =============================================================================
-- 0017 — Brief manager quotidien
-- Version détaillée du récap (par commercial / par technicien, avec CA et
-- points d'attention). Table séparée : la lecture est réservée aux
-- managers/admins (le récap public reste lisible par tous).
-- =============================================================================

create table if not exists manager_recaps (
  day        date primary key,
  content    text not null,
  created_at timestamptz not null default now()
);
alter table manager_recaps enable row level security;
drop policy if exists manager_recaps_read on manager_recaps;
create policy manager_recaps_read on manager_recaps for select
  using (current_user_role() in ('manager','admin'));
-- Écriture via la clé service uniquement (pas de policy d'insert/update).

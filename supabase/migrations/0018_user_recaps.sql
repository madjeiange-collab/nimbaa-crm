-- =============================================================================
-- 0018 — « Mon brief » quotidien par employé terrain
-- Un brief personnel (généré par l'IA) par commercial/technicien actif.
-- Chacun ne lit QUE le sien ; écriture via la clé service uniquement.
-- =============================================================================

create table if not exists user_recaps (
  day        date not null,
  user_id    uuid not null references users(id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now(),
  primary key (day, user_id)
);
alter table user_recaps enable row level security;
drop policy if exists user_recaps_own on user_recaps;
create policy user_recaps_own on user_recaps for select
  using (user_id = auth.uid());

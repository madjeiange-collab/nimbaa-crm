-- =============================================================================
-- 0012 — Leaderboard extras
-- app_settings: small key/value store (first use: admin-configurable
-- leaderboard point values). daily_recaps: the AI-written daily recap shown
-- on the leaderboard (written by the server with the service role).
-- =============================================================================

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
drop policy if exists settings_read on app_settings;
create policy settings_read on app_settings for select using (auth.uid() is not null);
drop policy if exists settings_admin on app_settings;
create policy settings_admin on app_settings for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

create table if not exists daily_recaps (
  day        date primary key,
  content    text not null,
  created_at timestamptz not null default now()
);
alter table daily_recaps enable row level security;
drop policy if exists recaps_read on daily_recaps;
create policy recaps_read on daily_recaps for select using (auth.uid() is not null);
-- Writes happen via the service-role key only (no insert/update policy).

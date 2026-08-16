-- =============================================================================
-- 0011 — AI assistant usage tracking
-- One row per user per day; the assistant route increments `questions` and
-- refuses once the daily cap is reached (cap lives in code: lib/ai/config.ts).
-- =============================================================================

create table if not exists ai_usage (
  user_id   uuid not null references users(id) on delete cascade,
  day       date not null,
  questions int  not null default 0,
  primary key (user_id, day)
);

alter table ai_usage enable row level security;
drop policy if exists ai_usage_own on ai_usage;
create policy ai_usage_own on ai_usage for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

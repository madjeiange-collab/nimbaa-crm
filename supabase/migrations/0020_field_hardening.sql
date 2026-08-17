-- 0020: field hardening — audio AI caps, per-rep daily goals, and
-- rep-proposed do-not-knock points (admin approves).

-- Daily cap for voice endpoints (transcribe + TTS), same table as questions.
alter table ai_usage add column if not exists audio_clips int not null default 0;

-- Per-rep visit objective; NULL falls back to app_settings daily_visit_goal.
alter table users add column if not exists daily_goal int;

-- Rep-proposed DNK points: created unapproved, admin approves or deletes.
alter table do_not_knock_list add column if not exists approved boolean not null default true;
alter table do_not_knock_list add column if not exists proposed_by uuid references users(id);

drop policy if exists dnk_propose on do_not_knock_list;
create policy dnk_propose on do_not_knock_list for insert
  with check (auth.uid() is not null and approved = false);

-- Only APPROVED points block visits.
create or replace function near_do_not_knock(p_lat double precision, p_lng double precision)
  returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from do_not_knock_list
    where approved
      and st_dwithin(geom, st_setsrid(st_makepoint(p_lng,p_lat),4326)::geography, 20)
  ) $$;

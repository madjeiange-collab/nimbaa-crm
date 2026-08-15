-- =============================================================================
-- 0005 — Technicians + installation protocol
--
-- Adds a second field-worker type: the TECHNICIAN, who installs the product on
-- site once a customer is won. Technicians reuse the whole field toolkit
-- (GPS check-in, photos, notes, timeline) — an installation trip is just a
-- `visits` row with visit_type='installation' — plus a structured protocol
-- (step checklist, equipment/serial, status with revisit) held in `installations`.
--
-- A manager OR the winning commercial assigns a technician to a won customer.
--
-- NOTE: this file also (re)applies the shared team-read policies from the still-
-- pending 0004_shared_contacts.sql, so running 0005 alone is sufficient — the
-- technician needs to read customers, visits, photos and activities they didn't
-- create. If 0004 was already applied, these drop/create statements are no-ops.
-- =============================================================================

-- ---- New enum values (ADD VALUE only; not used in DDL below, so no
-- ---- "unsafe use of new enum value" error inside this transaction) ----------
alter type user_role  add value if not exists 'technician';
alter type visit_type add value if not exists 'installation';

-- ---- Installation status ----------------------------------------------------
do $$ begin
  create type install_status as enum
    ('pending','scheduled','in_progress','done','needs_revisit');
exception when duplicate_object then null; end $$;

-- ---- Installations: one row per installation JOB. A customer can have
-- ---- several (re-installs, extra products), so contact_id is NOT unique.
-- ---- Job state (installer/status) lives here, not denormalised onto contacts.
create table if not exists installations (
  id              uuid primary key default uuid_generate_v4(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  title           text,                          -- product / job label (optional)
  installer_id    uuid references users(id),
  status          install_status not null default 'pending',
  checklist       jsonb not null default '[]',   -- [{ key, label, done }]
  equipment       jsonb not null default '[]',   -- [{ label, serial }]
  scheduled_date  date,
  started_at      timestamptz,
  completed_at    timestamptz,
  next_visit_date date,
  notes           text,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists installations_contact_ix   on installations (contact_id);
create index if not exists installations_installer_ix on installations (installer_id);
create index if not exists installations_status_ix    on installations (status);

alter table installations enable row level security;

-- ---- RLS: shared team model (consistent with 0004) -------------------------
-- Installations are visible to and editable by any authenticated team member;
-- managers/admins already see everything, technicians see their assigned jobs
-- through the same door. Each row keeps installer_id / created_by for attribution.
drop policy if exists installations_read on installations;
create policy installations_read on installations for select using (auth.uid() is not null);

drop policy if exists installations_ins on installations;
create policy installations_ins on installations for insert with check (auth.uid() is not null);

drop policy if exists installations_upd on installations;
create policy installations_upd on installations for update using (auth.uid() is not null);

-- ---- Shared team-read policies (folded in from 0004) ------------------------
-- A technician must read customers, visits, photos and activities created by
-- commercials. Idempotent: no-ops if 0004 already ran.
drop policy if exists contacts_read on contacts;
create policy contacts_read on contacts for select using (auth.uid() is not null);
drop policy if exists contacts_ins on contacts;
create policy contacts_ins on contacts for insert with check (auth.uid() is not null);
drop policy if exists contacts_upd on contacts;
create policy contacts_upd on contacts for update using (auth.uid() is not null);

drop policy if exists acts_read on activities;
create policy acts_read on activities for select using (auth.uid() is not null);

drop policy if exists visits_read on visits;
create policy visits_read on visits for select using (auth.uid() is not null);

drop policy if exists photos_read on visit_photos;
create policy photos_read on visit_photos for select using (auth.uid() is not null);

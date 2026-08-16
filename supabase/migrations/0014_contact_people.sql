-- =============================================================================
-- 0014 — Interlocuteurs (contact persons per business)
-- A business (contacts row) can have several people — gérant, chef de projet,
-- comptable… Each deal can point at the person it is negotiated with.
-- =============================================================================

create table if not exists contact_people (
  id         uuid primary key default uuid_generate_v4(),
  contact_id uuid not null references contacts(id) on delete cascade,
  name       text not null,
  role       text,                                   -- « Gérant », « Chef de projet »…
  phone      text,
  email      text,
  notes      text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists contact_people_contact_ix on contact_people (contact_id);

alter table contact_people enable row level security;
drop policy if exists contact_people_all on contact_people;
create policy contact_people_all on contact_people for all
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- The person a deal is negotiated with (survives person deletion as NULL).
alter table deals add column if not exists contact_person_id uuid references contact_people(id) on delete set null;

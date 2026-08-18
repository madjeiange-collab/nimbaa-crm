-- 0025 — Follow-up tasks.
--
-- A rendez-vous or a "retour requis" already stamped a date on the visit or
-- the installation, but nothing carried WHAT had to happen, who owed it, or
-- whether it ever got done. A task is that object: owned, dated, closable, and
-- readable by anyone who touches the job.
--
-- kind:  'rdv'     — created when a visit is saved with a rendez-vous
--        'revisit' — created when an installation is left needing a return
--        'manual'  — added by hand on a contact
create table if not exists tasks (
  id              uuid primary key default uuid_generate_v4(),
  contact_id      uuid references contacts(id) on delete cascade,
  deal_id         uuid references deals(id) on delete set null,
  installation_id uuid references installations(id) on delete set null,
  visit_id        uuid references visits(id) on delete set null,
  kind            text not null default 'manual'
                    check (kind in ('rdv', 'revisit', 'manual')),
  title           text not null,
  details         text,
  due_at          timestamptz,
  assigned_to     uuid references users(id),
  created_by      uuid references users(id),
  status          text not null default 'open'
                    check (status in ('open', 'done', 'cancelled')),
  completed_at    timestamptz,
  completed_by    uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tasks_owner_ix   on tasks (assigned_to, status, due_at);
create index if not exists tasks_contact_ix on tasks (contact_id, status);
create index if not exists tasks_due_ix     on tasks (status, due_at);

-- One open auto-task per source, so an offline retry cannot duplicate it.
create unique index if not exists tasks_one_open_per_visit
  on tasks (visit_id) where visit_id is not null and status = 'open';
create unique index if not exists tasks_one_open_per_installation
  on tasks (installation_id) where installation_id is not null and status = 'open';

alter table tasks enable row level security;

-- Shared like the rest of the field data: the whole team reads and can close a
-- task, because whoever shows up at the customer is the one who settles it.
drop policy if exists tasks_read on tasks;
create policy tasks_read on tasks
  for select using (auth.uid() is not null);

drop policy if exists tasks_insert on tasks;
create policy tasks_insert on tasks
  for insert with check (auth.uid() is not null);

drop policy if exists tasks_update on tasks;
create policy tasks_update on tasks
  for update using (auth.uid() is not null);

drop policy if exists tasks_delete on tasks;
create policy tasks_delete on tasks
  for delete using (
    exists (select 1 from users u where u.id = auth.uid() and u.role in ('manager', 'admin'))
  );

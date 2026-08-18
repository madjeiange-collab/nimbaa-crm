-- 0026 — Tie each trip to the job it belongs to, and to the plan that asked
-- for it.
--
-- Until now an installation trip was a `visits` row attached only to the
-- CUSTOMER, so "the three trips of this job" was unanswerable and a customer
-- with two jobs had indistinguishable trips. Each trip now records:
--   installation_id     which job it belongs to
--   task_id             which planned follow-up it discharged (if any)
--   install_status      what the technician concluded AT THAT TRIP
--   checklist_snapshot  how far the protocol stood at that moment
-- Together these turn the job into a readable history instead of a final state.

alter table visits
  add column if not exists installation_id uuid references installations(id) on delete set null,
  add column if not exists task_id uuid references tasks(id) on delete set null,
  add column if not exists install_status text,
  add column if not exists checklist_snapshot jsonb;

create index if not exists visits_installation_ix on visits (installation_id, visited_at desc);
create index if not exists visits_task_ix on visits (task_id) where task_id is not null;

-- Backfill, deliberately conservative: only where the customer has exactly ONE
-- job, so no trip is attributed to the wrong one. Customers with several jobs
-- keep null — history before today is indicative, from today it is exact.
update visits v
set installation_id = i.id
from installations i
where v.visit_type = 'installation'
  and v.installation_id is null
  and i.contact_id = v.contact_id
  and not exists (
    select 1 from installations i2
    where i2.contact_id = v.contact_id and i2.id <> i.id
  );

-- Carry the affaire across for the trips we could attribute.
update visits v
set deal_id = i.deal_id
from installations i
where v.installation_id = i.id
  and v.deal_id is null
  and i.deal_id is not null;

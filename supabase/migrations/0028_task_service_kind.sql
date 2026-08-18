-- 0028 — A reported fault can be planned before anyone is on site.
--
-- 'service' is the phoned-in case: the customer calls, nobody is there yet, so
-- there is no job to attach a revisit to. Starting the task opens the
-- intervention form, and saving it creates the job and the trip together.
alter table tasks drop constraint if exists tasks_kind_check;
alter table tasks
  add constraint tasks_kind_check
  check (kind in ('rdv', 'revisit', 'service', 'manual'));

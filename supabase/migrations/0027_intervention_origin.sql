-- 0027 — Interventions that are not sales.
--
-- A technician could only ever work a job born from a commercial's won deal,
-- so an after-sales callback had to be dressed up as a fake sale. installations
-- .deal_id was already nullable and the insert policy already allows any
-- authenticated user — what was missing is a way to tell the two apart.
--
--   sale        the installation that follows a won affaire (the default)
--   service     an SAV / callback asked for by the customer
--   warranty    a return under warranty, at our cost
--   maintenance planned upkeep
--
-- A job with no deal earns no technician commission: ensureTechCommissionForInstall
-- already requires a won deal, so service work is unpaid unless that changes
-- deliberately.
alter table installations
  add column if not exists origin text not null default 'sale',
  add column if not exists reason text;

alter table installations drop constraint if exists installations_origin_check;
alter table installations
  add constraint installations_origin_check
  check (origin in ('sale', 'service', 'warranty', 'maintenance'));

create index if not exists installations_origin_ix on installations (origin, status);

-- Everything created before this migration came from a sale.
update installations set origin = 'sale' where origin is null;

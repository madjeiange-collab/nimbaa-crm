-- =============================================================================
-- 0007 — Affaires (deals): several businesses per customer
--
-- The sale used to live inline on the contact (pipeline_stage_id / value_xof /
-- lifecycle / lost_reason). A customer can have SEVERAL businesses, each with
-- its own sales stage, value and optional installation. We add a `deals` layer
-- between the customer and the installation.
--
-- `contacts.lifecycle` + `contacts.value_xof` are kept as ROLLUP columns
-- (maintained by the app whenever a deal changes) so every existing
-- lifecycle/value reader keeps working. The legacy contact sale columns are
-- left in place (no drop) as a safety net.
-- =============================================================================

do $$ begin
  create type deal_status as enum ('open','won','lost');
exception when duplicate_object then null; end $$;

create table if not exists deals (
  id                 uuid primary key default uuid_generate_v4(),
  contact_id         uuid not null references contacts(id) on delete cascade,
  title              text,                       -- product / service ("Panneaux solaires")
  value_xof          bigint,
  pipeline_stage_id  uuid references pipeline_stages(id),
  status             deal_status not null default 'open',
  needs_installation boolean not null default false,
  lost_reason        text,
  assigned_rep_id    uuid references users(id),
  won_at             timestamptz,
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists deals_contact_ix  on deals (contact_id);
create index if not exists deals_stage_ix    on deals (pipeline_stage_id);
create index if not exists deals_status_ix   on deals (status);
create index if not exists deals_rep_ix      on deals (assigned_rep_id);

-- Installations belong to a deal (keep contact_id denormalised for readers).
alter table installations add column if not exists deal_id uuid references deals(id) on delete cascade;
create index if not exists installations_deal_ix on installations (deal_id);

alter table deals enable row level security;
drop policy if exists deals_read on deals;
create policy deals_read on deals for select using (auth.uid() is not null);
drop policy if exists deals_ins on deals;
create policy deals_ins on deals for insert with check (auth.uid() is not null);
drop policy if exists deals_upd on deals;
create policy deals_upd on deals for update using (auth.uid() is not null);
drop policy if exists deals_del on deals;
create policy deals_del on deals for delete using (auth.uid() is not null);

-- ---- Backfill: one deal per existing contact that has a sale/history --------
-- Idempotent: only runs while `deals` is still empty.
insert into deals (contact_id, title, value_xof, pipeline_stage_id, status, needs_installation,
                   lost_reason, assigned_rep_id, won_at, created_by, created_at)
select c.id,
       (select i.title from installations i where i.contact_id = c.id and i.title is not null limit 1),
       c.value_xof, c.pipeline_stage_id,
       case
         when ps.is_won or c.lifecycle = 'customer'
              or exists (select 1 from installations i where i.contact_id = c.id) then 'won'
         when ps.is_lost or c.lifecycle = 'lost' then 'lost'
         else 'open'
       end::deal_status,
       exists (select 1 from installations i where i.contact_id = c.id),
       c.lost_reason, c.assigned_rep_id, c.converted_at, c.created_by, c.created_at
from contacts c
left join pipeline_stages ps on ps.id = c.pipeline_stage_id
where (c.pipeline_stage_id is not null
       or c.value_xof is not null
       or c.lost_reason is not null
       or c.lifecycle <> 'lead'
       or exists (select 1 from installations i where i.contact_id = c.id))
  and not exists (select 1 from deals);

-- ---- Link existing installations to their contact's (single) deal ----------
update installations i
set deal_id = d.id
from deals d
where d.contact_id = i.contact_id and i.deal_id is null;

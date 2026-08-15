-- =============================================================================
-- 0006 — Admin-editable installation protocol
--
-- The installation checklist was a code constant (DEFAULT_CHECKLIST). This makes
-- it a table the admin can edit. New installation jobs copy the active steps
-- (in order) onto themselves at creation, so changing the template never mutates
-- jobs already in flight.
-- =============================================================================

create table if not exists install_protocol_steps (
  id         uuid primary key default uuid_generate_v4(),
  key        text not null,                 -- stable slug (used in job checklist items)
  label      text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists install_protocol_order_ix on install_protocol_steps (sort_order);

alter table install_protocol_steps enable row level security;

-- Read: any authenticated user (technicians need it to build a job).
-- Write: admins only.
drop policy if exists ips_read on install_protocol_steps;
create policy ips_read on install_protocol_steps for select using (auth.uid() is not null);
drop policy if exists ips_admin on install_protocol_steps;
create policy ips_admin on install_protocol_steps for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- Seed the default protocol (only if empty).
insert into install_protocol_steps (key, label, sort_order)
select * from (values
  ('site_ready',        'Site préparé',        1),
  ('unit_mounted',      'Unité montée',        2),
  ('wiring',            'Câblage effectué',    3),
  ('power_on',          'Mise sous tension',   4),
  ('function_test',     'Test fonctionnel',    5),
  ('customer_training', 'Formation client',    6)
) as v(key, label, sort_order)
where not exists (select 1 from install_protocol_steps);

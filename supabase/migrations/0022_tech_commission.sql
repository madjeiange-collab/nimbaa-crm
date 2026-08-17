-- 0022: technician commission — separate per-product rate, earned once when
-- the technician completes the deal's installation.

alter table products add column if not exists tech_commission_pct numeric(5,2) not null default 0;

-- Distinguish sale (commercial) vs install (technician) entries, and key
-- technician entries to their installation for idempotence.
alter table commission_entries add column if not exists kind text not null default 'sale';
alter table commission_entries add column if not exists installation_id uuid references installations(id) on delete set null;
create index if not exists ce_install_ix on commission_entries (installation_id);

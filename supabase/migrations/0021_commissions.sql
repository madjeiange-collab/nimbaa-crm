-- 0021: commission engine — plan intervals on products, subscriptions born
-- from won deals, and the commission ledger. All windows/percentages are
-- per-product settings, snapshotted onto each subscription at sale time.

alter table products add column if not exists billing_interval text not null default 'one_time';
alter table products add column if not exists commission_mode text not null default 'once'; -- once|recurring
alter table products add column if not exists commission_months int not null default 3;

create table if not exists subscriptions (
  id uuid primary key default uuid_generate_v4(),
  deal_id uuid unique references deals(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  product_id uuid references products(id),
  rep_id uuid references users(id),
  monthly_price_xof bigint not null,
  commission_pct numeric(5,2) not null,
  commission_months int not null,
  start_date date not null default current_date,
  status text not null default 'active', -- active|cancelled
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists commission_entries (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid references subscriptions(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  rep_id uuid not null references users(id),
  period_index int not null,
  period_month date not null, -- anniversary date the slice belongs to
  amount_xof bigint not null,
  status text not null default 'pending', -- pending|earned|expired|paid
  earned_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ce_rep_ix on commission_entries (rep_id, status);
create index if not exists ce_sub_ix on commission_entries (subscription_id);

alter table subscriptions enable row level security;
alter table commission_entries enable row level security;

-- Read: own rows, managers/admins everything. Insert: any authed user (a rep
-- winning their own deal creates the subscription). Status transitions
-- (cancel / earn / expire / pay) run manager-side or via service role.
drop policy if exists subs_read on subscriptions;
create policy subs_read on subscriptions for select
  using (rep_id = auth.uid() or current_user_role() in ('manager','admin'));
drop policy if exists subs_ins on subscriptions;
create policy subs_ins on subscriptions for insert with check (auth.uid() is not null);
drop policy if exists subs_mgr on subscriptions;
create policy subs_mgr on subscriptions for update
  using (current_user_role() in ('manager','admin'));

drop policy if exists ce_read on commission_entries;
create policy ce_read on commission_entries for select
  using (rep_id = auth.uid() or current_user_role() in ('manager','admin'));
drop policy if exists ce_ins on commission_entries;
create policy ce_ins on commission_entries for insert with check (auth.uid() is not null);
drop policy if exists ce_mgr on commission_entries;
create policy ce_mgr on commission_entries for update
  using (current_user_role() in ('manager','admin'));

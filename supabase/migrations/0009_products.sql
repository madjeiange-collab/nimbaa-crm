-- =============================================================================
-- 0009 — Product portfolio
-- Admin-defined products (name + price + commission %). A deal's value comes
-- from the chosen product (snapshotted onto the deal), and the product is the
-- future basis for commission.
-- =============================================================================

create table if not exists products (
  id             uuid primary key default uuid_generate_v4(),
  name           text not null,
  price_xof      bigint not null default 0,
  commission_pct numeric(5,2) not null default 0,
  is_active      boolean not null default true,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists products_order_ix on products (sort_order);

alter table products enable row level security;
drop policy if exists products_read on products;
create policy products_read on products for select using (auth.uid() is not null);
drop policy if exists products_admin on products;
create policy products_admin on products for all
  using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- A deal references a portfolio product; value_xof is kept as a snapshot.
alter table deals add column if not exists product_id uuid references products(id);
create index if not exists deals_product_ix on deals (product_id);

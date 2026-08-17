-- 0023: each commission entry carries its own calculation (base × rate),
-- snapshotted at creation — historically exact even after product edits.
alter table commission_entries add column if not exists base_xof bigint;
alter table commission_entries add column if not exists rate_pct numeric(5,2);

-- Backfill existing rows from the subscription snapshot where available.
update commission_entries ce
set base_xof = s.monthly_price_xof, rate_pct = s.commission_pct
from subscriptions s
where ce.subscription_id = s.id and ce.base_xof is null;

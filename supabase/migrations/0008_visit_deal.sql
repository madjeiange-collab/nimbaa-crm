-- =============================================================================
-- 0008 — Link a visit to a deal (affaire)
-- A field visit can now be attached to a specific business (deal), so the
-- affaire keeps its own visit history and an engaged visit advances that deal.
-- =============================================================================

alter table visits add column if not exists deal_id uuid references deals(id) on delete set null;
create index if not exists visits_deal_ix on visits (deal_id);

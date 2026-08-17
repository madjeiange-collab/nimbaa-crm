-- 0024 — Anti-fraud photo forensics + time spent at the customer.
--
-- Photos become queryable evidence: each visit photo stores its own GPS fix,
-- capture moment, perceptual hash (dHash, 16 hex chars) and a kind:
--   'arrival'    — taken when the rep/technician arrives (starts the clock)
--   'completion' — taken when leaving / finishing (stops the clock)
--   'extra'      — any additional photo
-- visits.started_at = arrival-photo moment; time spent = visited_at - started_at.
-- (installations already carry started_at / completed_at.)

alter table visits
  add column if not exists started_at timestamptz;

alter table visit_photos
  add column if not exists kind text not null default 'extra',
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists accuracy double precision,
  add column if not exists captured_at timestamptz,
  add column if not exists phash text;

alter table visit_photos drop constraint if exists visit_photos_kind_check;
alter table visit_photos
  add constraint visit_photos_kind_check
  check (kind in ('arrival', 'completion', 'extra'));

-- Duplicate-photo lookups (same phash backing several visits).
create index if not exists visit_photos_phash_ix
  on visit_photos (phash) where phash is not null;

-- Fraud sweep reads photos by capture time.
create index if not exists visit_photos_captured_ix
  on visit_photos (captured_at desc) where captured_at is not null;

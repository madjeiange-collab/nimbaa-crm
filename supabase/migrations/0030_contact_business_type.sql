-- 0030 — The type d'activité belongs to the business, not to each affaire.
--
-- A maquis is a maquis whichever forfait you sell it, but the field sat on
-- `deals`, so every new affaire asked again and the same customer could end up
-- Maquis on one and Glacier on the next. Tags had the same problem.
--
-- deals.business_type and deals.tags STAY as they are: eleven files and some
-- forty-odd queries read them — recap, the assistant's tools, every statistics
-- page. Moving the storage would mean rewriting all of that for no gain. The
-- contact becomes the place you SET the value; the app copies it down to the
-- affaires, which keeps every existing reader working untouched.
alter table contacts add column if not exists business_type text;

create index if not exists contacts_business_type_ix on contacts (business_type);

-- Backfill: adopt what the contact's affaires already say. Most contacts have
-- one affaire; where several disagree, the most recent wins, which is the one
-- someone most likely got right.
update contacts c
set business_type = d.business_type
from (
  select distinct on (contact_id) contact_id, business_type
  from deals
  where business_type is not null and btrim(business_type) <> ''
  order by contact_id, created_at desc
) d
where d.contact_id = c.id
  and c.business_type is null;

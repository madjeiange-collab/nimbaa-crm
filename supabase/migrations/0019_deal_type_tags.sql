-- 0019: deal categorization — business type (maquis, restaurant, glacier…)
-- and free tags for later analysis. Both plain columns, no RLS change
-- (deals policies already cover reads/writes).

alter table deals add column if not exists business_type text;
alter table deals add column if not exists tags text[] not null default '{}';

create index if not exists deals_business_type_ix on deals (business_type);
create index if not exists deals_tags_gix on deals using gin (tags);

-- 0031 — One person, several commerces.
--
-- Multi-site owners are common here: the same gérant runs three kiosks, or a
-- family holds a maquis and a supérette. contact_people.contact_id was a single
-- non-null FK, so that person had to be created once per business. Their phone
-- then lived in several rows that drifted apart, nobody could ask "which
-- commerces is this person behind", and deals.contact_person_id pointed at
-- whichever copy happened to be picked.
--
-- contact_people keeps its id and becomes the PERSON. The tie to a business
-- moves into a link table, which also carries the role — someone can be Gérant
-- at one address and Propriétaire at another.
--
-- deals.contact_person_id is untouched: it already points at a person.

create table if not exists contact_people_links (
  id         uuid primary key default uuid_generate_v4(),
  person_id  uuid not null references contact_people(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  role       text,                                   -- role held AT this business
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (person_id, contact_id)
);

create index if not exists cpl_person_ix  on contact_people_links (person_id);
create index if not exists cpl_contact_ix on contact_people_links (contact_id);

-- Every existing interlocutor becomes a person with exactly one link, carrying
-- the role they already had.
insert into contact_people_links (person_id, contact_id, role, created_by)
select p.id, p.contact_id, p.role, p.created_by
from contact_people p
where p.contact_id is not null
on conflict (person_id, contact_id) do nothing;

-- The old column stays for now, but nullable: nothing reads it after this
-- migration, and keeping it means a botched deploy can still be rolled back.
alter table contact_people alter column contact_id drop not null;

alter table contact_people_links enable row level security;

-- Shared like the rest of the field data: whoever stands in front of the
-- customer needs to see who to ask for.
drop policy if exists cpl_read on contact_people_links;
create policy cpl_read on contact_people_links
  for select using (auth.uid() is not null);

drop policy if exists cpl_ins on contact_people_links;
create policy cpl_ins on contact_people_links
  for insert with check (auth.uid() is not null);

drop policy if exists cpl_upd on contact_people_links;
create policy cpl_upd on contact_people_links
  for update using (auth.uid() is not null);

drop policy if exists cpl_del on contact_people_links;
create policy cpl_del on contact_people_links
  for delete using (auth.uid() is not null);

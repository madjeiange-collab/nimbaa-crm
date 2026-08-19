-- 0035 — Le journal d'un client / prospect.
--
-- Même manque que pour les affaires avant 0034 : la fiche ne portait que son
-- état courant. Corriger une adresse, changer un numéro, réattribuer le client
-- à quelqu'un d'autre ne laissait rien — updated_at est réécrit à chaque fois
-- et ne dit pas ce qui a bougé.
--
-- Table sœur de deal_events plutôt que table commune : les deux journaux ne
-- racontent pas la même chose (celui d'une affaire porte le temps passé par
-- étape, qui n'a pas d'équivalent ici), et fusionner une table déjà en service
-- coûterait plus que de la répéter.

create table if not exists contact_events (
  id           uuid primary key default uuid_generate_v4(),
  contact_id   uuid references contacts(id) on delete cascade,
  -- Recopié pour que la ligne reste lisible si le nom change ensuite : le
  -- journal doit dire « s'appelait X », pas afficher le nom d'aujourd'hui.
  contact_name text,
  kind         text not null
                 check (kind in ('created', 'imported', 'name', 'phone', 'address',
                                 'geo', 'business_type', 'tags', 'priority',
                                 'assigned')),
  from_label   text,
  to_label     text,
  actor_id     uuid references users(id),
  at           timestamptz not null default now()
);
create index if not exists ce_contact_ix on contact_events (contact_id, at desc);

alter table contact_events enable row level security;

drop policy if exists ce_read on contact_events;
create policy ce_read on contact_events for select using (auth.uid() is not null);

drop policy if exists ce_ins on contact_events;
create policy ce_ins on contact_events for insert with check (auth.uid() is not null);

-- Ni update ni delete, comme pour deal_events : un registre réinscriptible ne
-- vaut pas d'être tenu.

-- --------------------------------------------------------------- reprise
-- Le seul fait qu'on puisse déduire honnêtement d'une fiche existante est sa
-- création. Tout le reste de son passé est inconnu et le rester.
insert into contact_events (contact_id, contact_name, kind, actor_id, at)
select c.id, c.name, 'created', c.created_by, c.created_at
from contacts c
where not exists (
  select 1 from contact_events e where e.contact_id = c.id and e.kind = 'created'
);

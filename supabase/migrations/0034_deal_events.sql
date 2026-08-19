-- 0034 — Le journal d'une affaire.
--
-- Jusqu'ici une affaire ne portait que son état courant : on savait où elle
-- était, jamais depuis quand ni ce qu'elle avait traversé. Passer de
-- Négociation à Essai et revenir ne laissait rien — updated_at est réécrit à
-- chaque fois et ne dit pas ce qui a changé.

create table if not exists deal_events (
  id          uuid primary key default uuid_generate_v4(),
  -- SET NULL et non CASCADE : supprimer une affaire ne doit pas effacer la
  -- trace qu'elle a existé et qu'on l'a supprimée — c'est justement le cas
  -- qu'on voudrait pouvoir relire.
  deal_id     uuid references deals(id) on delete set null,
  contact_id  uuid references contacts(id) on delete cascade,
  -- Recopié à chaque ligne pour que le journal reste lisible quand l'affaire
  -- n'est plus là pour donner son nom.
  deal_title  text,
  kind        text not null
                check (kind in ('created', 'stage', 'product', 'value', 'person',
                                'install_flag', 'renamed', 'deleted')),
  from_label  text,
  to_label    text,
  actor_id    uuid references users(id),
  at          timestamptz not null default now()
);
create index if not exists de_deal_ix on deal_events (deal_id, at desc);
create index if not exists de_contact_ix on deal_events (contact_id, at desc);

alter table deal_events enable row level security;

-- Lecture pour tout le monde, comme le reste des données terrain : celui qui
-- reprend un client doit pouvoir lire ce qui lui est arrivé.
drop policy if exists de_read on deal_events;
create policy de_read on deal_events for select using (auth.uid() is not null);

drop policy if exists de_ins on deal_events;
create policy de_ins on deal_events for insert with check (auth.uid() is not null);

-- Pas de politique update ni delete, volontairement : un journal qu'on peut
-- réécrire ne vaut pas d'être tenu.

-- --------------------------------------------------------------- reprise
-- Les affaires existantes n'ont pas d'historique et l'essentiel est
-- irrécupérable. Deux évènements se déduisent honnêtement — la création et,
-- le cas échéant, la victoire. Rien d'autre n'est inventé : un milieu
-- plausible serait pire qu'un trou assumé.
insert into deal_events (deal_id, contact_id, deal_title, kind, to_label, actor_id, at)
select d.id, d.contact_id, d.title, 'created', null, d.created_by, d.created_at
from deals d
where not exists (
  select 1 from deal_events e where e.deal_id = d.id and e.kind = 'created'
);

insert into deal_events (deal_id, contact_id, deal_title, kind, to_label, actor_id, at)
select d.id, d.contact_id, d.title, 'stage', s.name, d.assigned_rep_id, d.won_at
from deals d
left join pipeline_stages s on s.id = d.pipeline_stage_id
where d.won_at is not null
  and not exists (
    select 1 from deal_events e
    where e.deal_id = d.id and e.kind = 'stage' and e.at = d.won_at
  );

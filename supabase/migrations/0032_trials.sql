-- 0032 — Essai : du matériel chez le client avant la vente.
--
-- Un essai est une phase, pas une propriété : il a un début, une fin, une
-- issue, et il peut y en avoir plusieurs. Deux colonnes de dates sur l'affaire
-- ne savent pas raconter « 30 jours, prolongé de 15, repris, puis 30 de plus »,
-- donc les périodes vivent dans leur propre table.

-- ------------------------------------------------------------------ l'étape
-- Entre Négociation et Gagné. is_won et is_lost restent faux, et c'est tout
-- l'objet de l'étape : le contact reste un prospect, aucun abonnement ne naît,
-- aucune commission commerciale non plus.
do $$
begin
  if not exists (select 1 from pipeline_stages where system_key = 'trial') then
    -- Faire de la place sans renuméroter à la main : Gagné et Perdu reculent.
    update pipeline_stages set sort_order = sort_order + 1 where sort_order >= 6;
    insert into pipeline_stages (name, sort_order, is_won, is_lost, is_active, system_key)
    values ('Essai', 6, false, false, true, 'trial');
  end if;
end $$;

-- --------------------------------------------------------------- les périodes
create table if not exists deal_trials (
  id              uuid primary key default uuid_generate_v4(),
  deal_id         uuid not null references deals(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete cascade,
  -- 1, 2, 3… : un second essai est une nouvelle ligne, pas une date repoussée.
  seq             int not null default 1,
  started_on      date not null default current_date,
  ends_on         date not null,
  ended_on        date,
  -- null tant que l'essai court.
  outcome         text check (outcome in ('converted', 'declined', 'superseded')),
  -- La pose qui a mis le matériel sur place, s'il y en a eu une.
  installation_id uuid references installations(id) on delete set null,
  -- [{ at, by, to, note }] — un essai qui se renouvelle en silence est le mode
  -- de défaillance qu'on veut voir venir, donc chaque report est consigné au
  -- lieu d'écraser la date précédente.
  extensions      jsonb not null default '[]'::jsonb,
  created_by      uuid references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists dt_deal_seq_ux on deal_trials (deal_id, seq);
-- Les essais en cours, pour la tuile « échu, sans décision » et la relance.
create index if not exists dt_open_ix on deal_trials (ends_on) where outcome is null;
create index if not exists dt_contact_ix on deal_trials (contact_id);

-- ------------------------------------------------------------ les chantiers
-- 'trial' : la pose d'essai. 'retrieval' : la dépose quand l'essai échoue —
-- sans elle, le matériel sort et personne ne sait quand il revient.
alter table installations drop constraint if exists installations_origin_check;
alter table installations
  add constraint installations_origin_check
  check (origin in ('sale', 'service', 'warranty', 'maintenance', 'trial', 'retrieval'));

-- ---------------------------------------------------------------- la relance
-- La première tâche née d'une date et non d'un passage. C'est délibéré : une
-- fin d'essai n'est pas un déplacement, et c'est précisément ce que personne
-- ne retient de tête.
alter table tasks drop constraint if exists tasks_kind_check;
alter table tasks
  add constraint tasks_kind_check
  check (kind in ('rdv', 'revisit', 'service', 'manual', 'trial_end'));

-- --------------------------------------------------------------------- RLS
alter table deal_trials enable row level security;

drop policy if exists dt_read on deal_trials;
create policy dt_read on deal_trials for select
  using (auth.uid() is not null);

-- Écriture ouverte : les verrous qui comptent — 2ᵉ prolongation, 2ᵉ essai —
-- sont posés dans les actions, parce qu'un refus doit revenir avec sa raison
-- plutôt qu'en ligne qui ne s'écrit pas.
drop policy if exists dt_write on deal_trials;
create policy dt_write on deal_trials for insert with check (auth.uid() is not null);
drop policy if exists dt_update on deal_trials;
create policy dt_update on deal_trials for update using (auth.uid() is not null);

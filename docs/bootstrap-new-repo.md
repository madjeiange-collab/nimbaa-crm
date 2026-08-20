# Bootstrapping `nimbaa-resto`

> The step-by-step for creating the new repository the plan calls for
> (`docs/restaurant-ordering-plan.md`, §02). About 35 minutes end to end.
>
> Run these **on your own machine**, or in a fresh Claude Code session pointed
> at the new repo — not in this one, which is bound to `nimbaa-crm`.
>
> SQL comments are in French to match the CRM's migration convention. Say the
> word if you'd rather have them in English.

---

## Before you start

```bash
node -v      # must be ≥ 18.18
pnpm -v      # ≥ 9   — install with: npm install -g pnpm
git --version
```

The CRM's README notes Node was not installed on that machine. If `node -v`
fails, get the LTS from [nodejs.org](https://nodejs.org/) first — nothing below
works without it.

You will also need accounts on **GitHub**, **Supabase** and **Vercel**. All
three have free tiers that are enough for the whole of phase one.

---

## Step 1 — Name it, and create the empty repo · 2 min

Suggested name: **`nimbaa-resto`**. Short, sits beside `nimbaa-crm`, and does
not bake "QR" or "ordering" into a name that will outlive both.

**Via the web** — [github.com/new](https://github.com/new):

| Field | Value |
|---|---|
| Owner | `madjeiange-collab` |
| Repository name | `nimbaa-resto` |
| Visibility | **Private** |
| Add a README | **no** |
| Add .gitignore | **no** |
| Add a licence | **no** |

Leave all three initialisation boxes unticked. `create-next-app` writes its own
README and `.gitignore` in Step 2, and a pre-made commit here means a merge
conflict on your very first push.

**Via the CLI**, if you have `gh`:

```bash
gh repo create madjeiange-collab/nimbaa-resto --private
```

Do not clone it yet. Step 2 creates the directory.

---

## Step 2 — Scaffold Next.js 14 · 5 min

Pinned to the CRM's exact version, which is the whole point of "same stack":

```bash
pnpm create next-app@14.2.13 nimbaa-resto \
  --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm

cd nimbaa-resto
```

If a flag is not recognised the wizard will ask instead — answer:
TypeScript **yes**, ESLint **yes**, Tailwind **yes**, `src/` **yes**,
App Router **yes**, import alias **`@/*`**.

---

## Step 3 — Install the stack · 2 min

```bash
pnpm add @supabase/supabase-js @supabase/ssr next-intl zod \
         class-variance-authority clsx tailwind-merge \
         lucide-react tailwindcss-animate \
         @radix-ui/react-slot @radix-ui/react-label
```

Deliberately **not** installed: `leaflet`, `leaflet-draw`, `@types/geojson`.
The CRM needs maps and PostGIS; a restaurant has tables, not territories. Do
not copy that half of the dependency list across.

`qrcode` and the OTP libraries belong to the QR phase, not this one — see §10
of the plan. Nothing here needs them.

---

## Step 4 — Lay out the directories · 1 min

```bash
mkdir -p \
  src/app/\[locale\]/{t,r,platform} \
  src/components/ui \
  src/i18n src/lib/{supabase,auth,tenancy} src/messages src/types \
  supabase/{migrations,seed}
```

Mirrors the CRM so that moving between the two projects costs nothing:
`app/[locale]` for pages, `lib/` for everything server-side, `messages/` for
`fr.json` and `en.json`, `supabase/migrations` for numbered SQL.

`r/` is one restaurant's staff, which is the whole of phase one. `t/` (the
diner) and `platform/` (us) are created empty now so the shape is obvious when
they are filled in — see §10 of the plan.

---

## Step 5 — The environment file · 2 min

```bash
cat > .env.local.example <<'EOF'
# ---------------------------------------------------------------- Supabase
NEXT_PUBLIC_SUPABASE_URL=https://VOTRE-PROJET.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Serveur uniquement. Ne doit jamais atteindre un bundle client.
SUPABASE_SERVICE_ROLE_KEY=

# ------------------------------------------------------- Comptes personnel
# Domaine de l'adresse synthétique du personnel : <identifiant>@<slug>.<ce domaine>
# L'utilisateur ne la voit jamais ; il saisit un identifiant et un mot de passe.
STAFF_EMAIL_DOMAIN=staff.nimbaa.app

# ------------------------------------------------------------ OTP convives
# Vide en phase 1 — la commande par QR code arrive plus tard (§10 du plan).
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
EOF

cp .env.local.example .env.local
```

Check that `.env.local` is already in `.gitignore` — `create-next-app` puts it
there, but confirm before the first commit rather than after.

---

## Step 6 — Create the Supabase project · 5 min

1. [supabase.com](https://supabase.com) → **New project**.
2. Name `nimbaa-resto`. Save the database password somewhere real — it is shown
   once.
3. **Region: Europe (Paris or Frankfurt).** Not US. Every order write, every
   KDS event and every menu read crosses this link, and from West Africa the
   European hops are materially shorter. This is the one setting here you
   cannot change later without a migration.
4. *Project Settings → API* → copy `Project URL`, `anon public` and
   `service_role` into `.env.local`.

**No PostGIS.** The CRM enables it for territory polygons; nothing in this
project is geographic. Skip that step from the CRM's README.

Leave *Authentication → Providers* alone. Phase one has one door — staff
signing in with a username and a password — and no phone auth at all.

---

## Step 7 — The first migration · 10 min

This is the file everything else stands on: nothing downstream can be tested
until a restaurant and an owner exist.

```bash
cat > supabase/migrations/0001_tenancy.sql <<'EOF'
-- 0001 — Le socle : locataires, membres, comptes du personnel.
--
-- Trois tables, pas six. Les invitations, la console plateforme et son journal
-- d'accès arriveront quand il y aura des restaurants à assister ; pour les
-- premiers pilotes, le patron est créé par un script de démarrage, comme
-- l'admin du CRM l'a toujours été.
--
-- Deux règles tiennent le fichier.
--
-- 1. Chaque table porte restaurant_id EN CLAIR, jamais « atteignable par
--    jointure ». Une policy qui doit traverser deux jointures pour trouver son
--    locataire est une policy que personne n'écrit juste à 2h du matin, et que
--    Postgres planifie mal.
--
-- 2. is_member() est SECURITY DEFINER, et ce n'est pas un détail de style : la
--    policy de restaurant_members interroge restaurant_members. Sans SECURITY
--    DEFINER la policy s'appellerait elle-même — récursion infinie au premier
--    select, et c'est le piège classique de RLS sur Supabase.

create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------- locataires
create table if not exists restaurants (
  id                uuid primary key default uuid_generate_v4(),
  slug              text not null unique,
  name              text not null,
  timezone          text not null default 'Africa/Conakry',
  -- Le GNF et le XOF n'ont pas de subdivision, l'EUR en a deux. Les montants
  -- sont partout des entiers dans l'unité la plus petite ; ce champ ne sert
  -- qu'à placer la virgule à l'affichage, jamais au calcul.
  currency          text not null default 'GNF',
  currency_decimals smallint not null default 0,
  service_charge_bp int  not null default 0,   -- points de base, 0 = aucun
  tax_mode          text not null default 'none'
                      check (tax_mode in ('inclusive','exclusive','none')),
  status            text not null default 'active'
                      check (status in ('active','suspended')),
  created_at        timestamptz not null default now()
);

-- --------------------------------------------------------------- membres
-- Le droit d'agir dans un restaurant, et la seule autorité en la matière.
-- app_metadata peut porter un indicateur de commodité ; il ne décide rien, et
-- user_metadata encore moins — l'utilisateur peut le réécrire lui-même.
create table if not exists restaurant_members (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id       uuid not null references auth.users(id)  on delete cascade,
  role          text not null
                  check (role in ('owner','manager','waiter','kitchen','cashier')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id, role)
);
create index if not exists rm_user_ix on restaurant_members (user_id) where active;

-- ------------------------------------------------------ comptes personnel
-- Identifiant + mot de passe, distribués par le patron. Supabase Auth exige
-- une adresse e-mail : on en stocke une synthétique que l'employé ne voit
-- jamais, et l'identifiant lisible vit ici. Rien d'autre — pas de contact de
-- récupération tant qu'il n'y a pas de flux qui s'en serve : un patron qui
-- perd son mot de passe relance le script de démarrage.
create table if not exists staff_accounts (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  restaurant_id        uuid not null references restaurants(id) on delete cascade,
  username             text not null,
  display_name         text,
  must_change_password boolean not null default true,
  disabled_at          timestamptz,
  created_at           timestamptz not null default now(),
  unique (restaurant_id, username)
);

-- ------------------------------------------------------------- prédicats
create or replace function is_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from restaurant_members m
    where m.restaurant_id = rid and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function has_role(rid uuid, allowed text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from restaurant_members m
    where m.restaurant_id = rid and m.user_id = auth.uid()
      and m.active and m.role = any(allowed)
  );
$$;

-- ------------------------------------------------------------------- RLS
alter table restaurants        enable row level security;
alter table restaurant_members enable row level security;
alter table staff_accounts     enable row level security;

drop policy if exists resto_read on restaurants;
create policy resto_read on restaurants for select using (is_member(id));

drop policy if exists resto_write on restaurants;
create policy resto_write on restaurants for update
  using (has_role(id, array['owner','manager']))
  with check (has_role(id, array['owner','manager']));

drop policy if exists rm_read on restaurant_members;
create policy rm_read on restaurant_members for select using (is_member(restaurant_id));

-- Seul un patron nomme un patron ou un gérant. Un gérant recrute en salle et
-- en cuisine, jamais ses propres pairs : c'est ce qui empêche une compromission
-- moyenne de devenir totale.
drop policy if exists rm_grant on restaurant_members;
create policy rm_grant on restaurant_members for insert with check (
  has_role(restaurant_id, array['owner'])
  or (has_role(restaurant_id, array['manager'])
      and role in ('waiter','kitchen','cashier'))
);

drop policy if exists rm_revoke on restaurant_members;
create policy rm_revoke on restaurant_members for update
  using (has_role(restaurant_id, array['owner']))
  with check (has_role(restaurant_id, array['owner']));

drop policy if exists sa_read on staff_accounts;
create policy sa_read on staff_accounts for select
  using (user_id = auth.uid() or is_member(restaurant_id));

drop policy if exists sa_manage on staff_accounts;
create policy sa_manage on staff_accounts for update
  using (has_role(restaurant_id, array['owner','manager']))
  with check (has_role(restaurant_id, array['owner','manager']));
EOF
```

Apply it — copy the file into the Supabase **SQL Editor** and run it, or use
the CLI:

```bash
supabase link --project-ref <votre-ref>
supabase db push
```

### What is deliberately missing

**No `staff_invites`, no `platform_admins`, no `platform_access_log`.** An
earlier version of this file created six tables to support a platform console
with mandatory TOTP and an invite-based owner claim. For one to three pilot
restaurants that is a console with no users. The owner is created by
`bootstrap-owner.mjs` instead — exactly as this CRM creates its first admin —
and the console returns when there are restaurants to support.

**No `qr_token` on tables, and no `customers`.** Phase one is the restaurant
taking its own orders; a table is a label the waiter taps. Both arrive with the
QR flow, additively — see §10 of the plan.

### Verified

This migration was applied to a scratch Postgres 16 and probed before being
written down here — it is not a sketch. Three tables, twenty-four statements, RLS
enabled on all three, no recursion on the `restaurant_members` policy.

---

## Step 7b — Prove the isolation, before anything else is built · 5 min

The plan calls this non-negotiable (§06). Write it now, while there are three
tables rather than thirty. Every table added later earns its line here **in the
same commit as its migration**.

```bash
mkdir -p supabase/tests
cat > supabase/tests/0001_tenancy_probe.sql <<'PROBE_EOF'
-- Sonde d'étanchéité — trois acteurs, aucune ligne ne doit franchir la
-- frontière. À rejouer après CHAQUE migration : toute table ajoutée gagne sa
-- ligne ici dans le même commit que sa migration.
--
-- Tout se déroule dans une transaction annulée à la fin : la sonde ne laisse
-- rien derrière elle.
begin;

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-00000000000a','probe-a@test.invalid'),
  ('f0000000-0000-4000-8000-00000000000b','probe-b@test.invalid'),
  ('f0000000-0000-4000-8000-00000000000c','probe-c@test.invalid');
insert into restaurants (id, slug, name) values
  ('aaaaaaaa-0000-0000-0000-00000000000a','probe-a','Restaurant A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b','probe-b','Restaurant B');
insert into restaurant_members values
  ('aaaaaaaa-0000-0000-0000-00000000000a','f0000000-0000-4000-8000-00000000000a','owner',true,now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','f0000000-0000-4000-8000-00000000000b','owner',true,now());

create or replace function pg_temp.as_user(sub uuid) returns void
language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', sub::text, true);
end $$;

create or replace function pg_temp.check(label text, got bigint, want bigint)
returns text language sql as $$
  select case when got = want then '  OK   ' else '  ÉCHEC' end
         || ' · ' || label || ' — attendu ' || want || ', obtenu ' || got;
$$;

set local role authenticated;

-- Le patron de A ne voit que A.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000000a');
select pg_temp.check('A voit les restaurants',      (select count(*) from restaurants), 1);
select pg_temp.check('A voit les membres',          (select count(*) from restaurant_members), 1);
select pg_temp.check('A ne voit pas B',
       (select count(*) from restaurants where slug = 'probe-b'), 0);

-- Le patron de B ne voit que B.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000000b');
select pg_temp.check('B ne voit pas A',
       (select count(*) from restaurants where slug = 'probe-a'), 0);

-- Le convive ne voit rien du tout.
select pg_temp.as_user('f0000000-0000-4000-8000-00000000000c');
select pg_temp.check('Le convive ne voit aucun restaurant', (select count(*) from restaurants), 0);
select pg_temp.check('Le convive ne voit aucun membre',     (select count(*) from restaurant_members), 0);

reset role;
rollback;
PROBE_EOF
```

Paste it into the Supabase **SQL Editor** and run. Expected output — six
lines, all `OK`:

```
  OK    · A voit les restaurants — attendu 1, obtenu 1
  OK    · A voit les membres — attendu 1, obtenu 1
  OK    · A ne voit pas B — attendu 0, obtenu 0
  OK    · B ne voit pas A — attendu 0, obtenu 0
  OK    · Le convive ne voit aucun restaurant — attendu 0, obtenu 0
  OK    · Le convive ne voit aucun membre — attendu 0, obtenu 0
```

Everything runs inside a transaction that is rolled back, so the probe leaves
nothing behind and can be run against any environment, repeatedly.

The escalation guard was checked the same way and behaves: a **manager** of one
restaurant can create a waiter but is refused a manager or an owner; an
**owner** can create an owner; and the owner of *another* restaurant is refused
everything. That is `rm_grant` doing its job — it is what stops a middling
compromise from becoming a total one.

**The CI version replaces `set role` with three real Supabase clients** signed
in as three real users, because `set role` exercises the policies while a
genuine client also exercises the token path around them. Same assertions, one
layer lower.

---

## Step 8 — First commit and push · 2 min

```bash
git init
git add -A
git commit -m "Skeleton: Next.js 14, Supabase, multi-tenant schema + isolation probe"
git branch -M main
git remote add origin https://github.com/madjeiange-collab/nimbaa-resto.git
git push -u origin main
```

---

## Step 8b — Move the planning docs across · 1 min

The plan and this runbook currently live in `nimbaa-crm/docs/`, which was
convenient while there was nowhere else to put them. They belong to *this*
project.

```bash
mkdir -p docs
# from your nimbaa-crm checkout:
cp ../nimbaa-crm/docs/restaurant-ordering-plan.md docs/plan.md
cp ../nimbaa-crm/docs/bootstrap-new-repo.md       docs/bootstrap.md
git add docs && git commit -m "Bring the plan and the runbook home"
```

Then delete them from `nimbaa-crm` — a plan for one product sitting in another
product's repo is the kind of small untidiness that later reads as “these two
things are related”, which is precisely what the split exists to deny.

---

## Step 9 — Deploy to Vercel · 5 min

1. [vercel.com](https://vercel.com) → **New Project** → import `nimbaa-resto`.
2. *Settings → Environment Variables* — add the same four keys as `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `STAFF_EMAIL_DOMAIN`).
3. Deploy.

Do this on day one even though the app is an empty page. A pipeline that only
gets exercised at the end is a pipeline that fails at the end — and it fails on
the day you least want to be debugging environment variables.

---

## Step 10 — Verify before moving on

- [ ] `pnpm dev` serves <http://localhost:3000>
- [ ] `pnpm build` completes with no type errors
- [ ] The three tables exist in Supabase → *Table Editor*
- [ ] Each of the three shows **RLS enabled**
- [ ] `select is_member('00000000-0000-0000-0000-000000000000')` returns
      `false` rather than an error — the function exists and does not recurse
- [ ] `supabase/tests/0001_tenancy_probe.sql` prints six `OK` lines
- [ ] `.env.local` does **not** appear in `git status`
- [ ] The Vercel deployment is green

---

## What comes next

In order, from the plan's week-one list (§08):

1. **Wire the probe into CI** — Step 7b gives you the SQL version; port it to
   three real Supabase clients and run it on every push.
2. **`bootstrap-owner.mjs`** — create the restaurant and its first owner from
   the command line, the way this CRM's `bootstrap-admin.mjs` already does.
3. **Staff login** at `/r/<slug>/login`, forced password change, role routing.
4. **Owner creates staff** in the back office — only an owner may create a
   manager or another owner.

Then the menu, the tables, and the order → kitchen → serve loop. Nothing in
phase one waits on a third party: no Twilio account, no WhatsApp sender
approval, no SMS deliverability testing. That was the point of narrowing the
scope — see §0 of the plan.

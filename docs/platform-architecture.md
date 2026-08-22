# Nimbaa — Platform Architecture

> How several products sell under one trademark, with one login for a person
> and a separate subscription per app. Written in English like the other
> planning documents; the products themselves stay French-first.
>
> This supersedes the "separate repository, separate Supabase project" advice
> in `restaurant-ordering-plan.md` §02. That advice was right for two unrelated
> products. It is wrong for one platform, and §09 says why.

---

## 0. What Nimbaa is becoming

Not a CRM and, separately, a restaurant app. **One platform selling several
products to businesses**, where a person signs in once and sees the apps their
business pays for.

That single sentence changes the architecture, because it makes three things
first-class that neither product has today: the **organisation** that pays, the
**subscription** that grants a product, and the **role** a person holds inside
that product.

---

## 1. The access equation

Every read and every write in every product answers the same three questions:

```
   the person belongs to the organisation
   AND the organisation has a live subscription to this product
   AND the person has a role in that product
```

Resto already has the first and the third. **The middle one is the new
requirement, and it is the whole business model.** It is what lets you sell CRM
to one restaurant, Resto to another, and both to a third, from one deployment.

---

## 2. The decision

**One Supabase project. One `auth.users`. Products as Postgres schemas.**

```
core     organisations, subscriptions, memberships, product access
crm      the field-sales tables, when they migrate in
resto    restaurants, menu, orders, payments
public   left empty apart from shared extensions
```

One identity store gives "one login" for nothing — no identity provider to
build, run or pay for. And because entitlements live in the same database as
the data they gate, the check is a local join rather than a network call, which
means it can sit inside an RLS policy and be trusted.

Schemas also solve a collision you already have: the CRM has a `subscriptions`
table that tracks **rep commissions**, not billing. `core.subscriptions` and
`crm.subscriptions` coexist. Two tables of that name in one namespace would
not.

> **One Supabase setting is easy to miss.** PostgREST only exposes schemas
> listed in *Project Settings → API → Exposed schemas*. Add `core`, `crm` and
> `resto`, and address them from the client as
> `supabase.schema('resto').from('orders')`.

---

## 3. Why not a central identity provider with one project per product

Because it does not save the work you would be buying it to avoid.

Your CRM today has **83 RLS policies across 27 tables, 41 of them
`using (auth.uid() is not null)`, and no tenant concept at all.** The moment a
Resto user exists in the same identity system, those 41 policies are a hole —
and that is true whether identity is central or local. **Both options require
the same rewrite.**

So the central-IdP option costs you an IdP to operate or a vendor to pay,
entitlement data replicated across projects or fetched over the network, a
warehouse for cross-product reporting, and n× the migrations — in exchange for
nothing you were not already paying for.

The one thing it genuinely buys is physical blast-radius separation. That is
worth revisiting at a scale you do not have, and §12 names the trigger.

---

## 4. The core schema

Verified: applied to Postgres 16, with the entitlement behaviour in §5 proven
against it.

```sql
create schema if not exists core;
create extension if not exists "uuid-ossp";

create table if not exists core.organizations (
  id                uuid primary key default uuid_generate_v4(),
  slug              text not null unique,
  name              text not null,
  country           text,
  currency          text not null default 'XOF',
  currency_decimals smallint not null default 0,
  status            text not null default 'active'
                      check (status in ('active','suspended')),
  created_at        timestamptz not null default now()
);

create table if not exists core.org_members (
  org_id     uuid not null references core.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_role   text not null check (org_role in ('owner','admin','member')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists om_user_ix on core.org_members (user_id, org_id) where active;

create table if not exists core.product_subscriptions (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid not null references core.organizations(id) on delete cascade,
  product      text not null check (product in ('crm','resto')),
  plan         text not null default 'standard',
  -- past_due donne encore accès : couper le service d'un restaurant à 20h
  -- parce qu'une carte a été refusée est une faute, pas une politique.
  status       text not null
                 check (status in ('trialing','active','past_due','cancelled','suspended')),
  period_start timestamptz not null default now(),
  period_end   timestamptz,
  grace_until  timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, product)
);
create index if not exists ps_live_ix on core.product_subscriptions (org_id, product)
```

*(full file, including `core.product_access`, in §14)*

**The organisation is the customer; a restaurant is a location.** A group with
three sites is one organisation, three rows in `resto.restaurants`, one
subscription. That distinction is why `org_id` and not `restaurant_id` is the
thing subscriptions hang from.

**`core.product_access` is foreign-keyed to `core.org_members`**, so product
access cannot outlive membership. You do not keep a waiter in the kitchen of an
organisation he has left.

---

## 5. The predicate every policy leans on

```sql
create or replace function core.has_product(org uuid, prod text) returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.is_org_member(org)
     and core.subscription_live(org, prod)
     and exists (
       select 1 from core.product_access a
       where a.org_id = org and a.user_id = auth.uid()
         and a.product = prod and a.active
     );
$$;
```

A product table then reads:

```sql
create policy resto_read on resto.restaurants for select
  using (core.has_product(org_id, 'resto'));
```

**Cancel a subscription and access stops. No deploy, no feature flag, no code.**
That is the property being bought, and it was tested rather than assumed:

| Subscription state | What the owner sees |
|---|---|
| `active` | the restaurant |
| `trialing` | the restaurant |
| `past_due`, within grace | the restaurant |
| `past_due`, grace expired | **nothing** |
| `past_due`, no grace set | **nothing** |
| `cancelled` | **nothing** |
| `suspended` | **nothing** |
| reactivated | the restaurant |

Two negative cases matter as much: an **org member with no product access**
sees nothing, and a **stranger** sees nothing.

### The bug this already caught

The first draft of `subscription_live` read:

```sql
and s.status in ('trialing','active','past_due')
and (s.period_end is null or s.period_end > now()
     or (s.status = 'past_due' and s.grace_until > now()))
```

`period_end is null` is true for every row until billing is wired, so the OR
short-circuited and **the grace check was never consulted** — an unpaid
subscription kept working indefinitely. A billing hole, in the first ten lines
of the billing layer. It is now two explicit branches, and the table above is
the regression test.

**Every product migration ships its line in that table, in the same commit.**

---

## 6. Grace is a product decision, not a technicality

`past_due` still grants access, deliberately. Cutting a restaurant's ability to
take orders at 20:00 on a Friday because a card was refused is a fault, not a
policy — and it costs you the customer you were trying to bill.

Revocation should be an act someone takes: `cancelled` or `suspended`. Between
those, grace.

Worth adding when billing arrives: **past grace, read-only rather than dark.**
Let them read and export their own data even when they cannot write. It is
kinder, and it is the right answer on data portability.

---

## 7. Identity — one person, one account

One login means a person is one row in `auth.users`, across every product.

That sits awkwardly with Resto's synthetic address
(`fatou@le-bambou.staff.nimbaa.app`), which was the right answer for floor staff
who own no email. The resolution is that **the two are for different people**:

| Who | Identity | Why |
|---|---|---|
| Floor staff — waiter, kitchen, cashier | username + synthetic address | They have no email. They will never touch a second product. |
| Owner, manager, anyone spanning products | **their real email or phone** | One person, one account, every product they are entitled to. |

The login form accepts either: an input containing `@` is treated as an email,
anything else is resolved as a username against that restaurant. A floor-staff
account that later needs cross-product access has its address changed to a real
one — supported by Supabase Auth, and a one-row update.

---

## 8. What each product carries

Every product table carries `org_id` **in clear**, never reachable by join, and
every policy calls `core.has_product(org_id, '<product>')`.

For Resto that is a small change now:

- `resto.restaurants` gains `org_id`
- `is_member()` becomes `core.has_product(org_id,'resto')` plus the restaurant
  check
- `staff_accounts` keeps its username alias; the identity moves up to `core`

**One day of work now. A migration across every table later.**

---

## 9. Repository — a monorepo, reversing earlier advice

```
nimbaa-platform/
  apps/
    accounts/     one login, org switcher, billing later
    crm/
    resto/
  packages/
    core/         auth + entitlement client, shared by every app
    ui/           the shadcn kit, shared
  supabase/
    migrations/   core, then per-product
    tests/        the probe suite
```

Earlier in this project I recommended separate repositories, and for two
unrelated products that was right. Under one platform it is wrong, and the
deciding factor is `packages/core`.

In separate repositories that package must be published and versioned, and it
**will** drift. A drifted entitlement check is a billing bug — either a customer
paying for nothing or using something free. Keeping it in one tree, compiled
against every app on every commit, removes an entire failure class.

---

## 10. Deployment

One Supabase project. One Vercel project **per app**, all from the monorepo,
each with its own Root Directory (`apps/resto`, `apps/crm`) and its own domain.

That is the same mechanism we already met on the Vercel import screen — except
here it is the intended pattern rather than a way around a constraint.

Set an **Ignored Build Step** per project so a CRM commit does not rebuild
Resto:

```bash
git diff --quiet HEAD^ HEAD -- apps/resto packages/
```

### Nothing a tenant reads is cacheable

Next caches every `fetch` a Server Component makes, and with no `cache-control`
coming back from PostgREST that default is *keep it forever*. Both products are
live shared views of one business: the patron edits the carte on his phone
while the waiter reads it on a tablet, and a CRM user changes a pipeline stage
that a colleague is looking at. A cached read there is a plate ordered from a
menu that no longer exists.

So the Supabase clients — request-scoped and service-role alike — pass
`cache: 'no-store'`, at the client, once:

```ts
global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) }
```

At the client and not on each page, because the failure mode of the per-page
version is a **new page someone forgot to mark**, and that page will be serving
one tenant's stale rows without anything looking wrong. This was found by a
test that reordered two dishes and read the old order back after a full reload.

---

---

## 11. Migrating the CRM in

**The CRM is sold to external organisations.** That is now settled, and it makes
this section the largest piece of work on the platform — larger than it looks,
because the problem is not only the 41 open policies.

### The CRM cannot host two customers today

Its configuration is **global**, with no owner column at all:

| Table | Owner column | Consequence for a second customer |
|---|---|---|
| `pipeline_stages` | none | They share your first customer's sales stages |
| `products` | none | They share the catalogue |
| `install_protocol_steps` | none | They share the installation checklist |
| `do_not_knock_list` | none | They share the do-not-knock addresses |
| `app_settings` | none — **`key` is the primary key** | They **overwrite** each other's settings |

That last row is the sharpest. `app_settings.key` being a global primary key
means two customers cannot both hold a setting of the same name — the second
write wins. It is not a leak that careful policies could contain; it is a hard
collision, and it means **the CRM is architecturally single-customer right
now**, quite apart from RLS.

Which is good news of a sort: this is discovered before the second sale rather
than after it.

### The shape of the work

1. **`org_id` on all 27 tables**, backfilled to a single organisation holding
   every existing row. Additive, no behaviour change, safe to ship alone.
2. **Composite keys where the key is global.** `app_settings` moves from
   `primary key (key)` to `primary key (org_id, key)`. Same for any other
   natural key that assumed one customer.
3. **Config tables become per-organisation, and the organisation owns them.**
   Each customer defines their own pipeline stages, products and protocol
   steps — Nimbaa does not impose a template. See §11.2, because an empty CRM
   on day one is not an acceptable answer either.
4. **83 policies reviewed, 41 rewritten** to
   `core.has_product(org_id, 'crm')`. The other 42 are narrow already
   (`auth.uid() = user_id` and similar) and are safe by accident rather than by
   design — they still get read, and get `org_id` added where the table is
   shared.
5. **`users` folds into `core`.** `role` becomes a CRM product role;
   `can_do_b2b` / `can_do_d2d` become product-level capabilities.
6. **A probe line per table**, in the same commit as its migration.

Step 3 is the one that is usually underestimated: it is product work, not
plumbing.

### 11.1 Currency is baked into the CRM's column names

Each organisation choosing its own currency collides with how the CRM stores
money today:

| What | Count | Problem |
|---|---|---|
| Columns named `*_xof` | **15** — `value_xof` ×8, `base_xof` ×3, `monthly_price_xof` ×2, `price_xof`, `amount_xof` | A column called `monthly_price_xof` is a lie for a EUR organisation |
| `"FCFA"` hardcoded in `src/` | **33** | The symbol is a literal, not a lookup |
| `toLocaleString('fr-FR')` | 21 | Groups digits; knows nothing of currency or decimals |
| Currency formatting helper | **0** | There is nowhere to fix it once |

The good news is that the hard part is already right: **every money column is
`bigint`**, so amounts are integers and no float has ever touched them. XOF has
no subdivision, so today's integers happen to be whole units — a EUR
organisation needs the same integers read as hundredths.

So the retrofit is naming and presentation, not arithmetic:

1. Rename the 15 columns to drop the currency (`value_xof` → `value_amount`),
   with the minor-unit contract in a comment.
2. **One `formatMoney(amount, org)` helper**, driven by
   `core.organizations.currency` and `currency_decimals`, replacing all 33
   literals and the bare `toLocaleString`.
3. `Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals })`.

**Currency lives on `core.organizations`, and only there.** Resto currently
carries its own `restaurants.currency`; it moves up when Resto is rebuilt on
`core`. One organisation, one currency — a group with three restaurants prices
them all the same way.

### 11.2 Somebody has to fill the CRM before it is useful

The organisation decides its own configuration. That is the right answer, and
it leaves a hole: a brand-new customer signs in to a CRM with no pipeline, no
products and no protocol, which is not a product — it is a blank database with
a login.

The resolution is that **offering is not imposing**:

- Onboarding presents a **starter set** — a conventional pipeline, an empty
  catalogue, a default protocol — that the owner may apply, edit, or skip
  entirely.
- Nothing is created behind their back, and everything applied is editable
  afterwards.
- The setup flow is part of onboarding, not an admin screen they must go
  looking for.

This is product work and it sits on the critical path: without it, the CRM
cannot be handed to a second customer even once every policy is correct.

## 12. What to build now, and what to leave alone

**Now** — the shape:

- `core` schema, the four tables, the three predicates
- Resto rebuilt on `core.has_product`, dropping its own `currency` column in
  favour of the organisation's
- The entitlement table in §5 as a probe, in CI
- Subscription rows written **by hand**

**Before the CRM's second customer** — not optional, and not plumbing:

- The currency retrofit of §11.1
- The onboarding starter set of §11.2

**Not now** — the machinery. No Stripe, no plan picker, no self-serve signup,
no dunning, no invoices, no proration. Setting a row by hand is entirely
respectable at three organisations, and it writes to the same table billing
will write to later.

**Not now, with a named trigger** — splitting a product onto its own Supabase
project. Do it when one product's load, compliance obligations or uptime needs
genuinely diverge from the others. `org_id` on every row is what keeps that
door open, because the data can be filtered out cleanly.

The expensive-to-reverse decisions are `org_id` everywhere and the predicate in
every policy. Everything else in this document can wait.

---

## 13. Risks

| Risk | What it forces |
|---|---|
| **One database, one blast radius** | The probe suite in CI, PITR backups on, and `org_id` everywhere so a product can be lifted out later |
| **An entitlement bug is a billing bug** | The §5 table as a regression test; a new line per product, per migration |
| **A product policy forgets the entitlement check** | A test that enumerates policies and fails on any product table whose policy does not call `has_product` |
| **Exposed-schema misconfiguration** | `core`, `crm`, `resto` in *Exposed schemas*; a smoke test that a client can actually read its own product |
| **The CRM retrofit** | 41 policies, one at a time, each with its probe — not a weekend rewrite |
| **Predicate cost in hot paths** | Wrap as `(select core.has_product(...))` so Postgres evaluates it once per query rather than per row; index `org_members(user_id, org_id)` and `product_subscriptions(org_id, product)` |

---

## 14. Open questions

1. **Does a person ever belong to two organisations?** A consultant serving
   three restaurants, say. The schema allows it; the interface then needs an
   organisation switcher, which is real work. Worth deciding before the
   accounts app is built.
2. ~~Is the CRM sold to outside businesses?~~ **Answered: yes.** See §11 —
   this makes the CRM retrofit a real project, and it puts a deadline on it:
   the work must land before the second customer, not after.
3. ~~Who seeds a new customer's configuration?~~ **Answered: the organisation
   does.** It also chooses its own currency. See §11.1 and §11.2 — the first
   makes the CRM's `*_xof` columns and 33 hardcoded `FCFA` a retrofit of their
   own; the second makes an onboarding starter set a prerequisite for the
   second sale.
4. **Per-seat or per-organisation pricing?** Per-seat means counting
   `product_access` rows and enforcing a ceiling — cheap now, awkward to add
   once customers have unlimited seats by habit.
5. **Trials** — self-serve or granted by hand? `trialing` already works; the
   question is who may create one.
6. **Which product is sold first to a business that already has the other?**
   That sale is the trigger in §11, and knowing which direction it goes tells
   you which retrofit to rehearse.

---

## 15. The core schema in full

```sql
-- core — la couche plateforme : qui est l'organisation, à quoi elle est
-- abonnée, et qui chez elle a le droit d'ouvrir quel produit.
--
-- Trois faits doivent être vrais pour qu'une ligne soit visible :
--   la personne appartient à l'organisation,
--   l'organisation a un abonnement vivant au produit,
--   la personne a un rôle dans ce produit.
-- Le deuxième est ce qui rend un produit vendable séparément.

create schema if not exists core;
create extension if not exists "uuid-ossp";

create table if not exists core.organizations (
  id                uuid primary key default uuid_generate_v4(),
  slug              text not null unique,
  name              text not null,
  country           text,
  currency          text not null default 'XOF',
  currency_decimals smallint not null default 0,
  status            text not null default 'active'
                      check (status in ('active','suspended')),
  created_at        timestamptz not null default now()
);

create table if not exists core.org_members (
  org_id     uuid not null references core.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_role   text not null check (org_role in ('owner','admin','member')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists om_user_ix on core.org_members (user_id, org_id) where active;

create table if not exists core.product_subscriptions (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid not null references core.organizations(id) on delete cascade,
  product      text not null check (product in ('crm','resto')),
  plan         text not null default 'standard',
  -- past_due donne encore accès : couper le service d'un restaurant à 20h
  -- parce qu'une carte a été refusée est une faute, pas une politique.
  status       text not null
                 check (status in ('trialing','active','past_due','cancelled','suspended')),
  period_start timestamptz not null default now(),
  period_end   timestamptz,
  grace_until  timestamptz,
  created_at   timestamptz not null default now(),
  unique (org_id, product)
);
create index if not exists ps_live_ix on core.product_subscriptions (org_id, product)
  where status in ('trialing','active','past_due');

create table if not exists core.product_access (
  org_id     uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  product    text not null,
  role       text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, product, role),
  -- L'accès produit ne peut pas survivre à l'appartenance : on ne garde pas un
  -- serveur dans la cuisine d'une organisation qu'il a quittée.
  foreign key (org_id, user_id) references core.org_members(org_id, user_id) on delete cascade
);

-- ------------------------------------------------------------- prédicats
create or replace function core.subscription_live(org uuid, prod text) returns boolean
language sql stable security definer set search_path = core, public as $$
  select exists (
    select 1 from core.product_subscriptions s
    where s.org_id = org and s.product = prod
      and (
        -- Payé ou en essai : vivant jusqu'à la fin de période.
        (s.status in ('trialing','active')
          and (s.period_end is null or s.period_end > now()))
        or
        -- En retard : vivant seulement pendant le délai de grâce. Un OR à plat
        -- sur period_end laisserait passer un impayé indéfiniment, la période
        -- n'étant renseignée qu'une fois la facturation branchée.
        (s.status = 'past_due'
          and s.grace_until is not null and s.grace_until > now())
      )
  );
$$;

create or replace function core.is_org_member(org uuid) returns boolean
language sql stable security definer set search_path = core, public as $$
  select exists (
    select 1 from core.org_members m
    where m.org_id = org and m.user_id = auth.uid() and m.active
  );
$$;

-- Le prédicat que porte chaque policy produit.
create or replace function core.has_product(org uuid, prod text) returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.is_org_member(org)
     and core.subscription_live(org, prod)
     and exists (
       select 1 from core.product_access a
       where a.org_id = org and a.user_id = auth.uid()
         and a.product = prod and a.active
     );
$$;

create or replace function core.has_product_role(org uuid, prod text, roles text[])
returns boolean
language sql stable security definer set search_path = core, public as $$
  select core.has_product(org, prod)
     and exists (
       select 1 from core.product_access a
       where a.org_id = org and a.user_id = auth.uid()
         and a.product = prod and a.active and a.role = any(roles)
     );
$$;
```

# Restaurant Ordering Platform — Build Plan

> Working document. Written in English because that's the language of our
> exchanges; the **product itself is French-first** (`next-intl`, `fr` default,
> `en` fallback) exactly like the CRM.

---

## 0. What we are building

A multi-restaurant SaaS where a diner scans the QR code glued to their table,
reads the menu, and sends an order. The restaurant sees it arrive, routes each
item either to a preparation station or straight to the tray, serves it, and
collects payment. A waiter can do the whole thing from their own phone without
any customer involvement — the QR is one entry point among several, never a
prerequisite.

---

## 1. Decisions already taken

| Question | Decision |
|---|---|
| Tenancy | **Multi-restaurant SaaS.** One deployment, many restaurants, tenant-isolated. |
| Payment | **All three, phased.** Cash first; mobile money and online card plug into the same `payments` table without a rewrite. |
| QR order routing | **Configurable per restaurant** (and overridable per table). |
| Codebase | **New repo, new Supabase project**, same stack and conventions as the CRM. |

### Why a separate repo and a separate Supabase project

Not tidiness — isolation. This repo's RLS grants broad reads to any signed-in
user (`create policy de_read … using (auth.uid() is not null)`, and the same
pattern across the field tables). That is coherent for a single-company CRM
where everyone signed in is a colleague. Put restaurant staff — hundreds of
accounts across dozens of unrelated businesses — into that same Supabase
project and every one of them lands inside `auth.uid() is not null`. Retro-
fitting tenant scoping onto thirty-five existing migrations is a bigger job
than starting clean, and a riskier one, because the failure is silent.

What gets **reused** (copied, not shared): the Next.js 14 App Router skeleton,
`src/lib/supabase/*` client wrappers, the `next-intl` routing setup, the
shadcn/ui kit and Tailwind config, the numbered-migration convention with
prose comments explaining *why* a table exists, and `public/manuel.html` as the
model for end-user documentation.

Stack: Next.js 14 (App Router) · TypeScript · Tailwind + shadcn/ui ·
Supabase (Postgres, Auth, Realtime, Storage) · Vercel · `zod` at every boundary.

---

## 2. The one idea the whole schema hangs on

**The table session is the spine, not the order.**

A diner does not place one order. They place a round, then another round forty
minutes later, and a coffee after that. All of it is one bill. If `orders` is
the top-level object, every bill becomes a fragile join and split payments
become guesswork.

So: a **service session** opens the moment a table starts consuming and closes
when it is paid. Orders are rounds appended to it. The bill is the session.

```
service_session  (table 12, opened 19:42, 4 guests, waiter Fatou)
├── order #1  channel=qr      19:42   [3 lines]
├── order #2  channel=waiter  20:15   [1 line]
└── order #3  channel=qr      20:58   [2 lines]
└── payments: 250 000 GNF cash  →  session closed 21:20
```

**Second idea: routing is a property of the line, not the order.**

"Sent to the kitchen for preparation, or served directly by the waiter" is not
an order-level choice a human makes each time — it falls out of *what was
ordered*. A grilled fish has a preparation station. A bottle of water does not.
One order containing both fans out: the fish becomes a kitchen ticket, the
water appears immediately in the waiter's "to serve" list.

`menu_items.prep_station_id` nullable. `null` means direct service. That single
column expresses the whole requirement, and it stays correct when an order
mixes both kinds — which is the normal case, not the edge case.

---

## 3. Roles and surfaces

Five surfaces, one codebase, one deployment.

| Surface | Who | Auth | Route |
|---|---|---|---|
| **Diner** | anyone at a table | none — opaque cookie | `/t/<table_token>` |
| **Waiter** | floor staff, phone | Supabase auth | `/service` |
| **Kitchen (KDS)** | station screens, tablet | Supabase auth, kiosk | `/station/<id>` |
| **Cashier** | till | Supabase auth | `/caisse` |
| **Manager / Owner** | back office | Supabase auth | `/admin` |

Roles on `restaurant_members.role`: `owner`, `manager`, `waiter`, `kitchen`,
`cashier`. One person can hold several roles, and can belong to several
restaurants — a manager who owns two locations is one account, two memberships.
A **platform admin** flag sits outside tenancy for support access, and every
use of it is written to an audit table.

---

## 4. Data model

Sketch, not final DDL. Amounts are `bigint` in the currency's minor unit; see
§8 on money.

### Tenancy

```sql
restaurants (
  id, slug unique, name, timezone, currency, currency_decimals,
  qr_order_mode  text check (qr_order_mode in ('auto','confirm','menu_only')),
  service_charge_bp int,         -- basis points, 0 = none
  tax_mode       text,           -- 'inclusive' | 'exclusive' | 'none'
  status         text,           -- 'active' | 'suspended'
  created_at
)

restaurant_members (restaurant_id, user_id, role, active, created_at)
  primary key (restaurant_id, user_id, role)
```

### Floor

```sql
areas   (id, restaurant_id, name, sort)        -- salle, terrasse, étage
tables  (id, restaurant_id, area_id, label, seats,
         qr_token text unique,                 -- opaque, rotatable
         qr_order_mode text null,              -- null = inherit restaurant
         status text)                          -- 'open' | 'closed'
```

### Menu

```sql
menu_categories (id, restaurant_id, name, sort, active)
menu_items      (id, restaurant_id, category_id, name, description,
                 price bigint, photo_path,
                 prep_station_id null,         -- NULL = served directly
                 available bool,               -- the "86" switch
                 tags text[], allergens text[], sort)
modifier_groups (id, restaurant_id, name, min_select, max_select, required)
modifiers       (id, group_id, name, price_delta bigint, available)
item_modifier_groups (item_id, group_id, sort)
prep_stations   (id, restaurant_id, name)      -- cuisine, bar, grill
```

Menu edits must never rewrite history: prices and names are **snapshotted onto
order lines** at submit time. A price change at 20:00 leaves the 19:42 bill
alone.

### Service

```sql
service_sessions (
  id, restaurant_id, table_id,
  status text,          -- open | bill_requested | settled | closed | cancelled
  guest_count int, waiter_id null,
  opened_at, closed_at,
  subtotal, service_charge, tax, discount, total, paid  -- all bigint, denormalised
)

orders (
  id, restaurant_id, session_id,
  channel text,         -- 'qr' | 'waiter' | 'counter'
  status  text,         -- pending | accepted | rejected | cancelled
  placed_by_staff null, placed_by_customer null,
  note text, created_at, decided_at, decided_by null
)

order_items (
  id, restaurant_id, order_id, menu_item_id null,
  name_snapshot text, unit_price bigint, qty int,
  modifiers jsonb,      -- [{name, price_delta}] snapshotted
  line_total bigint,
  prep_station_id null, -- snapshotted: NULL ⇒ direct service
  status text,          -- pending | queued | preparing | ready | to_serve
                        --   | served | voided
  note text,
  queued_at, ready_at, served_at, voided_at, void_reason
)

order_events (id, restaurant_id, order_id, order_item_id null,
              kind, from_label, to_label, actor_id null, at)
```

`order_events` is append-only with no update or delete policy — the same
reasoning as `deal_events` in the CRM: *a journal you can rewrite is not worth
keeping.* It is what answers "the customer says they ordered at 19:30 and it
came at 20:40" three days later.

### Payment

```sql
payments (
  id, restaurant_id, session_id,
  method text,          -- 'cash' | 'card_terminal' | 'mobile_money' | 'card_online'
  amount bigint, tendered bigint null, change bigint null,
  status text,          -- pending | captured | failed | refunded
  provider text null, provider_ref text null, provider_payload jsonb null,
  collected_by null, created_at, captured_at
)
```

Cash on day one uses `method='cash', status='captured'` and ignores every
provider column. Mobile money and Stripe fill them in later — **no schema
migration, no rewrite**, which is exactly what "phased" was meant to buy. A
session can carry several payments: that is what a split bill *is*.

### Customer identity and small asks

```sql
customer_sessions (id, restaurant_id, table_id, session_id null,
                   token_hash, created_at, last_seen_at, user_agent)

service_requests  (id, restaurant_id, table_id, session_id null,
                   kind,           -- 'call_waiter' | 'bill' | 'water'
                   status, created_at, handled_at, handled_by)
```

No diner account, ever. A diner is a cookie. `service_requests` is four hours
of work and removes the single most common reason a diner gets up and goes
looking for someone.

---

## 5. The flows

### 5.1 Scan → order

1. QR encodes `https://app/t/<qr_token>` — opaque token, never the table number.
2. The page resolves restaurant + table, checks the effective `qr_order_mode`
   (table override, else restaurant), and issues a customer-session cookie.
3. Menu renders from the restaurant's categories, hiding `available = false`.
4. Cart is local; submit posts to a server route handler.
5. On submit, server-side and inside one transaction: re-check availability
   (an item 86'd while the diner browsed must fail *here*, not at the pass),
   recompute every price from the database — **never trust a client-sent
   total** — open or reuse the table's session, write `orders` + `order_items`.
6. Then, by mode:
   - `auto` — order `accepted`; each line goes `queued` if it has a station,
     `to_serve` if not.
   - `confirm` — order `pending`; it appears in the waiter's confirmation
     queue. The waiter validates, corrects quantities, or rejects with a
     reason. Acceptance runs the same fan-out.
   - `menu_only` — no cart at all: menu plus a "call the waiter" button.
7. The diner keeps a live status view of their own session — their lines only,
   scoped by the cookie.

### 5.2 Waiter takes the order directly

Same cart, denser UI, no confirmation step — a waiter's input *is* the
confirmation. Table map → pick table → add items → submit. Round 2 on an open
session is one tap. This surface must be usable one-handed on a cheap Android
phone standing up: large targets, no hover, no modal traps.

### 5.3 Kitchen

One screen per station at `/station/<id>`, subscribed to its own lines.
Tickets grouped by order, oldest first, with an elapsed-time badge that turns
amber then red past the item's target time. Two actions and no more: **start**
(`queued → preparing`) and **ready** (`preparing → ready`). Bump-back for
mistakes. Ready lines leave the station screen and land in the waiter's
"to serve" list.

`to_serve` lines from direct-service items never touch this screen — they
appear in the waiter's list the instant the order is accepted. That is the
"served directly by the waiter" path, and it costs no extra code because it is
the *absence* of a station, not a special case.

### 5.4 Serve

The waiter's "to serve" list is everything `ready` or `to_serve` on their
tables. Marking served stamps `served_at`, which is what later gives us real
service-time numbers instead of anecdotes.

### 5.5 Pay and close

Open the session bill: lines, subtotal, service charge, tax, discount, total.
Cash: enter tendered, the app computes change, `payments` row captured,
session `settled` then `closed`, table freed. Split by amount or by line —
several `payments` rows against one session, closing when the sum reaches the
total. Receipt as printable HTML first; ESC/POS thermal printing in the
hardening phase.

---

## 6. Tenant isolation — the thing most likely to sink this

Two different problems, deliberately solved two different ways.

**Staff** are real Supabase users. RLS everywhere, keyed on membership:

```sql
create or replace function is_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from restaurant_members m
    where m.restaurant_id = rid and m.user_id = auth.uid() and m.active
  );
$$;

alter table orders enable row level security;
create policy orders_read on orders for select using (is_member(restaurant_id));
```

Every tenant table carries `restaurant_id` **directly** — never "reachable by
join". Denormalised on purpose: a policy that has to walk two joins to find the
tenant is a policy nobody will get right at 2am, and Postgres plans it badly.

**Diners** are not Supabase users and must not become one. Anonymous auth would
mean encoding "this cookie may read these seven rows" into RLS, and the blast
radius of getting it wrong is every bill in the platform. Instead: the diner
app talks only to **Next.js route handlers**, which verify the table token and
the session cookie server-side before touching the database. RLS on those
tables stays deny-by-default for the anon key — defence in depth, not the
primary control.

Non-negotiables:

- A seed-and-probe test suite: two restaurants, cross-tenant read/write
  attempts on every table, asserted to return zero rows. It runs in CI.
- Every new table ships with its policies in the same migration. No exceptions.
- The service-role key is server-only and never reaches a client bundle.
- Rotating a table's `qr_token` invalidates its printed code, for when a QR
  sheet ends up photographed and posted online.

---

## 7. Realtime and weak connectivity

Assume the CRM's operating conditions: entry-level Android, patchy data.

- Supabase Realtime per restaurant channel; staff screens subscribe to their
  own slice. **Polling fallback** every 10s when the socket is down — a KDS
  that silently stops receiving tickets is worse than one that is visibly slow.
- Waiter mutations are optimistic with a local queue and retry. Sending an
  order must never be lost to a dead lift.
- Idempotency keys on order submit: a retried POST must not double the round.
- KDS caches its ticket list; a reload mid-service reopens on the same state.

---

## 8. Money

- **Integer minor units, `bigint`, always.** No floats anywhere near a total.
- `restaurants.currency_decimals` because GNF and XOF have no subdivision while
  EUR has two. Hardcoding cents breaks the first Conakry restaurant.
- Totals are computed server-side, stored denormalised on the session, and
  recomputed-and-compared on close.
- Voids are a status plus a reason, never a delete. A line that was made and
  sent back is data the owner needs.
- Every mutation of money passes through `order_events` or `payments`.

---

## 9. Milestones

Sized for one developer with AI assistance. Each milestone is a vertical slice
that ends in something demonstrable.

| # | Milestone | Ships | ~Size |
|---|---|---|---|
| **M0** | Foundations | Repo, Supabase project, auth, `restaurants` + `restaurant_members`, `is_member()`, role routing, fr/en i18n, base layout | 1w |
| **M1** | Menu & floor | Admin CRUD: categories, items, modifiers, stations, areas, tables. QR generation + printable sheet | 1w |
| **M2** | **Scan → kitchen → serve** | Diner menu + cart + submit, three QR modes, waiter confirmation queue, KDS, to-serve list, realtime, `order_events` | 2w |
| **M3** | Waiter entry | Table map, staff cart, rounds on an open session, `service_requests` | 1w |
| **M4** | Bill & cash | Session bill, discounts, service charge, split, cash payment, close, HTML receipt | 1w |
| **M5** | Numbers | Service-day dashboard, sales by item/category/waiter, service times, end-of-shift Z report | 1w |
| **M6** | Mobile money | `payment_intents`, provider adapter (Orange Money / MTN MoMo), webhooks, reconciliation, pay-at-table QR | 1–2w |
| **M7** | Card online | Stripe adapter behind the same interface | 1w |
| **M8** | Hardening | Offline queue, abuse controls, ESC/POS printing, menu translation, allergens, `manuel.html` | ongoing |

**M0–M2 is the point of no return** — at the end of M2 a restaurant can take a
QR order and cook it. **M0–M4 is a service that can actually run.** Everything
after M4 makes it sellable rather than usable.

### The first week, concretely

1. Create the repo and Supabase project; copy the CRM's `lib/supabase`, i18n
   config, Tailwind and shadcn setup.
2. `0001_tenancy.sql`: `restaurants`, `restaurant_members`, `is_member()`, RLS
   on both, and the cross-tenant probe test.
3. Staff login + a `/` that routes by role.
4. Owner onboarding: create a restaurant, become its `owner`.
5. Deploy to Vercel on day 5, even empty. A pipeline that only gets exercised
   at the end is a pipeline that fails at the end.

---

## 10. Risks, and what each one forces

| Risk | Forces |
|---|---|
| **Cross-tenant leak** — one restaurant reads another's orders | `restaurant_id` on every table, `is_member()` policies written with the table, automated probe suite in CI |
| **QR abuse** — a passerby fires tickets, or the code is posted online | `confirm` mode by default, rotatable tokens, per-table rate limits, no prices accepted from the client |
| **Price drift** — menu edited mid-service | Snapshot name, price and station onto the line at submit |
| **Lost tickets** — connection dies between phone and pass | Idempotent submit, optimistic queue with retry, polling fallback, KDS state cached |
| **86'd items** — sold out between render and submit | Availability re-checked server-side inside the submit transaction |
| **Two waiters, one table** | Append-only rounds instead of a shared editable cart; no last-write-wins |
| **Money rounding** | Integer minor units, per-restaurant decimals, server-side totals only |
| **Screen unusable in real service** | Test on a cheap Android, standing, one-handed, in a noisy room — not on a laptop |

---

## 11. Explicitly out of scope for v1

Named so they don't creep in: delivery and third-party aggregators, table
reservations, stock and recipe costing, payroll, loyalty programmes, a native
mobile app, multi-currency within one restaurant, accounting export beyond CSV.

---

## 12. Open questions

1. **Target market** — Guinea/West Africa (drives GNF, Orange Money, offline
   tolerance) or Europe (EUR, card, VAT rules)? It changes M6 entirely.
2. **Fiscal rules** — does the target market impose certified receipts or fiscal
   printers? That is a hard constraint, cheap now and expensive later.
3. **Takeaway / counter orders** — the `channel='counter'` value is reserved,
   but is a no-table flow in v1 scope?
4. **Menu photos** — is the owner uploading them, and do we need the CRM's
   `browser-image-compression` treatment for slow uploads?
5. **Pricing model** — per restaurant per month, or a cut of throughput? It
   decides whether M5 needs platform-level billing metering.

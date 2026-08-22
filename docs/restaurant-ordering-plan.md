# Restaurant Ordering Platform — Build Plan

> Working document. English because that's the language of our exchanges; the
> **product is French-first** (`next-intl`, `fr` default) exactly like the CRM.
>
> **This revision narrows the scope deliberately.** The earlier draft built the
> QR diner journey and the waiter's own order entry at the same time. That draft
> is in git history if you want it; what follows replaces it.

---

## 0. What ships first

**The restaurant takes its own orders.** A waiter opens a table, adds a round,
the kitchen sees what it must cook, the waiter serves it, the till takes cash,
the table closes. One product, usable by one restaurant, for a full service.

The diner scanning a QR code is **phase two**. It is not cancelled and it is not
designed away — §10 says exactly how it lands on top of what phase one builds
without touching it.

### Why this is the right cut

- **It removes every external dependency.** No Twilio account, no WhatsApp
  sender approval, no SMS deliverability testing in Guinea. The previous plan's
  one multi-week lead time was WhatsApp approval blocking a milestone while all
  the code sat finished. That risk is now simply absent.
- **It removes the whole third population.** No diner accounts, no OTP, no
  anonymous browsing, no confirm-gate, no diner-side RLS, no customer Realtime,
  no rate limiting on paid messages, no `customer_blocks`.
- **It is the half a restaurant cannot run without.** A restaurant with no QR
  codes still takes orders. A restaurant with QR codes and no waiter flow serves
  nobody at the tables that did not scan.
- **It gets to a real pilot in about five weeks instead of eight**, and every
  week of that pilot teaches you something about the menu, the pass and the
  till that would otherwise be guessed at while building the diner app.

### In, and out

| In scope — phase one | Out, and deferred to §10 |
|---|---|
| Staff accounts, username + password | QR codes, diner accounts, OTP |
| Menu: categories, items, prices, stations | Item modifiers and option groups |
| Tables and areas | Mobile money, card, any online payment |
| Waiter takes an order, in rounds | Platform console, TOTP, invites, access log |
| Kitchen screen, or direct service | Split-by-item, service charge and tax UI |
| Serve, then cash, then close | Reports beyond a day view, thermal printing |
| A day view: what was sold, by whom | Offline queue, order history, reorder |

---

## 1. The four bones that must be right now

Simplifying the surface is cheap. Getting these four wrong is not — each one is
a rewrite or a data migration later rather than an added column.

**1 · `restaurant_id` on every table, in clear.** Never "reachable by join".
Retrofitting tenancy is the thing that made a separate project necessary in the
first place; do not recreate the problem inside the new one.

**2 · The table session is the spine, not the order.** A table places a round,
then another forty minutes later, then a coffee. All of it is one bill. If
`orders` is the top-level object, every bill becomes a fragile join and partial
payment becomes guesswork. A **service session** opens when a table starts
consuming and closes when it is paid; orders are rounds appended to it.

```
service_session   table 12 · opened 19:42 · 4 guests · waiter Fatou
├── order #1      19:42    3 lines
├── order #2      20:15    1 line
├── order #3      20:58    2 lines
└── payment       250 000 GNF cash   →   closed 21:20
```

This matters *more* in a waiter-only product, not less: rounds are exactly how a
waiter actually works.

**3 · Routing lives on the line, not the order.** "Sent to the kitchen, or
served directly" is not a choice a human makes each time — it falls out of what
was ordered. A grilled fish has a station; a bottle of water does not. One order
containing both fans out on its own. `menu_items.prep_station_id` nullable,
`null` means direct service. One column, and it stays correct for the mixed
order, which is the normal case rather than the edge case.

**4 · Money is integer minor units in `bigint`.** No floats anywhere near a
total. `restaurants.currency_decimals` because GNF and XOF have no subdivision
while EUR has two — hardcoding cents breaks the first Conakry restaurant, and
changing it later is a data migration rather than an edit.

Everything else in this plan can arrive later as a nullable column or a new
table, and §10 relies on precisely that.

---

## 2. Where it lives

A **new repository and a new Supabase project**, sharing the CRM's stack and
conventions but nothing at runtime. `docs/bootstrap-new-repo.md` is the
step-by-step.

Not tidiness — isolation. This CRM's policies grant broad reads to any signed-in
user (`using (auth.uid() is not null)`, repeated across the field tables), which
is coherent when everyone signed in is a colleague. Restaurant staff across
dozens of unrelated businesses are not colleagues.

| | Consequence |
|---|---|
| Git repository | Own history. Neither repo imports the other; not a monorepo. |
| **Supabase project** | A different Postgres server. Different `auth.users`, keys, storage, backups. |
| Accounts | A CRM login does not *exist* in the restaurant platform. |
| Vercel project | Own domain, own environment variables. |
| Runtime | Neither calls the other. |

Because the databases are physically separate, an RLS mistake in the CRM cannot
reach CRM data from a waiter's session — no path exists. Structural rather than
maintained, and the whole reason for the split.

**Copied once, then diverging:** the App Router skeleton, `lib/supabase/*`
wrappers, the `next-intl` setup, shadcn/ui and Tailwind config, the
numbered-migration convention, and the username-login trick. Copies, not links —
a bug fixed in one is not fixed in the other. That duplication is the price of
the isolation, paid knowingly.

Stack: Next.js 14 App Router · TypeScript · Tailwind + shadcn/ui · Supabase
(Postgres, Auth, Realtime) · Vercel · `zod` at every boundary.

---

## 3. Who signs in

**One door in phase one.** Everyone who uses the product is staff, and every
staff account is username + password, provisioned by someone above them.

| Surface | Who | Route |
|---|---|---|
| **Waiter** | floor staff, phone | `/r/<slug>/service` |
| **Kitchen** | station screen, tablet | `/r/<slug>/station/<id>` |
| **Cashier** | till | `/r/<slug>/caisse` |
| **Manager / Owner** | back office | `/r/<slug>/admin` |

Supabase Auth requires an email, so we store a synthetic one the user never
sees — the CRM's trick, made tenant-aware so `fatou` is free at every
restaurant:

```
username  fatou
stored    fatou@le-bambou.staff.nimbaa.app
shown     never
```

Staff sign in at a **restaurant-scoped URL** bookmarked on the device. Nobody
types a restaurant name at 19:30 on a Friday.

### The bootstrap, simplified

The previous draft built a platform console with mandatory TOTP, an invite flow
and an owner-visible access log before anything else could be tested. For one to
three pilot restaurants that is a console with no users.

Instead, a **seed script**, exactly as this CRM already does it with
`bootstrap-admin.mjs`:

```bash
node supabase/seed/bootstrap-owner.mjs le-bambou "Le Bambou" fatou "MotDePasseFort"
```

It creates the restaurant, creates the auth user with the synthetic address,
writes `staff_accounts` and the `owner` row in `restaurant_members`. Re-running
it with `--reset-password` is also the recovery story: a patron who forgets
their password is one command away, and with three pilot restaurants that is
honest rather than lazy.

From there the owner creates staff in the back office. **Only an owner may
create a manager or another owner**; a manager hires waiters, kitchen and
cashiers but cannot mint their own peers. `must_change_password` is enforced at
the first authenticated request, because a password read aloud must not survive
the first shift.

The console, invites, TOTP and the access log return in §10 — when there are
restaurants to support and someone at Nimbaa needing to reach their data.

---

## 4. Data model

Sketch, not final DDL. Amounts are `bigint` in the currency's minor unit.

### 0001 — tenancy · *written and verified*

```sql
restaurants (
  id, slug unique, name, timezone,
  currency, currency_decimals,
  service_charge_bp int, tax_mode, status, created_at
)

restaurant_members (restaurant_id, user_id, role, active, created_at)
  primary key (restaurant_id, user_id, role)
  -- role in (owner, manager, waiter, kitchen, cashier)

staff_accounts (
  user_id primary key, restaurant_id, username, display_name,
  must_change_password, disabled_at, created_at,
  unique (restaurant_id, username)
)
```

Three tables, two predicates (`is_member`, `has_role`), RLS on all three. This
migration has been applied to a scratch Postgres 16 and probed — see §6.

### 0002 — menu and floor · *written and verified*

```sql
areas           (id, restaurant_id, name, sort)      -- salle, terrasse
tables          (id, restaurant_id, area_id, label, seats, status)
prep_stations   (id, restaurant_id, name)            -- cuisine, bar, grill
menu_categories (id, restaurant_id, name, sort, active)
menu_items      (id, restaurant_id, category_id, name, description,
                 price bigint, photo_path,
                 prep_station_id null,   -- NULL = servi directement
                 available bool,         -- l'interrupteur « 86 »
                 sort)
```

**No modifier groups.** A free-text `note` on the order line carries *sans
piment* and *bien cuit*, which is what a waiter writes on a paper docket anyway.
Option groups with min/max selection and price deltas are real complexity and
they can wait until a menu actually demands them.

`tables` has no `qr_token` yet — in phase one a table is a label the waiter taps.

**`sort` is not decoration.** It shipped as a column and stayed 0 everywhere,
which meant Postgres broke ties as it pleased and the carte reordered itself
between two page loads. On a screen designed so that position is what a member
of staff remembers, that is a functional bug, not a cosmetic one. Migration
0005 renumbers what exists, makes `(restaurant_id, sort)` unique on categories
— **deferrable**, so a swap can pass through a duplicate inside one transaction
— and adds `resto.move_category` / `resto.move_item`, which do both writes
together. PostgREST opens one transaction per call, so two `.update()` calls
would have been rejected at the first of the two.

Those functions are `security definer`, so RLS does not apply inside them: each
carries its own `resto.can_manage()` check and raises `42501`. A waiter is
refused by the function, not merely filtered by a policy.

### 0003 — service

```sql
service_sessions (
  id, restaurant_id, table_id,
  status,          -- open | bill_requested | settled | closed | cancelled
  guest_count, waiter_id, opened_at, closed_at,
  subtotal, service_charge, discount, total, paid   -- bigint, dénormalisés
)

orders (
  id, restaurant_id, session_id,
  channel text default 'waiter',   -- 'qr' rejoint plus tard
  placed_by_staff, note, created_at
)

order_items (
  id, restaurant_id, order_id, menu_item_id null,
  name_snapshot, unit_price bigint, qty, line_total bigint,
  prep_station_id null,   -- recopié : NULL ⇒ service direct
  status,                 -- queued | preparing | ready | to_serve
                          --   | served | voided
  note, queued_at, ready_at, served_at, voided_at, void_reason
)

order_events (id, restaurant_id, order_id, order_item_id null,
              kind, from_label, to_label, actor_id, at)
```

Two things that look like overhead and are not:

**Prices and names are snapshotted onto the line** at submit time. A price
change at 20:00 must leave the 19:42 bill alone.

**`order_events` is append-only**, with no update and no delete policy — the
same reasoning as `deal_events` in this CRM: *a journal you can rewrite is not
worth keeping.* It is what answers "we ordered at 19:30 and it came at 20:40"
three days later, and in a waiter-only product it is also the only record of who
voided what.

There is no `orders.status` in phase one. Order-level status existed to carry
`pending → accepted` for diner orders awaiting a waiter's confirmation. A
waiter's own input *is* the confirmation, so the column would hold one value
forever. It arrives with the QR flow that needs it.

### 0004 — payment

```sql
payments (
  id, restaurant_id, session_id,
  method text,          -- 'cash' | 'card_terminal'  (les autres en §10)
  amount bigint, tendered bigint null, change bigint null,
  status text, collected_by, created_at
)
```

A session can carry several payments — that is what a partial settlement *is*,
and it costs nothing to allow now. The provider columns for mobile money and
card arrive with the provider; adding nullable columns to Postgres is not a
table rewrite, so there is no reason to carry them empty for months.

---

## 5. The flows

### 5.1 The waiter takes an order

Table map → pick a table → the session opens if it is not already → add items →
submit. Round two on an open session is one tap.

This surface is the product. It has to work **one-handed on a cheap Android
phone, standing up, in a noisy room**: large targets, no hover, no modal traps,
and a submit that survives a bad signal. Test it standing, not at a laptop.

Submit posts to a server route handler. Server-side, in one transaction:
re-check availability — an item 86'd while the waiter was tapping must fail
*here*, not at the pass — recompute every price from the database, open or reuse
the session, write `orders` and `order_items`, fan the lines out.

The fan-out is the whole routing model, and it is two lines of code:

```
line.prep_station_id is not null  →  status 'queued'    → appears on that station
line.prep_station_id is null      →  status 'to_serve'  → appears in the to-serve list
```

### 5.2 Kitchen

**The kitchen is a role, not a device.** `kitchen` is granted like any other, to
as many people as the restaurant employs — Mamadou and Awa each have their own
account, and either can mark a dish ready. No shared login, no special device
account, and the same is true of every other role.

**Sessions do not expire.** A tablet on the pass is signed in once and stays
signed in: the auth cookie carries a 400-day lifetime, survives the device being
switched off, and refreshes itself while the screen is open. Two Supabase
settings must be left alone for that to hold — *Authentication → Sessions*,
where *time-box user sessions* and *inactivity timeout* both default to never.
Logging the kitchen out at 3am on a Saturday is not a security policy; it is an
outage.

One screen per station, subscribed to its own lines. Tickets grouped by order,
oldest first, with an elapsed-time badge that turns amber then red. Two actions
and no more: **start** (`queued → preparing`) and **ready** (`preparing →
ready`), plus a bump-back for mistakes.

Direct-service lines never reach this screen. That is the "served directly by
the waiter" path and it costs no extra code, because it is the *absence* of a
station rather than a special case.

### 5.3 Serve

The waiter's to-serve list is everything `ready` or `to_serve` on their tables.
Marking served stamps `served_at`, which is what later gives real service-time
numbers instead of anecdotes.

### 5.4 Pay and close

Open the session bill: lines, subtotal, discount, total. Cash — enter tendered,
the app computes change, the payment is recorded, the session goes `settled`
then `closed`, the table frees. Several payments against one session close it
when the sum reaches the total. Receipt as printable HTML.

### 5.5 The day view

What was sold, how much came in, by whom, and how long food took from `queued`
to `served`. One page. It is what tells you whether the pilot is working, and
it is cheap once `order_events` exists.

---

## 6. Tenant isolation

Staff are keyed on membership. Every tenant table carries `restaurant_id`
directly:

```sql
create or replace function is_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from restaurant_members m
    where m.restaurant_id = rid and m.user_id = auth.uid() and m.active
  );
$$;
```

`security definer` is not stylistic. The policy on `restaurant_members` queries
`restaurant_members`; without it the policy calls itself and the first `select`
never returns. It is the classic Supabase RLS trap.

**Reads through RLS, writes through route handlers.** Price recomputation,
availability re-checks and idempotency are server concerns regardless of who is
signed in, and an authenticated waiter is still an untrusted client.

### Verified, not asserted

The 0001 migration was applied to a scratch Postgres 16 and probed. Three
actors, six assertions, all passing: the owner of restaurant A sees only A, the
owner of B sees only B, a user with no membership sees nothing. The escalation
guard was checked the same way — a manager may hire a waiter but is refused a
manager or an owner, and the owner of another restaurant is refused everything.

The probe ships as `supabase/tests/0001_tenancy_probe.sql`, runs inside a
transaction that rolls back, and **every table added later earns its line there
in the same commit as its migration**. That rule is what keeps the guarantee
true at thirty tables.

---

## 7. Realtime and weak connectivity

Entry-level Android, patchy data.

- Supabase Realtime per restaurant channel; each screen subscribes to its slice.
  **Polling fallback every 10s when the socket is down** — a kitchen screen that
  silently stops receiving tickets is worse than one that is visibly slow.
- Waiter submits are optimistic, with a local queue and retry. An order must
  never be lost to a dead lift.
- **Idempotency keys on submit**: a retried POST must not double the round.
- The kitchen screen caches its ticket list; a reload mid-service reopens on the
  same state.

---

## 8. Milestones

One developer with AI assistance. Each phase ends in something demonstrable.

| # | Phase | Ships | ~Size |
|---|---|---|---|
| **P1** | Foundations & staff | Repo, Supabase project, 0001 + probe, `bootstrap-owner.mjs`, staff login at `/r/<slug>/login`, forced password change, owner creates staff, role routing | 1w |
| **P2** | Menu & floor · *done* | Admin CRUD: categories, items, stations, areas, tables; photo per dish and per category, taken at the camera and compressed before upload; the carte's order (rename, ↑↓, hide, delete) | 0.5w |
| **P3** | **Order → kitchen → serve** | Table map, staff cart, rounds on a session, the fan-out, kitchen screen, to-serve list, realtime, `order_events` | 1.5w |
| **P4** | Bill & cash | Session bill, discount, partial payments, cash, close, HTML receipt | 1w |
| **P5** | Pilot hardening | Day view, service times, retry queue, the rough edges a real service finds | 1w |

**End of P3 is the moment worth aiming at**: a waiter takes an order on a phone
and it appears on the kitchen screen. That is the product proving itself, and
it is roughly three weeks out.

**End of P5 is a restaurant running a full service on it.** Put it in one real
restaurant then, before building anything in §10.

### The first week, concretely

1. Create the repo and Supabase project — `docs/bootstrap-new-repo.md`.
2. Apply `0001_tenancy.sql`, run the probe, see six `OK` lines.
3. `bootstrap-owner.mjs`, then log in as the owner.
4. Owner creates a waiter and a kitchen account.
5. Deploy to Vercel on day five, even empty. A pipeline exercised only at the
   end is a pipeline that fails at the end.

Nothing here waits on a third party. That is the point of the cut.

---

## 9. Risks

| Risk | Forces |
|---|---|
| **Cross-tenant leak** | `restaurant_id` on every table, `is_member()` policies written with the table, the probe extended in the same commit — and it runs in CI |
| **Screen unusable in real service** | Test on a cheap Android, standing, one-handed, in a noisy room. This is the top risk in a waiter-only product: there is no diner app to hide behind |
| **Lost orders** — signal dies between phone and pass | Idempotent submit, optimistic queue with retry, polling fallback, cached kitchen state |
| **Price drift** — menu edited mid-service | Snapshot name, price and station onto the line at submit |
| **86'd items** — sold out between render and submit | Availability re-checked server-side inside the submit transaction |
| **Two waiters, one table** | Append-only rounds instead of a shared editable cart; no last-write-wins |
| **Money rounding** | Integer minor units, per-restaurant decimals, server-side totals only |
| **Staff password hygiene** | Per-person accounts, `must_change_password` enforced server-side, owner-driven reset, disable rather than delete. Only an owner creates a manager or an owner |
| **Scope creeping back in** | §10 is the parking place. Nothing there gets built before one real restaurant has run a full service on P1–P5 |

---

## 10. What comes after, and why deferring is safe

Each of these lands **on top of** phase one rather than through it, because of
the four bones in §1. What each one actually costs:

### QR diner ordering — the big one

- `tables` gains `qr_token` and `qr_order_mode`; `restaurants` gains a default.
- `orders` gains `status` (`pending | accepted | rejected`) and a nullable
  `customer_id`. Existing rows are `accepted` with a null customer, which is
  exactly what they are.
- New: `customers`, `customer_blocks`, `device_sessions`, the public menu page,
  the cart, and the OTP gate.
- The session, the fan-out, the kitchen screen and the bill are **untouched** —
  a QR order is another row in `orders` on the same session, and the waiter's
  confirmation queue is a filter over `status = 'pending'`.

The decisions already taken for it, which should not be re-litigated later:

- **Codes, never magic links.** A magic link opens in the device's default
  browser, not the in-app browser the QR scan opened — different session, cart
  gone.
- **WhatsApp before SMS**, with email last. Cheaper and more reliable across MTN
  and Orange, and already on the diner's phone.
- **The menu is open; the gate sits on Confirm.** A login wall over a menu costs
  orders from the people still deciding whether to sit down.
- **`app_metadata`, never `user_metadata`** for the account kind —
  `user_metadata` is writable by the user. And `restaurant_members` stays the
  sole authority for staff powers regardless.
- **Staff recovery contacts never go in `auth.users.phone`.** An owner who also
  eats out would collide with their own diner account under Supabase's phone
  uniqueness constraint.

**Start the Twilio account and WhatsApp sender approval the week before you
start this phase, not the week you need it.** It is measured in weeks.

### Everything else

| Later | Cost when it comes |
|---|---|
| Item modifiers | New `modifier_groups` / `modifiers`, a `modifiers jsonb` snapshot on the line. Additive |
| Mobile money, card | Nullable provider columns on `payments`, an adapter, webhooks, reconciliation |
| Platform console | `platform_admins`, `staff_invites`, `platform_access_log`, TOTP, owner claim by invite, read-only impersonation, an access log the owner can read |
| Service charge & tax | The columns already exist; it is a settings screen and a line on the bill |
| Split by item | Rows already allow several payments; it is a UI |
| Thermal printing | ESC/POS from the existing HTML receipt |
| Offline queue | The retry queue from P5, made durable |
| Reports | `order_events` already holds the timestamps |

---

## 11. Open questions

1. **Target market** — Guinea/West Africa (GNF, later Orange Money, WhatsApp
   over SMS, offline tolerance) or Europe (EUR, card, VAT)? It no longer blocks
   phase one, which is why the cut is worth making, but it decides §10.
2. **Fiscal rules** — does the target market impose certified receipts or fiscal
   printers? A hard constraint, cheap now and expensive later.
3. **The pilot restaurant** — which one, and when? P1–P5 is aimed at a specific
   kitchen, and the answer changes what P5 hardens.
4. **Takeaway and counter orders** — `channel` reserves the value; is a
   no-table flow wanted in the pilot?
5. **Menu photos** — is the owner uploading them, and do we need the CRM's
   `browser-image-compression` treatment for slow uploads?

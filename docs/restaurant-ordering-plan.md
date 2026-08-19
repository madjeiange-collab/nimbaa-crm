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
| Staff accounts | **Provisioned by the owner or manager** — username + password. No self-signup, no email recovery. |
| Customer accounts | **Self-served, verified by OTP** — phone/WhatsApp first, email as fallback. |
| Owner accounts | **Claimed by invite, never handed over.** Password chosen by the owner; OTP proves the contact at claim and at recovery. |
| Platform admin | **Separate door, TOTP always**, every tenant access logged and shown to the owner. |
| The login gate | **Menu is open to everyone. Confirming an order requires a verified account.** |

### Why a separate repo and a separate Supabase project

Not tidiness — isolation. This repo's RLS grants broad reads to any signed-in
user (`create policy de_read … using (auth.uid() is not null)`, and the same
pattern across the field tables). That is coherent for a single-company CRM
where everyone signed in is a colleague. Put restaurant staff — hundreds of
accounts across dozens of unrelated businesses — into that same Supabase
project and every one of them lands inside `auth.uid() is not null`. Add
*diners* on top and the set becomes the general public.

Retrofitting tenant scoping onto thirty-five existing migrations is a bigger
job than starting clean, and a riskier one, because the failure is silent.

What gets **reused** (copied, not shared): the Next.js 14 App Router skeleton,
`src/lib/supabase/*` client wrappers, the `next-intl` routing setup, the
shadcn/ui kit and Tailwind config, the numbered-migration convention with
prose comments explaining *why* a table exists, the CRM's username-login trick
(§5), and `public/manuel.html` as the model for end-user documentation.

Stack: Next.js 14 (App Router) · TypeScript · Tailwind + shadcn/ui ·
Supabase (Postgres, Auth, Realtime, Storage) · Vercel · `zod` at every boundary.

---

## 2. The two ideas the whole schema hangs on

**The table session is the spine, not the order.**

A diner does not place one order. They place a round, then another round forty
minutes later, and a coffee after that. All of it is one bill. If `orders` is
the top-level object, every bill becomes a fragile join and split payments
become guesswork.

So: a **service session** opens the moment a table starts consuming and closes
when it is paid. Orders are rounds appended to it. The bill is the session.

```
service_session  (table 12, opened 19:42, 4 guests, waiter Fatou)
├── order #1  channel=qr      19:42   [3 lines]   customer: Aïssatou
├── order #2  channel=waiter  20:15   [1 line]    customer: —
└── order #3  channel=qr      20:58   [2 lines]   customer: Aïssatou
└── payments: 250 000 GNF cash  →  session closed 21:20
```

Note that one session can mix orders from several diners and from the waiter.
The session belongs to the *table*, not to a customer account.

**Routing is a property of the line, not the order.**

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
| **Diner** | anyone at a table | **none to browse · OTP account to order** | `/t/<table_token>` |
| **Waiter** | floor staff, phone | username + password | `/r/<slug>/service` |
| **Kitchen (KDS)** | station screens, tablet | username + password, kiosk | `/r/<slug>/station/<id>` |
| **Cashier** | till | username + password | `/r/<slug>/caisse` |
| **Manager / Owner** | back office | username + password (+OTP step-up) | `/r/<slug>/admin` |
| **Platform admin** | Nimbaa support | username + password + **TOTP** | `/platform` |

Roles on `restaurant_members.role`: `owner`, `manager`, `waiter`, `kitchen`,
`cashier`. A **platform admin** flag sits outside tenancy for support access,
and every use of it is written to an audit table.

---

## 4. Identity — three doors

Platform admins, restaurant staff and diners are all Supabase Auth users, and
that is the only thing they have in common. Everything else about the three
doors is deliberately different — and the owner, sitting at the top of the
staff tree, is the account the whole restaurant's security rests on.

### 4.1 The chain of trust

```
Nimbaa platform admin
   │   creates the restaurant, invites the first owner
   ▼
Owner ─────────────── recovery: OTP to a contact verified at claim
   │   creates managers, and any staff role
   ▼
Manager
   │   creates waiters, kitchen, cashiers
   ▼
Waiter · Kitchen · Cashier ─── recovery: the owner or manager resets it

Diner ─── outside the tree entirely. Self-served, OTP, no password.
```

Every account except the diner is created by someone one level up. That is
deliberate: there is always a human accountable for an account existing, and
"who can reset this password" has an obvious answer at every level — except at
the very top, which is precisely the problem the owner's design has to solve.

Only an owner may create a manager or another owner. A manager may create
waiters, kitchen and cashier accounts, but cannot mint their own peers.

### 4.2 The owner: claimed, not handed over

The owner is never *given* a password. Nimbaa creates the restaurant and
records the owner's name, email and phone; the system sends a **single-use
invite link, valid 72 hours**, over WhatsApp or email. The owner opens it,
proves control of that contact with a **one-time code**, and only then chooses
their own username and password.

```sql
staff_invites (
  id, restaurant_id, role,
  email text null, phone text null,
  token_hash text, expires_at, consumed_at null,
  created_by, created_at
)
```

Nobody at Nimbaa ever knows the owner's password, and no initial password
travels over WhatsApp or gets read out on a phone call. For the account that
can change every price, read every franc of revenue and create every other
account, "here is your temporary password" is not good enough.

#### Why the owner does not sign in with OTP

The owner *could* sign in with a code every time, like a diner. They should
not, for three reasons:

- **It costs money and depends on a network.** Every login would be a paid
  message over a network that is not always there. An owner doing the cash-out
  at midnight cannot be locked out of their own till because Orange is having
  a bad night.
- **In a small restaurant the owner also works the floor.** They should not
  have a different login ritual depending on whether they are about to take an
  order or read the day's takings.
- **The password is not the weak part.** Recovery is. OTP is what we use to
  make *recovery* strong, and spending it on the front door buys nothing.

So OTP appears at exactly the two moments where the question is *"does this
human control this contact?"* — first claim and recovery — plus a third where
the question is *"is this really them, right now?"* — step-up on the handful of
actions that cannot be undone.

#### Recovery, which is the real attack surface

The owner is the root of the reset chain: there is nobody above them at the
restaurant.

- Recovery sends a code **only to the contact already verified on the
  account** — never to one typed at recovery time. A recovery flow that accepts
  a new address is not recovery, it is account takeover with extra steps.
- **Changing the recovery contact** requires the current password *and* a code
  to the *old* contact.
- If both are genuinely lost it goes to platform admin, behind an out-of-band
  identity check, logged, and notified to every other owner of that restaurant.
- **Nudge every restaurant towards a second owner account.** It costs nothing
  and means the recovery path does not always run through Nimbaa. It is the
  cheapest resilience measure in this plan.

#### Step-up: the short list

A code is demanded again, mid-session, only for actions that move money or hand
out power:

| Action | Why |
|---|---|
| Changing mobile money or bank settlement details | The most attacked action in any payments system — an attacker who gets in does not steal data, they redirect the takings |
| Creating or promoting an owner or manager | Privilege escalation turns a small compromise into a total one |
| Exporting customer data | Bulk export is the difference between an incident and a breach |
| Deleting the restaurant | Irreversible |

Settlement changes get one more control, because SMS OTP does not survive a SIM
swap: a **24-hour hold plus a notice to every owner**, so the legitimate owner
finds out before the money moves.

Everything else — prices, menu, staff accounts, voids, closing a session — runs
on the session the owner already has. Step-up on everything just trains people
to tap through it.

### 4.3 Platform admin: the highest-value target on the platform

Our own accounts, and the ones an attacker actually wants, because one of them
reaches every restaurant.

- **Separate door** (`/platform`), separate account kind, never reachable from
  a restaurant login page.
- **TOTP mandatory — an authenticator app, not SMS.** SMS OTP is SIM-swappable,
  and this is precisely the account worth swapping a SIM for. It is the one
  place in this plan where SMS is not good enough.
- **Every tenant access is logged with a reason**, append-only, and **shown to
  the restaurant owner** in their own back office: *"Nimbaa support opened your
  orders on 3 September at 14:20 — ticket #412."* We are asking restaurants to
  trust us with their revenue; the honest way to earn that is to make our
  access visible rather than invisible.
- **Impersonation is read-only by default and time-boxed.** Acting as a tenant
  with write access needs a second admin's approval, and says so in the log.

```sql
platform_admins     (user_id primary key, display_name,
                     totp_enrolled_at, disabled_at)

platform_access_log (id, admin_id, restaurant_id, action, reason,
                     ticket_ref, at)   -- append-only, readable by the owner
```

### 4.4 Staff: provisioned, never self-served

The owner or manager creates the account — username, display name, role(s),
initial password. There is **no signup page and no email recovery**, because
staff have no email on file. A forgotten password is reset by the owner, which
is also the correct human process: the person asking is standing in front of
them.

Supabase Auth requires an email, so we store a synthetic one the user never
sees — the CRM's trick (`identifiant@crm.local`), made tenant-aware so that
`fatou` is free at every restaurant:

```
username  fatou
stored    fatou@le-bambou.staff.nimbaa.app
shown     never
```

```sql
staff_accounts (
  user_id uuid primary key references auth.users,
  home_restaurant_id uuid not null,     -- scopes the username
  username text not null,
  display_name text,
  must_change_password bool default true,
  -- Recovery contact lives HERE, not in auth.users — see §4.7.
  recovery_email text null, recovery_phone text null,
  recovery_verified_at timestamptz null,
  disabled_at timestamptz null,
  unique (home_restaurant_id, username)
)
```

Staff sign in at a **restaurant-scoped URL**, `/r/<slug>/login`, bookmarked on
the kitchen tablet and on each waiter's phone. Nobody types a restaurant name
at 19:30 on a Friday.

The username is scoped to one restaurant, so a waiter working two jobs has two
logins. That is the deliberate trade: login stays trivial for the 99% case at
the cost of the rare multi-site person. The escape hatch for a multi-site owner
is extra `restaurant_members` rows on one account, and a restaurant switcher in
the back office.

`must_change_password` is enforced at the first authenticated request, not
merely suggested — an owner handing out a password verbally is the normal
onboarding path, so that password must not survive the first shift.

### 4.5 Diners: self-served, verified by OTP

Phone first, WhatsApp preferred, SMS second, email as the last resort. All
three are native Supabase Auth (`signInWithOtp`) — no home-grown OTP, no
home-grown session handling.

```sql
customers (
  user_id uuid primary key references auth.users,
  phone text, whatsapp_ok bool, email text null,
  display_name text, locale text,
  created_at, last_order_at
)

customer_blocks (
  id, customer_id,
  restaurant_id null,          -- null ⇒ platform-wide
  reason, created_by, created_at
)
```

Four rulings that are cheap now and expensive later:

**Codes, never magic links.** A magic link opens in the device's *default*
browser, which is not the in-app browser the QR scan opened. Different browser,
different session, cart gone, order lost. A six-digit code entered in place,
with `autocomplete="one-time-code"` so Android and iOS autofill it straight
from the notification, keeps the diner on the page they were already on.

**WhatsApp before SMS.** In West Africa WhatsApp is cheaper per message, more
reliable than SMS across MTN and Orange, and already on the diner's phone.
Twilio Verify (or an equivalent) carries both channels behind one API, so the
fallback chain — WhatsApp → SMS → email — is configuration rather than code.

**`app_metadata`, never `user_metadata`.** Mark the account kind at creation in
`app_metadata.kind` (`'staff'` / `'customer'`). `user_metadata` is writable by
the user via `supabase.auth.updateUser()` and can therefore never carry an
authorization decision. Even `app_metadata` is only defence in depth: the
authority for staff powers is a row in `restaurant_members`, full stop.

**The account is platform-wide.** Scan any Nimbaa restaurant and you are
already signed in — that is the network effect worth having. It also creates an
obligation: restaurant A must never learn that this diner also eats at
restaurant B. Staff reads stay scoped by `is_member(restaurant_id)`, and staff
see a diner's name and phone only through an order of their own.

### 4.6 Where the gate sits

**The menu is open. Confirming an order is not.**

```
scan  →  menu  →  cart  →  [ CONFIRM ]  →  OTP  →  order sent
        ↑─────── no account ────────↑     ↑── verified ──↑
```

A login wall over a menu costs orders from exactly the people most likely to
leave — someone deciding whether to sit down at all. So the gate sits at the
last possible moment, when the diner has already chosen what they want and the
cost of the OTP round trip is obviously worth paying.

Practically: the submit route handler rejects an unauthenticated POST; the UI
raises the OTP sheet at that moment and replays the submit on success. The cart
lives in `localStorage`, keyed by table token, so it survives the diner
switching to WhatsApp to read the code and coming back.

Calling the waiter and asking for the bill stay open too — those are not
transactions, and making someone create an account to ask for water would be
absurd.

### 4.7 One collision worth knowing before week two

A restaurant owner also eats out. If a staff account's recovery phone were
written into `auth.users.phone`, and that same person held a diner account on
that number, Supabase's uniqueness constraint on phone means one of the two
accounts simply cannot be created.

So: **staff `auth.users` rows carry only the synthetic email.** The recovery
contact lives in `staff_accounts`, verified by our own OTP flow and never by
Supabase's phone-auth path.

This is also the right privacy answer. The owner of one restaurant ordering
dinner at another is not something the platform should be able to join up.

### 4.8 Where OTP appears — and where it deliberately does not

| Who | Signs in with | Recovers with | Second factor |
|---|---|---|---|
| Platform admin | username + password | two-person platform process | **TOTP, always** |
| Owner | username + password | OTP to a contact verified at claim | OTP on the short list in §4.2 |
| Manager | username + password | OTP to verified contact, or owner reset | OTP on staff promotion |
| Waiter · Kitchen · Cashier | username + password | owner or manager reset — no contact needed | none |
| Diner | **OTP, no password at all** | the OTP itself | none |

Read down the *signs in with* column: OTP is the diner's front door and nobody
else's. Everywhere else it proves control of a contact — it is not a way in.

Lockouts follow the same logic. Repeated password failures lock an account for
fifteen minutes, per account and per IP, but an owner or manager can clear a
waiter's lockout instantly: a lockout that survives into the middle of a
service is a worse outcome than the attack it prevents.

### 4.9 What the account changes elsewhere

- **`qr_order_mode` default shifts to `auto`.** The original argument for
  `confirm` was that any passerby could fire tickets. A verified phone number
  makes a prank traceable and its author blockable, so the setting stays
  configurable but stops needing to default to the cautious option.
- **Order status reaches the diner directly.** With a real identity, RLS can
  say `customer_id = auth.uid()`, which means the customer app can hold a
  Supabase Realtime subscription of its own — "your order is being prepared",
  "your order is ready" — instead of polling a route handler.
- **Order history and reorder come nearly free** once orders carry a customer.
- **M6 gets easier.** The mobile money number is usually the number that
  received the OTP.

---

## 5. Data model

Sketch, not final DDL. Amounts are `bigint` in the currency's minor unit; see
§8 on money. Identity tables are in §4.

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
  subtotal, service_charge, tax, discount, total, paid  -- all bigint
)

orders (
  id, restaurant_id, session_id,
  channel text,         -- 'qr' | 'waiter' | 'counter'
  status  text,         -- pending | accepted | rejected | cancelled
  customer_id null,     -- set on every 'qr' order, null on waiter orders
  placed_by_staff null,
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

### Pre-login device, and small asks

```sql
device_sessions   (id, restaurant_id, table_id, token_hash,
                   otp_sends int, created_at, last_seen_at, user_agent)

service_requests  (id, restaurant_id, table_id, session_id null,
                   kind,           -- 'call_waiter' | 'bill' | 'water'
                   status, created_at, handled_at, handled_by)
```

`device_sessions` is not an identity — it is the anonymous browsing phase: the
table binding before login, and the counter that stops one phone from burning
forty OTP sends. `service_requests` is half a day of work and removes the
single most common reason a diner gets up and goes looking for someone.

---

## 6. The flows

### 6.1 Scan → menu → account → order

1. QR encodes `https://app/t/<qr_token>` — opaque token, never the table number.
2. The page resolves restaurant + table and **renders the menu with no account
   and no login**, server-side, so it is fast on a cheap phone. A device cookie
   is issued for rate limiting and the table binding.
3. Categories render from the restaurant's menu, hiding `available = false`.
   Effective `qr_order_mode` (table override, else restaurant) decides whether
   a cart exists at all.
4. The cart is local — `localStorage`, keyed by table token.
5. **Confirm** is the gate. If there is no session: phone → WhatsApp or SMS
   code → verified → account created on first use. Display name is asked
   *after* the first order, never before it. The submit replays automatically
   on success and the cart is intact.
6. Submit posts to a server route handler. Server-side, in one transaction:
   check the customer is not blocked for this restaurant, re-check availability
   (an item 86'd while the diner browsed must fail *here*, not at the pass),
   recompute every price from the database — **never trust a client-sent
   total** — open or reuse the table's session, write `orders` (stamping
   `customer_id`) and `order_items`.
7. Then, by mode:
   - `auto` — order `accepted`; each line goes `queued` if it has a station,
     `to_serve` if not.
   - `confirm` — order `pending`; it appears in the waiter's confirmation
     queue. The waiter validates, corrects quantities, or rejects with a
     reason. Acceptance runs the same fan-out.
   - `menu_only` — no cart at all: menu plus a "call the waiter" button, and
     no account required for anything.
8. The diner watches their own lines live, over their own Realtime
   subscription, scoped by RLS to `customer_id = auth.uid()`.

### 6.2 Waiter takes the order directly

Same cart, denser UI, no confirmation step and no customer account — a waiter's
input *is* the confirmation, and `orders.customer_id` stays null. Table map →
pick table → add items → submit. Round 2 on an open session is one tap. This
surface must be usable one-handed on a cheap Android phone standing up: large
targets, no hover, no modal traps.

### 6.3 Kitchen

One screen per station at `/r/<slug>/station/<id>`, subscribed to its own
lines. Tickets grouped by order, oldest first, with an elapsed-time badge that
turns amber then red past the item's target time. Two actions and no more:
**start** (`queued → preparing`) and **ready** (`preparing → ready`).
Bump-back for mistakes. Ready lines leave the station screen and land in the
waiter's "to serve" list.

`to_serve` lines from direct-service items never touch this screen — they
appear in the waiter's list the instant the order is accepted. That is the
"served directly by the waiter" path, and it costs no extra code because it is
the *absence* of a station, not a special case.

### 6.4 Serve

The waiter's "to serve" list is everything `ready` or `to_serve` on their
tables. Marking served stamps `served_at`, which is what later gives us real
service-time numbers instead of anecdotes.

### 6.5 Pay and close

Open the session bill: lines, subtotal, service charge, tax, discount, total.
Cash: enter tendered, the app computes change, `payments` row captured,
session `settled` then `closed`, table freed. Split by amount or by line —
several `payments` rows against one session, closing when the sum reaches the
total. Receipt as printable HTML first, and — because the diner's WhatsApp
number is now verified — sendable to them; ESC/POS thermal printing in the
hardening phase.

---

## 7. Tenant isolation — the thing most likely to sink this

Three populations, one Postgres. **Reads through RLS, writes through route
handlers.**

**Staff** are keyed on membership:

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

**Diners** are keyed on themselves:

```sql
create policy orders_read_own on orders for select
  using (customer_id = auth.uid());
```

> **This reverses an earlier recommendation, and the reversal is the point.**
> The first draft of this plan argued that diners must *not* be Supabase Auth
> users, because an anonymous cookie would have forced us to encode "this
> cookie may read these seven rows" into RLS — with every bill on the platform
> inside the blast radius. A durable, verified identity removes that problem
> entirely: `customer_id = auth.uid()` is the boring, well-trodden Supabase
> pattern, and it is *safer* than what it replaces. It also buys diner-side
> Realtime, which a route-handler-only design could not have.

What does **not** change: every **write** still goes through a Next.js route
handler. Price recomputation, availability re-checks, block-list checks and
idempotency are server concerns regardless of who is signed in, and an
authenticated diner is still an untrusted client.

**Anonymous** menu browsing touches only server-rendered pages and a narrow
public read of active restaurants' menus. Nothing else is reachable without a
session.

Non-negotiables:

- A seed-and-probe test suite with **three** actors — restaurant A staff,
  restaurant B staff, and a diner — attempting cross-tenant and cross-customer
  reads and writes on every table, asserted to return zero rows. It runs in CI.
- Every new table ships with its policies in the same migration. No exceptions.
- The service-role key is server-only and never reaches a client bundle.
- No authorization decision ever reads `user_metadata`.
- Rotating a table's `qr_token` invalidates its printed code, for when a QR
  sheet ends up photographed and posted online.

---

## 8. Realtime and weak connectivity

Assume the CRM's operating conditions: entry-level Android, patchy data.

- Supabase Realtime per restaurant channel; staff screens subscribe to their
  own slice, diners to their own orders. **Polling fallback** every 10s when
  the socket is down — a KDS that silently stops receiving tickets is worse
  than one that is visibly slow.
- Waiter mutations are optimistic with a local queue and retry. Sending an
  order must never be lost to a dead lift.
- Idempotency keys on order submit: a retried POST must not double the round —
  and the OTP replay in §4.3 makes a retried submit the *normal* path, not an
  edge case.
- KDS caches its ticket list; a reload mid-service reopens on the same state.
- The diner's session token is refreshed silently, so a returning regular never
  re-does the OTP.

---

## 9. Money

- **Integer minor units, `bigint`, always.** No floats anywhere near a total.
- `restaurants.currency_decimals` because GNF and XOF have no subdivision while
  EUR has two. Hardcoding cents breaks the first Conakry restaurant.
- Totals are computed server-side, stored denormalised on the session, and
  recomputed-and-compared on close.
- Voids are a status plus a reason, never a delete. A line that was made and
  sent back is data the owner needs.
- Every mutation of money passes through `order_events` or `payments`.

---

## 10. Milestones

Sized for one developer with AI assistance. Each milestone is a vertical slice
that ends in something demonstrable.

| # | Milestone | Ships | ~Size |
|---|---|---|---|
| **M0** | Foundations, platform console & accounts | Repo, Supabase project, `restaurants` + `restaurant_members` + `staff_accounts`, `is_member()`, platform console with TOTP (create restaurant, invite owner, access log), owner claim-by-invite, username login at `/r/<slug>/login`, owner-provisioned staff with forced password change, recovery, role routing, fr/en i18n | 2w |
| **M1** | Menu & floor | Admin CRUD: categories, items, modifiers, stations, areas, tables. QR generation + printable sheet | 1w |
| **M2** | **Scan → account → kitchen → serve** | Public menu with no login, cart, OTP account (WhatsApp/SMS/email), the confirm gate with submit replay, three QR modes, waiter confirmation queue, KDS, to-serve list, realtime both sides, `order_events` | 3w |
| **M3** | Waiter entry | Table map, staff cart, rounds on an open session, `service_requests` | 1w |
| **M4** | Bill & cash | Session bill, discounts, service charge, split, cash payment, close, HTML receipt | 1w |
| **M5** | Numbers | Service-day dashboard, sales by item/category/waiter, service times, end-of-shift Z report | 1w |
| **M6** | Mobile money | `payment_intents`, provider adapter (Orange Money / MTN MoMo), webhooks, reconciliation, pay-at-table QR | 1–2w |
| **M7** | Card online | Stripe adapter behind the same interface | 1w |
| **M8** | Hardening | Offline queue, abuse controls, ESC/POS printing, order history & reorder, WhatsApp receipts, menu translation, allergens, `manuel.html` | ongoing |

**M0–M2 is the point of no return** — at the end of M2 a restaurant can take a
QR order from a verified diner and cook it. **M0–M4 is a service that can
actually run.** Everything after M4 makes it sellable rather than usable.

### The first week, concretely

1. **Open the Twilio (or equivalent) account and start WhatsApp sender
   approval on day one.** The code that needs it does not land until M2, but
   approval takes days to weeks and is the one dependency that can stall a
   milestone while everything else is finished. SMS-only is the shippable
   fallback if it is still pending.
2. Create the repo and Supabase project; copy the CRM's `lib/supabase`, i18n
   config, Tailwind and shadcn setup.
3. `0001_tenancy.sql`: `restaurants`, `restaurant_members`, `staff_accounts`,
   `staff_invites`, `platform_admins`, `platform_access_log`, `is_member()`,
   RLS on all of them, and the three-actor probe test.
4. The platform console: enrol the first platform admin with TOTP, create a
   restaurant, send an owner invite. This is the bootstrap — nothing downstream
   can be tested until an owner exists.
5. Owner claim: invite link → OTP → username and password chosen by the owner.
   Then the owner creates the first waiter and kitchen accounts.
6. Staff login at `/r/<slug>/login`, forced password change, role routing.
7. Deploy to Vercel on day 5, even empty. A pipeline that only gets exercised
   at the end is a pipeline that fails at the end.

---

## 11. Risks, and what each one forces

| Risk | Forces |
|---|---|
| **Cross-tenant leak** — one restaurant reads another's orders | `restaurant_id` on every table, `is_member()` policies written with the table, three-actor probe suite in CI |
| **Cross-customer leak** — a diner reads another diner's bill | `customer_id = auth.uid()` policies, and the same probe suite |
| **WhatsApp sender approval** stalls M2 | Start provisioning in week 1; keep SMS-only shippable; treat WhatsApp as an upgrade, not a prerequisite |
| **OTP as a cost and abuse vector** — each send costs money | Per-phone, per-device and per-IP caps, exponential backoff, Turnstile after N attempts, a hard daily ceiling per restaurant, alerting on the spend |
| **Magic-link trap** — link opens in a different browser, cart lost | Codes only, `autocomplete="one-time-code"`, cart in `localStorage` keyed by table token |
| **Login wall depresses orders** | Gate at confirm, never at the menu; display name asked after the first order |
| **Owner account takeover** — the account that can redirect the takings | Claim by invite so no password is ever transmitted, recovery only to a contact verified at claim, step-up on the §4.2 short list, a 24h hold plus all-owner notice on settlement changes |
| **SIM swap on owner recovery** | The 24h hold is the real defence, not the OTP; settlement changes are never instant, and every owner is told |
| **Platform admin compromise** — one account reaches every restaurant | TOTP mandatory and never SMS, read-only time-boxed impersonation, second-admin approval for tenant writes, an access log the owner can read |
| **Phone uniqueness collision** — owner also has a diner account | Staff recovery contact lives in `staff_accounts`, never in `auth.users.phone` |
| **Lockout mid-service** | Time-boxed to fifteen minutes, and an owner or manager can clear a waiter's lockout instantly |
| **Privilege confusion** — a diner treated as staff | `restaurant_members` is the sole authority; `app_metadata` for the kind flag; `user_metadata` never read for authorization |
| **Staff password hygiene** — one password shared round the pass | Per-person accounts, `must_change_password` enforced server-side at first request, owner-driven reset, disable rather than delete. Only an owner may create a manager or another owner |
| **SIM churn** — the diner changes number and loses the account | Email as a recovery anchor on the profile, and a supported number change |
| **QR abuse** — a passerby fires tickets | Verified accounts make it traceable and blockable; `customer_blocks`, rotatable tokens, per-table rate limits, no prices from the client |
| **Price drift** — menu edited mid-service | Snapshot name, price and station onto the line at submit |
| **Lost tickets** — connection dies between phone and pass | Idempotent submit, optimistic queue with retry, polling fallback, KDS state cached |
| **86'd items** — sold out between render and submit | Availability re-checked server-side inside the submit transaction |
| **Two waiters, one table** | Append-only rounds instead of a shared editable cart; no last-write-wins |
| **Money rounding** | Integer minor units, per-restaurant decimals, server-side totals only |
| **Screen unusable in real service** | Test on a cheap Android, standing, one-handed, in a noisy room — not on a laptop |

---

## 12. Explicitly out of scope for v1

Named so they don't creep in: delivery and third-party aggregators, table
reservations, stock and recipe costing, payroll, loyalty programmes, a native
mobile app, multi-currency within one restaurant, accounting export beyond CSV,
and social login for diners (phone is the identity that matters here).

---

## 13. Open questions

1. **Target market** — Guinea/West Africa (drives GNF, Orange Money, WhatsApp
   over SMS, offline tolerance) or Europe (EUR, card, VAT rules)? It changes
   M6 entirely and decides the OTP provider.
2. **OTP provider** — Twilio Verify is the fastest to integrate, but a local
   aggregator is often cheaper and more reliable for MTN and Orange Guinea
   traffic. Worth a deliverability test before committing, since it is the one
   thing standing between a diner and their first order.
3. **Onboarding: hands-on or self-serve?** This plan assumes Nimbaa creates the
   restaurant and invites the owner — right for a market where selling is done
   in person, and it keeps a human in the loop on who gets an account. Going
   self-serve later means adding billing, a "are you really a restaurant"
   check, and an abuse story for free tenants. Worth deciding before M0, since
   it is the shape of the platform console.
4. **Fiscal rules** — does the target market impose certified receipts or
   fiscal printers? A hard constraint, cheap now and expensive later.
5. **Takeaway / counter orders** — the `channel='counter'` value is reserved,
   but is a no-table flow in v1 scope?
6. **Menu photos** — is the owner uploading them, and do we need the CRM's
   `browser-image-compression` treatment for slow uploads?
7. **Pricing model** — per restaurant per month, or a cut of throughput? It
   decides whether M5 needs platform-level billing metering.

# Product Specification — Gold Trading Demo

**Context:** Asasa · Founding Engineer Practical Assessment
**Deliverable:** Deployable, single-user demo for buying and selling gold using live market data
**Expected effort:** ~3 hours (AI-assisted)
**Stack:** Railway (deploy) · Redis (price cache + quote lock) · Postgres (ledger + transactions)

---

## 1. Objective

Build a deployable, single-user demo for buying and selling gold using live market data.

The success test from the brief: **a reviewer should be able to open the deployed URL, understand the starting balances, complete a trade, and see the updated balances — without any extra guidance.** No walkthrough, no README required to operate it.

Guiding principle from the brief: **prioritize a coherent, finished feature set over gold plating.** Every hour spent on an extra feature is an hour not spent making the core flow correct and trustworthy.

---

## 2. Scope

### In scope
- Seeded product state (PKR wallet, customer gold holdings, platform inventory)
- Live 24K gold rate in PKR per gram, fetched server-side
- Two-source pricing with fallback and freshness reporting
- Buy and sell flows with a 75-second server-owned locked quote
- Atomic settlement with consistent balances and a receipt
- Safe handling of all failure and edge cases (§7)

### Out of scope (explicitly excluded by the brief)
- Authentication / user accounts
- Real money movement
- Admin panel

Anything else needed to keep the reviewer focused on the trading experience should be **mocked or seeded**.

---

## 3. Product state

Three balances are seeded at initialization and must be **internally consistent after every trade**:

| Balance | Owner | Unit | Purpose |
|---|---|---|---|
| PKR wallet | Customer | PKR | Cash available to buy gold |
| Gold holdings | Customer | grams (24K) | Gold owned by the customer |
| Platform inventory | Platform | grams (24K) | Gold the platform can sell to the customer |

### Consistency requirement
A trade is a **balanced transfer**. Nothing is created or destroyed:

- **BUY:** customer PKR ↓ · customer gold ↑ · platform inventory ↓ (by the same gram amount)
- **SELL:** customer PKR ↑ · customer gold ↓ · platform inventory ↑ (by the same gram amount)

Settlement must be **all-or-nothing**. A trade either fully applies or is fully rejected — there is no partial state.

### Implementation approach
- An **append-only `trades` table in Postgres is the source of truth** (immutable ledger).
- Balances are updated inside the **same Postgres transaction** that inserts the trade row, with balance guards enforced as DB-level constraints (`CHECK (balance >= 0)`) so an overdraw is impossible even under a race.
- The receipt is a rendering of the committed ledger row.

> **Design note:** this is ledger-*minded*, not a full double-entry accounting engine. Immutable trade records + atomic settlement + non-negative constraints gives the reviewer the fintech signal they're looking for without gold plating.

---

## 4. Pricing engine

### Sources

| Role | Source | Notes |
|---|---|---|
| **Primary** | PakGold | First choice |
| **Fallback** | GoldPrice.org | Used when primary is unavailable or untrustworthy |
| **Normalized output** | Market reference | **PKR / gram · 24K** |

Both sources must be normalized to a single market reference: **PKR per gram, 24K.** Unit and purity conversion (e.g. from tola, ounce, or a different karat) happens server-side.

### Fetch and cache rules
- Pricing is fetched **on the server only** — never from the browser.
- Fetch **no more than once every five minutes.** Redis holds the normalized price with a **300-second TTL**.
- Every user-facing surface shows **which source is selected** and **when it was last refreshed**.
- If **neither source can be trusted**, **trading pauses.** The UI must say so plainly rather than showing a stale price as if it were live.

### Freshness policy
Define and display two states explicitly:
- **Live** — cached value within the 5-minute window.
- **Stale / unavailable** — refresh failed and no trustworthy value exists → trading paused, quotes cannot be issued, existing quotes cannot be settled.

### Spread and guardrail

```
CUSTOMER BUYS   →  max(market × 1.10, guardrail)
CUSTOMER SELLS  →  market × 0.90
```

- The **buy price** is the greater of a 10% markup over market and the guardrail floor.
- The **sell price** is a flat 10% discount to market.
- The guardrail is a **floor on the buy price** — protection against an implausibly low market reference. See §12 for the open question on its exact value.

Prices shown to the user are always the **customer-facing** buy or sell price, never the raw market reference presented as a tradeable rate. The market reference and its source/freshness are shown for transparency.

---

## 5. Trade journey

The five steps from the brief:

| # | Step | What the user sees |
|---|---|---|
| 1 | **See price** | Live rate, source, and freshness |
| 2 | **Enter** | Amount in PKR **or** in grams (both directions supported, with live conversion) |
| 3 | **Review** | 75-second locked quote with a visible countdown |
| 4 | **Confirm** | Settles exactly once |
| 5 | **Complete** | Updated balances + receipt |

### Quote lifecycle rules (non-negotiable)
- **The server owns the locked quote.** The client countdown is a display of server truth, not the authority.
- The quote stores the exact locked price, side, gram amount, PKR amount, `issued_at`, and `expires_at`.
- **Expiry is validated server-side on confirm**, using the stored `expires_at` — not merely the absence of a cache key.
- **Never trade quietly at a different price.** If the quote has expired, the trade is rejected — it is never silently re-priced and settled.
- **If it expires, help the user get a new one.** The expired state is a guided path back to a fresh quote, not a dead end or a raw error.

### Implementation approach
- Quotes live in **Redis with a 75-second TTL**, keyed per user/session.
- Store `expires_at` **inside the quote payload** so the server can distinguish *"expired"* (helpful re-quote path) from *"never existed / invalid id"* (different message). TTL eviction alone loses that distinction.
- On confirm, the server re-validates: quote exists → not expired → price source still trustworthy → balances still sufficient → then settle.

---

## 6. Settlement and idempotency

**Requirement:** pressing Confirm twice must create exactly **one** trade.

### Approach
- Each quote carries a unique **idempotency key** (the quote ID is sufficient).
- The `trades` table has a **UNIQUE constraint on the idempotency key.**
- On confirm: attempt the insert inside a Postgres transaction. A duplicate key violation means the trade already settled → **return the existing receipt**, do not error and do not create a second trade.
- Postgres is the authority here, **not Redis.** A Redis-based lock is advisory; the DB unique constraint is what actually guarantees single settlement under concurrent requests.
- Additionally: mark the quote consumed in Redis on success so the normal path short-circuits fast, but never rely on that alone.

### Settlement transaction (single Postgres transaction)
1. Lock the balance rows (`SELECT ... FOR UPDATE`)
2. Re-verify sufficiency (cash / gold / inventory as applicable)
3. Insert the immutable trade row (unique idempotency key)
4. Apply the three balance updates
5. Commit — or roll back entirely

---

## 7. Trust requirements and edge cases

The brief lists these as *examples, not the full list.* Each must be handled visibly and honestly.

| Case | Required behaviour |
|---|---|
| **A source stops answering** | Fall back to secondary; show which source is live. If both fail → **pause trading** and say so. *"Does the product still tell the truth?"* |
| **A quote expires** | Reject settlement at the old price. Show a clear expired state with a one-tap path to a fresh quote. *"Can the user continue without confusion?"* |
| **Insufficient PKR** | Block before quoting where possible; block again at settle. Show the shortfall, not a generic error. |
| **Insufficient customer gold** | Same treatment on the sell side. |
| **Insufficient platform inventory** | Same treatment — the platform can run out of gold to sell. Named explicitly in the brief: *"cash, gold, and inventory all count."* |
| **Confirm pressed twice** | Exactly one trade. Second press returns the same receipt. |
| **Guardrail engaged** | Buy price floors at the guardrail; this should be observable by the reviewer. |
| **Stale price** | Freshness is always visible; never present a stale number as live. |

### Reviewer affordances — critical
> *"Reviewers should be able to try them, including the guardrail, without changing your deployed code."*

This is a **hard requirement with design consequences.** The deployed product must expose safe, discoverable ways to trigger each stress case. Suggested approach:

- A small **demo controls** panel (clearly separated from the trading UI) offering:
  - Force primary source failure / force both sources to fail
  - Force the guardrail to engage (e.g. temporarily raise the guardrail, or inject a low market reference)
  - Reset / re-seed balances to preset scenarios: *normal*, *low cash*, *low gold*, *low inventory*
- Double-confirm and quote expiry need no special affordance — a reviewer can trigger both naturally (double-click Confirm; let the countdown run out).

Keep these controls honest and obviously non-production — they demonstrate the failure handling rather than hiding it.

---

## 8. Visual direction

From the brief:
- **Calm, modern, and clearly financial without looking like a trading terminal.**
- **Use spacing and hierarchy before decoration.**
- **Treat mobile as a first-class surface.**
- Follow **Asasa's design system** (recommended — see §12).

### Palette

| Hex | Suggested role |
|---|---|
| `#0D4A46` | Deep teal — primary brand / headers / primary actions |
| `#8CCB50` | Green — accent, positive states, confirmation |
| `#F9FAFA` | Off-white — background surface |
| `#1A1F1B` | Near-black — primary text |

### Interface priorities
- Balances legible at a glance on first load — no interaction required to understand the starting state.
- Price source + freshness always visible, never buried.
- The 75-second countdown must be prominent and unambiguous.
- Receipt should read as a financial document: clear, itemized, and calm.
- Paused / degraded states styled deliberately, not as red error dumps.

---

## 9. Technical architecture

### Deployment — Railway
- Persistent Node process (not serverless) — quote and cache logic benefit from a long-lived server.
- Public HTTPS URL, **opens without reviewer credentials.**
- Environment variables for source endpoints, guardrail value, seed balances, and spread multipliers.

### Redis
| Key | TTL | Purpose |
|---|---|---|
| Price cache | **300s** | Normalized market reference + source + `fetched_at` |
| Quote | **75s** | Per-user locked quote payload incl. `expires_at` |

- Redis enforces the *"no more than once every five minutes"* fetch rule.
- Guard against a **cache stampede** on expiry (single-flight / lock) so a burst of requests triggers one upstream fetch, not many.

### Postgres
- **Source of truth** for balances and trades.
- Owns the atomicity and idempotency guarantees.
- Survives restarts and redeploys — balances persist for the reviewer.

### Suggested schema (starting point)

```sql
-- Immutable ledger
trades (
  id                uuid primary key,
  idempotency_key   text unique not null,   -- guarantees single settlement
  side              text not null,          -- 'BUY' | 'SELL'
  grams             numeric(18,6) not null,
  pkr_amount        numeric(18,2) not null,
  locked_price      numeric(18,2) not null, -- customer-facing PKR/gram
  market_reference  numeric(18,2) not null, -- pre-spread, for auditability
  price_source      text not null,          -- 'pakgold' | 'goldprice'
  price_fetched_at  timestamptz not null,
  guardrail_applied boolean not null,
  created_at        timestamptz not null default now()
)

-- Mutable balances, updated only inside the settle transaction
balances (
  id                 text primary key,      -- singleton row for the demo
  pkr_wallet         numeric(18,2) not null check (pkr_wallet >= 0),
  customer_gold_g    numeric(18,6) not null check (customer_gold_g >= 0),
  platform_gold_g    numeric(18,6) not null check (platform_gold_g >= 0),
  updated_at         timestamptz not null default now()
)
```

**Use `numeric`, never floats.** Money and gram amounts must not accumulate binary floating-point error. Decide and document rounding: PKR to 2 decimals, grams to a fixed precision (3 or 4 dp is reasonable for gold), rounding **in the platform's favour** at settlement, and disclosed on the receipt.

### Suggested API surface

| Endpoint | Purpose |
|---|---|
| `GET /api/price` | Current normalized rate, source, freshness, trading-enabled flag |
| `GET /api/state` | Seeded balances + recent trades |
| `POST /api/quote` | Issue a 75s locked quote (side + PKR or grams) |
| `POST /api/confirm` | Settle a quote idempotently → receipt |
| `POST /api/demo/*` | Reviewer stress-case controls (§7) |

---

## 10. Evaluation criteria

The brief evaluates on four axes. Map work back to these:

1. **Completion of brief** — every stated requirement present and working.
2. **Technical judgment & safety** — server-owned quotes, atomic settlement, idempotency, no float money, graceful degradation.
3. **Correctness & attention to detail** — pricing math, unit/purity normalization, rounding, balance consistency.
4. **Product thinking & visual craft** — legible first-load state, calm financial UI, mobile as a first-class surface, honest error states.

---

## 11. Submission checklist

Three links:

- [ ] **Public GitHub repository**
  - [ ] Setup instructions
  - [ ] `WhatIDid.md` covering: how the assignment was understood · assumptions made · what was built · key decisions · known gaps
- [ ] **Public deployed product** — opens without reviewer credentials
- [ ] **Build record** — full Claude Code / coding-agent transcript, or a continuous screen recording of the session
  - [ ] Secrets redacted
  - [ ] **Useful dead ends left in** (explicitly requested)

---

## 12. Open questions and assumptions to resolve

These need a decision before or early in the build. Document whichever way you go in `WhatIDid.md`.

1. **Guardrail value — undefined in the brief.** `max(market × 1.10, guardrail)` gives no number. Working assumption: an **absolute PKR/gram floor** on the customer buy price, set via env var, protecting against an implausibly low market reference. Must be **triggerable by a reviewer without code changes** (§7).
2. **"Curiosity helps; seek and you shall find."** Paired with *"We recommend following Asasa's design system."* — this strongly implies a publicly discoverable Asasa design system / brand resource. **Go find it before designing.** Ignoring this likely costs points on axis 4.
3. **Source API access.** Confirm PakGold and GoldPrice.org actually expose retrievable data and in what unit/purity/currency. Normalization (tola vs gram, ounce vs gram, karat conversion, USD→PKR) is where correctness points are won or lost.
4. **Seed values.** Choose PKR wallet, customer gold, and platform inventory amounts that let a reviewer complete a normal trade *and* reach each insufficiency case without excessive effort.
5. **Rounding and minimum trade size.** Define minimum gram/PKR amounts and rounding direction; show them on the receipt.
6. **Session identity without auth.** "Single-user" plus "no authentication" — decide whether the demo is one global shared state (simplest, but reviewers could collide) or a per-browser session. State the choice explicitly.
7. **Quote reuse.** Confirm whether a user can hold multiple concurrent quotes or only one at a time (one at a time is simpler and safer to reason about).
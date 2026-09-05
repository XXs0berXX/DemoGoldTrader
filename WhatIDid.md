# WhatIDid

## How I understood the assignment

The brief asks for a deployable single-user demo for buying and selling gold on live market data, and
sets one success test above all others:

> a reviewer should be able to open the deployed URL, understand the starting balances, complete a
> trade, and see the updated balances — without any extra guidance.

I read that as a *product* test, not a feature checklist. It rules out a README-operated demo, a
login wall, and a page that needs explaining. It also rules out gold plating: the brief says to
prioritise a coherent, finished feature set, so every hour went into making the core buy/sell loop
correct and trustworthy rather than adding surface area.

The second thing I took seriously is the line that reviewers must be able to try the failure cases,
*including the guardrail*, **without changing deployed code**. That is not a testing note — it is a
design constraint. It means the deployed product has to carry its own, honestly-labelled stress
controls. That shaped the architecture from the start rather than being bolted on at the end.

Third: "curiosity helps; seek and you shall find", paired with "we recommend following Asasa's design
system". I treated that as an instruction to go and find the real design system rather than invent a
plausible one. I did — see *Visual direction* below.

---

## Assumptions I made

The spec left several things genuinely undefined. Each of these was a decision, not a discovery, and
each is implemented exactly as stated here.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | **Guardrail value** — `max(market × 1.10, guardrail)` gives no number | An **absolute PKR/gram floor on the customer buy price**, env `GUARDRAIL_PKR_PER_GRAM`, default `30000` | A floor is the only reading under which the `max()` does anything useful: it protects the platform from selling gold cheaply if the market reference is implausibly low. Default sits well below live market (~39,500) so it is dormant until a reviewer raises it |
| 2 | **Reviewer access to the guardrail** | Runtime override via `POST /api/demo/guardrail`, surfaced as a button | The brief explicitly requires triggering it without code changes. An env var alone would fail that test |
| 3 | **Seed values** | PKR 250,000 · 6.8420 g customer gold · 100 g platform inventory | Enough to complete several normal trades. The insufficiency cases are reached through scenario presets rather than by making the default state awkward |
| 4 | **Rounding** | PKR 2 dp, grams 4 dp, rounded **in the platform's favour** at settlement, disclosed on the receipt | 4 dp on gold is ~PKR 4 of value — fine enough not to lose the customer money, coarse enough to be legible. Rounding direction is stated rather than silently favourable |
| 5 | **Minimum / maximum trade** | PKR 1,000 min, PKR 50,000 max | Taken from the "Limits" row in Asasa's own Buy screen, so the demo matches the real product's shape |
| 6 | **Session identity** | Balances are one **global singleton row**; quotes are **per-session** via an httpOnly cookie | The brief says single-user and no auth, so shared balances are the honest reading and the UI says so plainly. Quotes still had to be per-session — otherwise two reviewers could consume each other's locked quote, which would be a real correctness bug rather than a demo simplification |
| 7 | **Concurrent quotes** | One active quote per session | Simpler to reason about and impossible to mis-settle. A new quote invalidates the old one |
| 8 | **Karat conversion** | None needed | Both upstream feeds quote *pure* gold, so the 24K reference is the raw value. Tola (`× 11.6638`) is used for display only. Doing a karat conversion here would have been a bug, not a feature |

---

## What was built

A single Railway service running a persistent Node process that serves both the JSON API and the
built React SPA, backed by managed Postgres and Redis.

**Backend** (`backend/`, TypeScript strict, Express)
- Pricing engine with two source adapters behind one interface, normalized to PKR/gram 24K, a 300s
  Redis cache, a single-flight lock against cache stampede, and a sanity band that discards
  implausible values before they can reach a quote.
- Redis-backed quote store, 75s TTL, `expires_at` inside the payload, one active quote per session.
- Settlement in a single Postgres transaction with `SELECT … FOR UPDATE`, an append-only `trades`
  ledger, a `UNIQUE` idempotency key, and `CHECK (… >= 0)` on all three balances.
- `POST /api/demo/*` reviewer controls for source failure, guardrail override and balance scenarios.

**Frontend** (`frontend/`, React + Vite, hand-written CSS, no UI kit)
- The five-step journey rendered against Asasa's own screens: Home balance card, Buy/Sell entry with
  PKR↔grams conversion, Review with the locked-price countdown, and a receipt-styled Success screen.
- A countdown recomputed from the server's `expires_at` on every tick, so a throttled background tab
  cannot drift away from server truth.
- A clearly-labelled demo controls sheet exposing every stress case.

**Verification**
- 99 backend tests (unit + integration against real Postgres and Redis) and 46 frontend tests.
- `scripts/acceptance.mjs`, an independent end-to-end harness: 73 checks against a running server,
  re-deriving every number itself and fetching the upstream feeds directly to confirm the served
  rate is real.
- The suites were checked for vacuousness by mutation. Removing the fast-path duplicate check still
  passes — which proves the `UNIQUE`/23505 backstop genuinely carries single settlement rather than
  being decorative — while disabling both idempotency guards fails, and breaking gold conservation
  fails.

---

## Key decisions

### Pricing: two sources, normalized, and honest about which one is live

Both feeds are reduced to a single market reference — **PKR per gram, 24K**:

- **PakGold (primary)** — `api.gold-api.com/price/XAU` gives USD per troy ounce; `open.er-api.com`
  gives USD→PKR. Normalized as `(XAU × USDPKR) ÷ 31.1034768`. This is not a guess: pakgold.pk's page
  is client-rendered, and reading its JavaScript shows this is precisely the arithmetic it publishes.
  Rather than scrape a number out of rendered HTML, I reproduced their method against the same
  upstream APIs — which is both more reliable and more honest about where the number comes from.
- **GoldPrice.org (fallback)** — `data-asg.goldprice.org/dbXRates/PKR` returns `xauPrice` as PKR per
  troy ounce directly. Normalized as `xauPrice ÷ 31.1034768`. The endpoint returns `Forbidden`
  without a desktop `User-Agent` and a `goldprice.org` `Referer`.

**The cross-check is the point.** Two independently-sourced feeds, normalized through different
arithmetic, agreed to **0.022%** (39,547.38 vs 39,538.75 PKR/g). That agreement is the real evidence
the unit and purity handling is correct — a normalization bug of any size would show up here
immediately. The acceptance harness asserts this agreement on every run rather than trusting it once.

Prices are fetched **server-side only**, cached in Redis with a 300s TTL, and the refresh is guarded
by a single-flight lock so a burst of traffic causes one upstream fetch, not a stampede.

### Trading pauses rather than lying

If neither source can be trusted — network failure, non-2xx, schema drift, or a value outside a
sanity band — the product does **not** fall back to the last known price and present it as live. It
reports `UNAVAILABLE`, disables quoting and settling, and says why in plain language. A stale number
displayed as live is the one failure mode a financial product cannot have, so the degraded state is
designed rather than defaulted.

### The server owns the quote

The 75-second countdown in the UI is a *rendering of server truth*, not the authority. The quote
stores `expires_at` inside its Redis payload, and confirm validates against that stored timestamp
rather than inferring expiry from a missing key. That distinction matters: TTL eviction alone cannot
tell "this expired 3 seconds ago" from "this id never existed", and those deserve different messages
— one is a one-tap path back to a fresh quote, the other is an error. An expired quote is never
silently re-priced and settled.

### Postgres is the authority on settlement, not Redis

Settlement is a single transaction: lock the balances row `FOR UPDATE`, re-verify sufficiency, insert
the immutable trade row, apply all three balance updates, commit or roll back entirely. Three things
are deliberate here:

1. **Idempotency lives in a `UNIQUE` constraint** on the quote id, not in application logic. A
   duplicate confirm hits a constraint violation, which is caught and turned into *the original
   receipt* with `duplicate: true`. A Redis "consumed" flag exists too, but only as a fast path — it
   is advisory, and under a genuine concurrent double-press the database is what actually guarantees
   one trade. The acceptance harness fires both confirms with `Promise.all` for exactly this reason.
2. **Non-negative balances are `CHECK` constraints**, so an overdraw is impossible even if the
   application logic were wrong. There is a test that attacks the database directly to prove it.
3. **`numeric` everywhere, never floats** — money and gram amounts pass through `decimal.js` and
   cross the API as strings, so no binary floating-point error can accumulate into the ledger.

The `trades` table is append-only and is the source of truth; the receipt is a rendering of the
committed row. Re-seeding a demo scenario resets balances but never deletes ledger history.

### Visual direction: I went and found Asasa's design system

The brief hinted that it existed; the Figma file supplied with the assessment contains Asasa's actual
app screens — Home, Wallet/Top Up, and a three-step Buy → Review → Success flow — plus the brand
palette (`#0D4A46` deep teal, `#8CCB50` green, `#F9FAFA` off-white, `#1A1F1B` near-black).

That was worth more than the palette. Asasa's own Buy flow is already *exactly* the five-step journey
the brief describes, so the demo follows their screens rather than inventing a layout: the dark teal
balance card, the four quick actions, the live-rate row with its "updated" stamp, the green rate pill
carrying the countdown, the Review summary, and the receipt-styled success screen. Mobile was
designed first, at 390px, because the reference is a phone app and the brief calls mobile a
first-class surface.

---

## How this was built

Three agents working in parallel on isolated git worktrees against a frozen interface:

- An **orchestrator** that resolved every open question in the spec up front and froze them into
  [`API_CONTRACT.md`](API_CONTRACT.md) — endpoint shapes, error codes, rounding, seed values, path
  ownership — before either implementation started.
- A **backend agent** and a **frontend agent**, each owning one directory and one branch, coding
  against that contract simultaneously.

Freezing the interface first is what made the parallelism safe: with `backend/` and `frontend/`
owned by exactly one author each and every shared decision already written down, the two branches
merged without conflicts. The orchestrator reviewed each branch against the spec and ran an
independent acceptance harness before merging anything.

---

## Known gaps and things I would do next

Honest about what is not there:

- **Balances are global, quotes are per-session.** Two reviewers hitting the deployed URL at once
  share one wallet, so they can surprise each other. This is the documented reading of "single-user,
  no auth", and quotes are isolated so nobody can settle someone else's locked price — but a
  per-session ledger would be the real fix.
- **The FX rate is a single point of failure for the primary source.** PakGold's method needs
  USD→PKR, and only `open.er-api.com` supplies it. If that FX endpoint fails the primary source
  fails with it and the system falls back to GoldPrice.org, which is correct behaviour but means the
  primary is effectively two dependencies, not one. A second FX source would make the primary as
  resilient as the fallback.
- **No rate limiting on the demo endpoints.** They are public on a public URL. For a demo that is
  the point, but anyone can re-seed the balances at any time.
- **The 23505 idempotency handler is unreachable in normal operation.** The row lock serialises
  confirms, so the fast path catches every duplicate. It is deliberate defence-in-depth and it is
  proven to work when the fast path is removed, but it is not exercised by the ordinary flow.
- **Rate history is in-memory and per-browser.** The sparkline builds only while the page is open;
  it is not a real price history series.
- **No structured logging or metrics.** Fine for a demo, the first thing I would add for anything
  real.

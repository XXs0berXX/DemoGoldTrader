# API Contract — Gold Trading Demo

**This file is owned by the orchestrator (main agent). Backend and frontend agents MUST NOT edit it.**
It is the frozen interface between `backend/` and `frontend/`. Both sides code against it in parallel.
If you believe the contract is wrong, report it back to the orchestrator — do not unilaterally change it.

---

## 0. Repository layout & ownership

| Path | Owner | Notes |
|---|---|---|
| `backend/` | backend agent | Node + TypeScript + Express API |
| `frontend/` | frontend agent | React + Vite + TypeScript, mobile-first |
| `design-refs/` | orchestrator | Figma screenshots (read-only reference) |
| `API_CONTRACT.md`, `product_spec.md` | orchestrator | read-only for agents |
| `README.md`, `WhatIDid.md`, `railway.json`, `docker-compose.yml`, `.gitignore` | orchestrator | do not create/edit |

**Never touch a path you do not own.** This is what keeps the merges clean.

In production the backend serves the frontend's built static assets from `frontend/dist`, so there is
**one Railway service and one public URL**. No CORS in production. In local dev the Vite dev server
proxies `/api` to `http://localhost:8080`.

---

## 1. Resolved decisions (product_spec.md §12 open questions)

These are **decided**. Implement exactly these; do not re-open them.

1. **Guardrail** — an absolute PKR/gram **floor on the customer BUY price**, env `GUARDRAIL_PKR_PER_GRAM`,
   default `30000` (well below live market, so normally dormant). Reviewer raises it at runtime via
   `POST /api/demo/guardrail`. When the floor binds, `guardrail_applied = true` and the UI says so.
2. **Design system** — Asasa's own app design, captured in `design-refs/*.png`. Palette in §6 below.
3. **Price sources** — see §3. Normalization target: **PKR per gram, 24K**.
4. **Seed values** — `PKR wallet 250000.00`, `customer gold 6.8420 g`, `platform inventory 100.0000 g`.
5. **Rounding** — PKR `numeric(18,2)`, grams `numeric(18,4)`. Rounding is **in the platform's favour**
   at settlement (BUY: grams delivered round *down*; SELL: PKR paid out rounds *down*). Disclosed on the receipt.
   **Minimum trade PKR 1,000. Maximum trade PKR 50,000** (mirrors the Figma "Limits" row).
6. **Session identity** — balances are a **single global singleton row** (`balances.id = 'demo'`); this is a
   single-user demo and that is stated in the UI. **Quotes are per-session**, keyed by an
   `asasa_sid` httpOnly cookie the backend issues on first request, so two reviewers cannot
   consume each other's quote.
7. **Quote reuse** — **one active quote per session.** Issuing a new quote overwrites/invalidates the prior one.

---

## 2. Money & unit rules (backend is authoritative; frontend must never re-derive)

- **Never use JS `number` for money on the backend.** Use `decimal.js` (or equivalent) + Postgres `numeric`.
- Constants: `TROY_OUNCE_GRAMS = 31.1034768`, `TOLA_GRAMS = 11.6638`.
- All API money/gram values cross the wire as **strings** (e.g. `"39547.38"`, `"0.1012"`) to avoid
  float corruption. The frontend formats them for display and may use them in *display-only* estimates,
  but **every binding number comes from the server.**

### Spread

```
market            = normalized PKR/gram 24K
customer BUY /g   = max(market * 1.10, GUARDRAIL_PKR_PER_GRAM)
customer SELL /g  = market * 0.90
```

---

## 3. Price sources & normalization (backend)

**Primary — `pakgold`.** Replicates pakgold.pk's own published method (verified by reading their page JS):

```
XAU  = GET https://api.gold-api.com/price/XAU        -> .price  (USD per troy ounce, pure/24K)
FX   = GET https://open.er-api.com/v6/latest/USD     -> .rates.PKR
market_pkr_per_gram_24k = (XAU * FX) / 31.1034768
```

**Fallback — `goldprice`.** GoldPrice.org's own data feed:

```
GET https://data-asg.goldprice.org/dbXRates/PKR
    headers: User-Agent: <desktop browser UA>, Referer: https://goldprice.org/
    -> .items[0].xauPrice   (PKR per troy ounce, pure/24K)
market_pkr_per_gram_24k = xauPrice / 31.1034768
```

> Plain/absent User-Agent returns `Forbidden`. The browser UA + Referer are required.

**Cross-checked live 2026-09-05:** pakgold `39,547.38` vs goldprice `39,538.75` PKR/g — 0.022% divergence.

### Sanity / trust bounds

A fetched value is **untrustworthy** (and must be discarded, falling through to the next source) if it is
non-finite, `<= 0`, or outside `[PRICE_SANITY_MIN, PRICE_SANITY_MAX]`
(env, default `5000` … `500000` PKR/gram). Also treat HTTP non-2xx, timeout (5s), and schema mismatch as failure.

### Cache & freshness

- Redis key `price:current`, **TTL 300s**, holding `{ pkr_per_gram, source, fetched_at }`.
- Fetch at most once per 300s. Guard the refresh with a **single-flight Redis lock** (`price:lock`, ~10s TTL,
  `SET NX PX`) so a burst of requests triggers one upstream fetch, not a stampede. Losers of the lock
  briefly poll the cache rather than fetching.
- `LIVE` = a cached value exists. `UNAVAILABLE` = no trustworthy value → **trading paused**:
  `/api/quote` and `/api/confirm` must both reject with `409 TRADING_PAUSED`.
- **Never serve a stale price as live.** If the cache is empty and both sources fail, report unavailable.

---

## 4. HTTP API

All responses are JSON. All errors use this envelope:

```jsonc
{ "error": { "code": "MACHINE_CODE", "message": "Human sentence for the UI.", "details": { } } }
```

The frontend switches on `code`; `message` is safe to display verbatim.

### `GET /api/price`

```jsonc
{
  "trading_enabled": true,
  "freshness": "LIVE",                  // "LIVE" | "UNAVAILABLE"
  "market_pkr_per_gram": "39547.38",    // null when UNAVAILABLE
  "buy_pkr_per_gram":    "43502.12",    // null when UNAVAILABLE
  "sell_pkr_per_gram":   "35592.64",    // null when UNAVAILABLE
  "guardrail_pkr_per_gram": "30000.00",
  "guardrail_applied": false,           // true when the floor is binding the buy price
  "source": "pakgold",                  // "pakgold" | "goldprice" | null
  "fetched_at": "2026-09-05T20:19:32.000Z",
  "age_seconds": 12,
  "ttl_seconds": 288,
  "paused_reason": null                 // e.g. "Both price sources are unreachable." when UNAVAILABLE
}
```

### `GET /api/state`

```jsonc
{
  "balances": {
    "pkr_wallet": "250000.00",
    "customer_gold_g": "6.8420",
    "platform_gold_g": "100.0000",
    "updated_at": "2026-09-05T20:19:32.000Z"
  },
  "limits": { "min_pkr": "1000.00", "max_pkr": "50000.00", "gram_dp": 4, "pkr_dp": 2 },
  "trades": [                            // most recent first, max 20
    {
      "id": "uuid", "order_id": "ORDER-2026-0012345", "side": "BUY",
      "grams": "0.1320", "pkr_amount": "5000.00", "locked_price": "37800.00",
      "market_reference": "34363.64", "price_source": "pakgold",
      "price_fetched_at": "...", "guardrail_applied": false, "created_at": "..."
    }
  ],
  "scenario": "normal"                   // active demo scenario name
}
```

### `GET /api/price/history?range=1D|1W|1M|1Y`

Rate history for the home-screen chart. Read-only: it never gates trading.

```jsonc
{
  "range": "1M",
  "points": [{ "t": "2026-08-06T04:00:00.000Z", "v": "37847.63" }],
  "open": "37847.63", "close": "39485.37",
  "high": "41399.00", "low": "37847.63",
  "change_pct": "4.33",
  "source": "goldprice",
  "granularity": "daily close",
  "approximate_timestamps": false,   // true for 1D/1W — see below
  "as_of": "2026-09-04T04:00:00.000Z",
  "unavailable": false,
  "reason": null
}
```

Sourced from GoldPrice.org, the only one of the two upstreams that publishes history
(gold-api.com gates `/history/XAU` behind a key — it answers `401`):

| Range | Upstream | Notes |
|---|---|---|
| `1D`, `1W` | `GetData/PKR-XAU/0` | Live intraday array, PKR/troy-oz. **Carries no timestamps**, so points are spread evenly across the window; values are exact, x-axis instants are approximate (`approximate_timestamps: true`). Consecutive duplicates are upstream padding and are collapsed. |
| `1M`, `1Y` | `GetDataHistorical/PKR-XAU/0` | Daily closes back to 1998, PKR/troy-oz, **with** timestamps (`value × 100` = unix seconds). |

Both are divided by `31.1034768` — the same normalization as the live price, and no FX leg
is needed because GoldPrice already quotes PKR. Cached in Redis per range
(1D 300s · 1W 900s · 1M 1h · 1Y 6h) and flushed when the demo source-failure toggle changes.

An unfetchable series returns `200` with `unavailable: true` and a `reason`, never an error —
a broken chart must not look like a broken product. An unknown `range` is `400 INVALID_REQUEST`.

### `POST /api/quote`

```jsonc
// request — exactly one of pkr_amount / grams
{ "side": "BUY", "pkr_amount": "5000" }
{ "side": "SELL", "grams": "0.5" }
```

```jsonc
// 200
{
  "quote_id": "uuid",
  "side": "BUY",
  "grams": "0.1149",
  "pkr_amount": "5000.00",
  "locked_price_pkr_per_gram": "43502.12",
  "market_reference": "39547.38",
  "source": "pakgold",
  "price_fetched_at": "...",
  "guardrail_applied": false,
  "issued_at": "2026-09-05T20:19:32.000Z",
  "expires_at": "2026-09-05T20:20:47.000Z",   // issued_at + 75s
  "ttl_seconds": 75,
  "balances_after": { "pkr_wallet": "245000.00", "customer_gold_g": "6.9569", "platform_gold_g": "99.8851" }
}
```

Rejections (pre-quote validation — block early, with the shortfall, never a generic error):

| HTTP | code | when |
|---|---|---|
| 409 | `TRADING_PAUSED` | freshness `UNAVAILABLE` |
| 400 | `AMOUNT_BELOW_MINIMUM` | `< min_pkr`; `details.min_pkr` |
| 400 | `AMOUNT_ABOVE_MAXIMUM` | `> max_pkr`; `details.max_pkr` |
| 400 | `INVALID_REQUEST` | bad/missing/both-amount fields |
| 409 | `INSUFFICIENT_PKR` | BUY > wallet; `details: { required, available, shortfall }` |
| 409 | `INSUFFICIENT_GOLD` | SELL > customer gold; same `details` shape (grams) |
| 409 | `INSUFFICIENT_INVENTORY` | BUY grams > platform inventory; same `details` shape (grams) |

Quote lives in Redis, key `quote:{sid}:{quote_id}`, **TTL 75s**, payload **includes `expires_at`**.

### `POST /api/confirm`

```jsonc
{ "quote_id": "uuid" }
```

Server re-validates in order: quote exists → **not expired (compare stored `expires_at`, not key absence)** →
price source still trustworthy → balances still sufficient → settle.

```jsonc
// 200 — receipt (identical body on a duplicate confirm)
{
  "receipt": {
    "order_id": "ORDER-2026-0012345",
    "trade_id": "uuid",
    "side": "BUY",
    "grams": "0.1149",
    "pkr_amount": "5000.00",
    "locked_price_pkr_per_gram": "43502.12",
    "market_reference": "39547.38",
    "price_source": "pakgold",
    "guardrail_applied": false,
    "rounding_note": "Grams rounded down to 4 dp in the platform's favour.",
    "settled_at": "2026-09-05T20:19:40.000Z"
  },
  "balances": { "pkr_wallet": "245000.00", "customer_gold_g": "6.9569", "platform_gold_g": "99.8851" },
  "duplicate": false                       // true when this confirm hit the idempotency guard
}
```

| HTTP | code | when |
|---|---|---|
| 410 | `QUOTE_EXPIRED` | stored `expires_at` has passed → UI offers a one-tap re-quote |
| 404 | `QUOTE_NOT_FOUND` | never existed / wrong session / already invalidated — **distinct message from expired** |
| 409 | `TRADING_PAUSED` | price no longer trustworthy at settle time |
| 409 | `INSUFFICIENT_*` | balances moved since quoting |

**Idempotency:** `trades.idempotency_key = quote_id`, `UNIQUE`. On a duplicate-key violation, return the
**existing** receipt with `duplicate: true` and HTTP **200** — never a second trade, never an error.
Postgres is the authority; the Redis "consumed" marker is only a fast path.

### `POST /api/demo/*` — reviewer stress controls (§7 of the spec)

| Endpoint | Body | Effect |
|---|---|---|
| `POST /api/demo/source-failure` | `{ "mode": "none" \| "primary" \| "both" }` | Force primary (or both) source(s) to fail. Also flushes the price cache so the effect is immediate. |
| `POST /api/demo/guardrail` | `{ "pkr_per_gram": "60000" }` or `{ "reset": true }` | Override the guardrail floor at runtime so a reviewer can watch it bind. Flushes price cache. |
| `POST /api/demo/scenario` | `{ "scenario": "normal" \| "low_cash" \| "low_gold" \| "low_inventory" }` | Re-seed balances to a preset. Also clears the active quote. |
| `GET  /api/demo/status` | — | `{ "source_failure_mode": "none", "guardrail_override": null, "scenario": "normal" }` |

Scenario presets (PKR wallet / customer gold g / platform gold g):

- `normal` — `250000.00` / `6.8420` / `100.0000`
- `low_cash` — `1500.00` / `6.8420` / `100.0000`
- `low_gold` — `250000.00` / `0.0500` / `100.0000`
- `low_inventory` — `250000.00` / `6.8420` / `0.0500`

Demo state lives in Redis so it survives across requests but not a wipe. `POST /api/demo/scenario`
does **not** delete trade history (the ledger is append-only); it inserts no trade rows, it only resets
`balances` — and it must say so in the UI.

---

## 5. Postgres schema

Use the schema in `product_spec.md` §9 verbatim, plus:

- `trades.order_id text unique not null` — human receipt id, format `ORDER-YYYY-NNNNNNN`.
- `trades.grams numeric(18,4)`, `trades.pkr_amount numeric(18,2)` (per §1.5 rounding).
- `balances` seeded with the singleton `'demo'` row at migration time.
- CHECK constraints `>= 0` on all three balance columns — these are the last line of defence and
  **a test must prove an overdraw is rejected by the DB, not just by app code.**

Local dev DB: **Postgres via Docker** (`docker-compose.yml` at the repo root, orchestrator-owned —
`postgres:16-alpine` on `5433`, `redis:7-alpine` on `6380`, chosen off-default to avoid clashing with
anything already running). On Railway, use Railway's managed Postgres and Redis via `DATABASE_URL` / `REDIS_URL`.

---

## 6. Design tokens (from the Asasa Figma — `design-refs/`)

```
--asasa-primary:    #0D4A46   /* deep teal — gold card, headers, primary surfaces */
--asasa-accent:     #8CCB50   /* green — CTAs, positive states, active nav, rate pill */
--asasa-surface:    #F9FAFA   /* off-white page background */
--asasa-ink:        #1A1F1B   /* near-black primary text */
```

Screens in `design-refs/`: `home.png`, `wallet.png`, `buy-flow.png` (Buy → Review → Success).
**Mobile is the primary surface** — design at 390px width first, then let it centre in a phone-width
column on desktop. Match the reference closely: the dark teal gradient balance card, the four
quick-action icons, the live-rate row with "Updated Xm ago", the bottom tab bar, the green pill
showing `Rs. X/g · M:SS`, the Review summary rows, and the Success receipt.

---

## 7. Environment variables

| Var | Default | Used by |
|---|---|---|
| `PORT` | `8080` | backend |
| `DATABASE_URL` | — | backend |
| `REDIS_URL` | — | backend |
| `GUARDRAIL_PKR_PER_GRAM` | `30000` | backend |
| `BUY_SPREAD` / `SELL_SPREAD` | `1.10` / `0.90` | backend |
| `PRICE_TTL_SECONDS` | `300` | backend |
| `QUOTE_TTL_SECONDS` | `75` | backend |
| `MIN_TRADE_PKR` / `MAX_TRADE_PKR` | `1000` / `50000` | backend |
| `PRICE_SANITY_MIN` / `PRICE_SANITY_MAX` | `5000` / `500000` | backend |
| `SEED_PKR_WALLET` / `SEED_CUSTOMER_GOLD_G` / `SEED_PLATFORM_GOLD_G` | `250000` / `6.8420` / `100` | backend |

---

## 8. Definition of done (both agents)

- `npm test` passes in your directory, with **real** assertions — no skipped or trivially-true tests.
- `npm run build` and `npx tsc --noEmit` are clean. TypeScript `strict: true`. No `any` in exported surfaces.
- Every §7 edge case in `product_spec.md` is handled **visibly and honestly**.
- You committed to **your own branch only**, touching **only the paths you own**.

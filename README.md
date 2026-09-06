# Gold Trading Demo

A deployable, single-user demo for buying and selling 24K gold with live market data, built for the
Asasa founding-engineer practical assessment.

**Live demo:** https://demogoldtrader-production.up.railway.app
*(opens without credentials — no signup, no walkthrough needed)*

Open it, read the balances, make a trade, watch them update. Everything else on this page is for
people who want to run or inspect it.

---

## What it does

| | |
|---|---|
| **Live pricing** | 24K gold normalized to **PKR per gram** from two independent sources, fetched server-side only, cached in Redis for 300s |
| **Two-source failover** | PakGold primary → GoldPrice.org fallback → *trading pauses* if neither can be trusted. The live source and its age are always on screen |
| **Locked quotes** | 75-second, server-owned quote with a visible countdown. The server validates expiry against the stored `expires_at` — the client clock is never the authority |
| **Atomic settlement** | One Postgres transaction: row lock → re-verify → append immutable trade → update three balances → commit or roll back entirely |
| **Idempotent confirm** | A `UNIQUE` constraint on the quote id means pressing Confirm twice creates exactly one trade and returns the same receipt |
| **Rate history** | A 1D / 1W / 1M / 1Y chart of the market reference, sourced from GoldPrice.org's own daily and intraday feeds and normalized the same way as the live rate |
| **Reviewer controls** | A demo panel to force source failures, engage the guardrail, and re-seed to low-cash / low-gold / low-inventory scenarios — no code changes needed |

---

## Architecture

```
                  ┌──────────── Railway (one service, one public URL) ────────────┐
                  │                                                               │
  browser ───────▶│  Express (persistent Node process)                            │
                  │    ├── /api/*          JSON API                               │
                  │    └── /*              serves frontend/dist (built React SPA)  │
                  │                                                               │
                  │         │                        │                            │
                  └─────────┼────────────────────────┼────────────────────────────┘
                            ▼                        ▼
                     Redis (managed)          Postgres (managed)
                     price:current  300s      trades   — append-only ledger
                     quote:{sid}:*   75s      balances — singleton, CHECK >= 0
                            │
                            ▼  (server-side only, never from the browser)
              PakGold  ──▶  api.gold-api.com/price/XAU  x  open.er-api.com  ÷ 31.1034768
              GoldPrice ─▶  data-asg.goldprice.org/dbXRates/PKR             ÷ 31.1034768
```

The frontend is served by the same Node process that serves the API, so there is one origin, one
public URL, and no CORS in production.

### Pricing normalization

Both feeds are reduced to the same market reference — **PKR per gram, 24K**:

| Source | Raw unit | Conversion |
|---|---|---|
| **PakGold** (primary) | USD per troy ounce + USD→PKR rate | `(XAU_usd × USDPKR) ÷ 31.1034768` |
| **GoldPrice.org** (fallback) | PKR per troy ounce | `xauPrice ÷ 31.1034768` |

Both feeds quote *pure* gold, so 24K needs no karat scaling; a tola conversion (`× 11.6638`) is used
for display only. Cross-checked live, the two sources agree to within ~0.02%, which is the strongest
available evidence that the normalization is right.

Customer-facing prices apply the spread — `BUY = max(market × 1.10, guardrail)`,
`SELL = market × 0.90`. The raw market reference is shown for transparency but is never tradeable.

---

## Running it locally

**Requirements:** Node 20+ and Docker.

```bash
# 1. Postgres 16 + Redis 7 (ports 5433 / 6380, chosen to avoid clashing with local installs)
docker compose up -d

# 2. Install both workspaces
npm run install:all

# 3. Backend — http://localhost:8080
cd backend
cp .env.example .env      # defaults already point at the docker containers
npm run migrate           # creates the schema and seeds the singleton balances row
npm run dev

# 4. Frontend — http://localhost:5173, proxies /api to :8080
cd ../frontend
npm run dev
```

### Tests

```bash
npm test                          # both workspaces
npm --prefix backend test         # unit + integration (needs docker compose up)
npm --prefix frontend test        # component tests, fetch mocked

node scripts/acceptance.mjs                 # end-to-end against localhost:8080
node scripts/acceptance.mjs https://demogoldtrader-production.up.railway.app
```

`scripts/acceptance.mjs` is an independent harness: it drives a running server over HTTP and
re-derives every number itself — including fetching the upstream gold feeds directly to confirm the
server's normalized rate is real — rather than trusting the application's own assumptions.

---

## Trying the failure cases

The brief requires a reviewer to be able to trigger the stress cases **without changing deployed
code**, so the deployed UI carries a clearly-marked **Demo controls** panel:

| Case | How to trigger |
|---|---|
| Primary source down | Demo controls → *Fail primary source* → the price row switches to `goldprice` |
| Both sources down | Demo controls → *Fail both sources* → trading pauses, CTAs disable, reason shown |
| Guardrail engaged | Demo controls → *Raise guardrail* → buy price floors at the guardrail and says so |
| Insufficient cash / gold | Demo controls → scenario *low cash* / *low gold*, then type an amount — the shortfall and the reason appear at once |
| Insufficient inventory | Demo controls → scenario *low inventory*, then press Continue — Continue stays live, because only the server can answer this one |
| Quote expired | Start a trade and let the 75s countdown run out, then press Confirm |
| Confirm pressed twice | Double-click Confirm — one trade, same receipt |

The same controls are available over HTTP (`POST /api/demo/*`) if you prefer curl.

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/price` | Normalized rate, customer buy/sell prices, source, freshness, trading-enabled flag |
| `GET /api/state` | Seeded balances, limits, recent trades |
| `GET /api/price/history` | Rate history for the chart — `?range=1D\|1W\|1M\|1Y` |
| `POST /api/quote` | Issue a 75s locked quote (side + PKR **or** grams) |
| `POST /api/confirm` | Settle a quote idempotently, returns the receipt |
| `POST /api/demo/*` | Reviewer stress controls |
| `GET /api/health` | Liveness, used by the Railway healthcheck |

Full request/response shapes, every error code, and the reasoning behind each decision are in
[`API_CONTRACT.md`](API_CONTRACT.md). What was built and why, including the assumptions and the
known gaps, is in [`WhatIDid.md`](WhatIDid.md).

---

## Repository layout

```
backend/            Express API, pricing engine, quote store, settlement
frontend/           React + Vite SPA, mobile-first, Asasa design system
scripts/            Independent end-to-end acceptance harness
design-refs/        Asasa Figma screens used as the visual reference
API_CONTRACT.md     Frozen interface between backend and frontend
product_spec.md     The specification this was built against
docker-compose.yml  Local Postgres + Redis
railway.json        Deploy configuration
```

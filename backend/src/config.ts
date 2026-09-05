/**
 * Single source of truth for runtime configuration.
 *
 * Everything a reviewer might want to change (guardrail, spreads, TTLs, seed
 * balances, sanity band) is env-driven per API_CONTRACT.md §7. Numeric money
 * values are kept as strings here and only ever converted with decimal.js —
 * never parseFloat.
 */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be an integer, got ${JSON.stringify(raw)}`);
  return n;
}

/** Decimal-ish env values stay as strings; decimal.js parses them at the point of use. */
function dec(name: string, fallback: string): string {
  const raw = str(name, fallback);
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Env ${name} must be a non-negative decimal number, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

export const config = {
  nodeEnv: str('NODE_ENV', 'development'),
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  },
  get isTest(): boolean {
    return this.nodeEnv === 'test';
  },
  port: int('PORT', 8080),

  databaseUrl: str('DATABASE_URL', 'postgres://gold:gold@localhost:5433/goldtrader'),
  redisUrl: str('REDIS_URL', 'redis://localhost:6380'),

  /** Absolute PKR/gram floor under the customer BUY price. Normally dormant. */
  guardrailPkrPerGram: dec('GUARDRAIL_PKR_PER_GRAM', '30000'),
  buySpread: dec('BUY_SPREAD', '1.10'),
  sellSpread: dec('SELL_SPREAD', '0.90'),

  priceTtlSeconds: int('PRICE_TTL_SECONDS', 300),
  quoteTtlSeconds: int('QUOTE_TTL_SECONDS', 75),

  /**
   * The Redis quote key deliberately outlives the quote's own expires_at.
   * If the key evicted at exactly expires_at, a user confirming one second late
   * would get 404 QUOTE_NOT_FOUND ("never existed") instead of 410 QUOTE_EXPIRED
   * ("here is a fresh quote") — the precise confusion product_spec.md §5 forbids.
   * The *quote* still expires at 75s; only the tombstone lingers so the server
   * can answer honestly. See the deviation note in the handover.
   */
  quoteKeyGraceSeconds: int('QUOTE_KEY_GRACE_SECONDS', 900),
  /** How long we remember "this session settled this quote" for the fast idempotent path. */
  quoteConsumedTtlSeconds: int('QUOTE_CONSUMED_TTL_SECONDS', 86_400),

  priceLockTtlMs: int('PRICE_LOCK_TTL_MS', 10_000),
  upstreamTimeoutMs: int('UPSTREAM_TIMEOUT_MS', 5_000),

  minTradePkr: dec('MIN_TRADE_PKR', '1000'),
  maxTradePkr: dec('MAX_TRADE_PKR', '50000'),

  priceSanityMin: dec('PRICE_SANITY_MIN', '5000'),
  priceSanityMax: dec('PRICE_SANITY_MAX', '500000'),

  seed: {
    pkrWallet: dec('SEED_PKR_WALLET', '250000'),
    customerGoldG: dec('SEED_CUSTOMER_GOLD_G', '6.8420'),
    platformGoldG: dec('SEED_PLATFORM_GOLD_G', '100'),
  },

  /** Where the built SPA lives in production. Optional — the API boots without it. */
  frontendDist: process.env.FRONTEND_DIST,

  sessionCookieName: 'asasa_sid',
  sessionCookieMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
} as const;

export type Config = typeof config;

import { randomUUID } from 'node:crypto';
import { config } from '../config';
import {
  D,
  Decimal,
  fmtGrams,
  fmtPkr,
  GRAM_DP,
  gramsDown,
  gramsUp,
  PKR_DP,
  pkrDown,
  pkrUp,
} from '../money';
import { ApiError, invalidRequest } from '../errors';
import { getRedis, keys } from '../redis/client';
import type { Balances } from '../db/balances';
import type { SourceName } from '../pricing/sources';
import type { CustomerPricing } from '../pricing/engine';

export type Side = 'BUY' | 'SELL';
export type InputMode = 'PKR' | 'GRAMS';

/**
 * The stored quote. This is server truth: the client countdown is a rendering
 * of `expires_at`, never the authority.
 */
export interface StoredQuote {
  quote_id: string;
  sid: string;
  side: Side;
  input_mode: InputMode;
  grams: string;
  pkr_amount: string;
  locked_price_pkr_per_gram: string;
  market_reference: string;
  source: SourceName;
  price_fetched_at: string;
  guardrail_applied: boolean;
  issued_at: string;
  expires_at: string;
  rounding_note: string;
}

// ---------------------------------------------------------------------------
// Rounding policy
// ---------------------------------------------------------------------------
/**
 * The side the user typed is taken as given (normalised down to its dp); the
 * side we *derive* is always rounded against the customer. That single rule
 * produces all four cases below, and the receipt states which one applied.
 *
 *   BUY  by PKR    -> grams delivered rounded DOWN (customer receives less gold)
 *   BUY  by grams  -> PKR charged    rounded UP   (customer pays more)
 *   SELL by grams  -> PKR paid out   rounded DOWN (customer receives less cash)
 *   SELL by PKR    -> grams debited  rounded UP   (customer gives more gold)
 */
export interface DerivedAmounts {
  grams: Decimal;
  pkr: Decimal;
  roundingNote: string;
}

export function deriveAmounts(
  side: Side,
  inputMode: InputMode,
  amount: Decimal,
  lockedPrice: Decimal,
): DerivedAmounts {
  if (lockedPrice.lte(0)) throw new Error('locked price must be positive');

  if (side === 'BUY') {
    if (inputMode === 'PKR') {
      const pkr = pkrDown(amount);
      return {
        pkr,
        grams: gramsDown(pkr.dividedBy(lockedPrice)),
        roundingNote: `Grams rounded down to ${GRAM_DP} dp in the platform's favour.`,
      };
    }
    const grams = gramsDown(amount);
    return {
      grams,
      pkr: pkrUp(grams.times(lockedPrice)),
      roundingNote: `PKR charged rounded up to ${PKR_DP} dp in the platform's favour.`,
    };
  }

  if (inputMode === 'GRAMS') {
    const grams = gramsDown(amount);
    return {
      grams,
      pkr: pkrDown(grams.times(lockedPrice)),
      roundingNote: `PKR paid out rounded down to ${PKR_DP} dp in the platform's favour.`,
    };
  }
  const pkr = pkrDown(amount);
  return {
    pkr,
    grams: gramsUp(pkr.dividedBy(lockedPrice)),
    roundingNote: `Grams debited rounded up to ${GRAM_DP} dp in the platform's favour.`,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function assertWithinLimits(pkr: Decimal): void {
  const min = D(config.minTradePkr);
  const max = D(config.maxTradePkr);
  if (pkr.lt(min)) {
    throw new ApiError(
      400,
      'AMOUNT_BELOW_MINIMUM',
      `The minimum trade is PKR ${fmtPkr(min)}. This one works out to PKR ${fmtPkr(pkr)}.`,
      { min_pkr: fmtPkr(min), attempted_pkr: fmtPkr(pkr) },
    );
  }
  if (pkr.gt(max)) {
    throw new ApiError(
      400,
      'AMOUNT_ABOVE_MAXIMUM',
      `The maximum trade is PKR ${fmtPkr(max)}. This one works out to PKR ${fmtPkr(pkr)}.`,
      { max_pkr: fmtPkr(max), attempted_pkr: fmtPkr(pkr) },
    );
  }
}

const shortfallDetails = (
  required: Decimal,
  available: Decimal,
  fmt: (d: Decimal) => string,
): Record<string, string> => ({
  required: fmt(required),
  available: fmt(available),
  shortfall: fmt(required.minus(available)),
});

/**
 * The three insufficiency checks, used at quote time (block early) and again
 * inside the settle transaction (block late, under the row lock). Same code
 * both times so the two can never disagree.
 */
export function assertSufficient(side: Side, grams: Decimal, pkr: Decimal, balances: Balances): void {
  if (side === 'BUY') {
    if (pkr.gt(balances.pkrWallet)) {
      throw new ApiError(
        409,
        'INSUFFICIENT_PKR',
        `This trade needs PKR ${fmtPkr(pkr)} but your wallet holds PKR ${fmtPkr(balances.pkrWallet)} — ` +
          `you are PKR ${fmtPkr(pkr.minus(balances.pkrWallet))} short.`,
        shortfallDetails(pkr, balances.pkrWallet, fmtPkr),
      );
    }
    if (grams.gt(balances.platformGoldG)) {
      throw new ApiError(
        409,
        'INSUFFICIENT_INVENTORY',
        `We only have ${fmtGrams(balances.platformGoldG)} g of gold left to sell and this trade needs ` +
          `${fmtGrams(grams)} g — ${fmtGrams(grams.minus(balances.platformGoldG))} g short.`,
        shortfallDetails(grams, balances.platformGoldG, fmtGrams),
      );
    }
    return;
  }

  if (grams.gt(balances.customerGoldG)) {
    throw new ApiError(
      409,
      'INSUFFICIENT_GOLD',
      `This trade needs ${fmtGrams(grams)} g but you hold ${fmtGrams(balances.customerGoldG)} g — ` +
        `${fmtGrams(grams.minus(balances.customerGoldG))} g short.`,
      shortfallDetails(grams, balances.customerGoldG, fmtGrams),
    );
  }
}

/** Projected balances if this trade settles. Display-only; settlement recomputes. */
export function projectBalances(
  side: Side,
  grams: Decimal,
  pkr: Decimal,
  balances: Balances,
): { pkrWallet: Decimal; customerGoldG: Decimal; platformGoldG: Decimal } {
  const sign = side === 'BUY' ? 1 : -1;
  return {
    pkrWallet: balances.pkrWallet.minus(pkr.times(sign)),
    customerGoldG: balances.customerGoldG.plus(grams.times(sign)),
    platformGoldG: balances.platformGoldG.minus(grams.times(sign)),
  };
}

// ---------------------------------------------------------------------------
// Redis-backed quote store
// ---------------------------------------------------------------------------

export interface IssueQuoteInput {
  sid: string;
  side: Side;
  inputMode: InputMode;
  amount: Decimal;
  pricing: CustomerPricing;
  source: SourceName;
  priceFetchedAt: Date;
  balances: Balances;
}

export async function issueQuote(input: IssueQuoteInput): Promise<StoredQuote> {
  const lockedPrice = input.side === 'BUY' ? input.pricing.buy : input.pricing.sell;
  if (lockedPrice.lte(0)) {
    throw invalidRequest('The current price is not usable for a quote. Please try again shortly.');
  }

  const { grams, pkr, roundingNote } = deriveAmounts(
    input.side,
    input.inputMode,
    input.amount,
    lockedPrice,
  );

  if (grams.lte(0)) {
    throw invalidRequest('That amount is too small to trade — it rounds to zero grams.');
  }
  assertWithinLimits(pkr);
  assertSufficient(input.side, grams, pkr, input.balances);

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + config.quoteTtlSeconds * 1000);

  const quote: StoredQuote = {
    quote_id: randomUUID(),
    sid: input.sid,
    side: input.side,
    input_mode: input.inputMode,
    grams: fmtGrams(grams),
    pkr_amount: fmtPkr(pkr),
    locked_price_pkr_per_gram: fmtPkr(lockedPrice),
    market_reference: fmtPkr(input.pricing.market),
    source: input.source,
    price_fetched_at: input.priceFetchedAt.toISOString(),
    guardrail_applied: input.pricing.guardrailApplied,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    rounding_note: roundingNote,
  };

  await storeQuote(quote);
  return quote;
}

/**
 * One active quote per session: issuing a new quote invalidates the previous
 * one, so a user can never hold two live locks on the same balances.
 *
 * The Redis key TTL is quote TTL + grace. The extra time is *not* extra quote
 * life — `expires_at` inside the payload is the only expiry authority — it
 * exists so a late confirm gets 410 QUOTE_EXPIRED with a re-quote path instead
 * of a bewildering 404.
 */
export async function storeQuote(quote: StoredQuote): Promise<void> {
  const redis = getRedis();
  const previousId = await redis.get(keys.activeQuote(quote.sid));
  const keyTtl = config.quoteTtlSeconds + config.quoteKeyGraceSeconds;

  const tx = redis.multi();
  if (previousId && previousId !== quote.quote_id) {
    tx.del(keys.quote(quote.sid, previousId));
  }
  tx.set(keys.quote(quote.sid, quote.quote_id), JSON.stringify(quote), 'EX', keyTtl);
  tx.set(keys.activeQuote(quote.sid), quote.quote_id, 'EX', keyTtl);
  await tx.exec();
}

export async function loadQuote(sid: string, quoteId: string): Promise<StoredQuote | null> {
  const raw = await getRedis().get(keys.quote(sid, quoteId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as StoredQuote;
    return parsed.quote_id === quoteId && parsed.sid === sid ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fast path for repeat confirms, remembered per session and outliving the quote
 * key itself. It carries the rounding note so a very late duplicate confirm can
 * still be answered with the *same* receipt, word for word. Postgres remains the
 * authority — this only tells us the quote belonged to this session.
 */
export interface ConsumedMarker {
  order_id: string;
  rounding_note: string;
}

export async function markConsumed(sid: string, quoteId: string, marker: ConsumedMarker): Promise<void> {
  await getRedis().set(
    keys.consumedQuote(sid, quoteId),
    JSON.stringify(marker),
    'EX',
    config.quoteConsumedTtlSeconds,
  );
}

export async function wasConsumed(sid: string, quoteId: string): Promise<ConsumedMarker | null> {
  const raw = await getRedis().get(keys.consumedQuote(sid, quoteId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as ConsumedMarker;
    return typeof parsed.order_id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** Expiry is decided by the stored timestamp, never by key absence. */
export function isExpired(quote: StoredQuote, now: Date = new Date()): boolean {
  const expiresAt = Date.parse(quote.expires_at);
  if (Number.isNaN(expiresAt)) return true;
  return now.getTime() >= expiresAt;
}

export function secondsRemaining(quote: StoredQuote, now: Date = new Date()): number {
  const expiresAt = Date.parse(quote.expires_at);
  if (Number.isNaN(expiresAt)) return 0;
  return Math.max(0, Math.ceil((expiresAt - now.getTime()) / 1000));
}

/** Drop every live quote (all sessions). Used by the demo scenario reset. */
export async function clearAllQuotes(): Promise<number> {
  const redis = getRedis();
  let cursor = '0';
  let removed = 0;
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'quote:*', 'COUNT', 200);
    cursor = next;
    if (batch.length > 0) removed += await redis.del(...batch);
  } while (cursor !== '0');
  return removed;
}

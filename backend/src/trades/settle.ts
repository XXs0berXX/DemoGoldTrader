import type { PoolClient } from 'pg';
import { isPgError, PG_UNIQUE_VIOLATION, withTransaction } from '../db/pool';
import { getBalances, lockBalancesForUpdate, writeBalances, type Balances } from '../db/balances';
import { D, fmtGrams, fmtPkr } from '../money';
import { assertSufficient, projectBalances, type StoredQuote } from '../quotes/service';
import { findTradeByIdempotencyKey, TRADE_COLUMNS, type TradeRow } from './repository';

export interface SettleResult {
  trade: TradeRow;
  balances: Balances;
  /** True when this confirm hit the idempotency guard instead of creating a trade. */
  duplicate: boolean;
}

/**
 * Settle a quote. All-or-nothing, exactly once.
 *
 * Inside one Postgres transaction:
 *   1. SELECT ... FOR UPDATE the singleton balances row. Every concurrent
 *      confirm serialises here, before anything is decided.
 *   2. Under that lock, check whether this quote already settled. If it did,
 *      return the existing receipt — the *first* thing we do after locking, so
 *      a duplicate confirm can never be mistaken for an insufficiency.
 *   3. Re-verify sufficiency against the freshly-locked balances.
 *   4. INSERT the immutable trade row (UNIQUE idempotency_key).
 *   5. Apply all three balance updates.
 *   6. COMMIT — or roll the whole thing back.
 *
 * Step 2 makes duplicates cheap; the UNIQUE constraint (and the 23505 handler
 * below) is what makes single settlement *true*. Redis is never the authority.
 */
export async function settleQuote(quote: StoredQuote): Promise<SettleResult> {
  try {
    return await withTransaction(async (client) => {
      const balances = await lockBalancesForUpdate(client);

      const existing = await findTradeByIdempotencyKey(quote.quote_id, client);
      if (existing) {
        return { trade: existing, balances, duplicate: true };
      }

      const grams = D(quote.grams);
      const pkr = D(quote.pkr_amount);

      // Balances may have moved since the quote was issued (another trade, or a
      // demo scenario reset). Re-check under the lock.
      assertSufficient(quote.side, grams, pkr, balances);

      const trade = await insertTrade(client, quote);
      const next = projectBalances(quote.side, grams, pkr, balances);
      const updated = await writeBalances(client, next);

      return { trade, balances: updated, duplicate: false };
    });
  } catch (err) {
    // Last line of defence. Under the row lock this should be unreachable, but
    // if two settlements ever bypassed the lock the database still refuses the
    // second write — and we answer with the original receipt, not an error.
    if (isPgError(err, PG_UNIQUE_VIOLATION)) {
      const existing = await findTradeByIdempotencyKey(quote.quote_id);
      if (existing) {
        return { trade: existing, balances: await getBalances(), duplicate: true };
      }
    }
    throw err;
  }
}

async function insertTrade(client: PoolClient, quote: StoredQuote): Promise<TradeRow> {
  const { rows } = await client.query<TradeRow>(
    `INSERT INTO trades (
        order_id, idempotency_key, side, grams, pkr_amount, locked_price,
        market_reference, price_source, price_fetched_at, guardrail_applied
     ) VALUES (
        'ORDER-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('trade_order_seq')::text, 7, '0'),
        $1, $2, $3, $4, $5, $6, $7, $8, $9
     )
     RETURNING ${TRADE_COLUMNS}`,
    [
      quote.quote_id,
      quote.side,
      fmtGrams(D(quote.grams)),
      fmtPkr(D(quote.pkr_amount)),
      fmtPkr(D(quote.locked_price_pkr_per_gram)),
      fmtPkr(D(quote.market_reference)),
      quote.source,
      quote.price_fetched_at,
      quote.guardrail_applied,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('trade insert returned no row');
  return row;
}

export interface Receipt {
  order_id: string;
  trade_id: string;
  side: string;
  grams: string;
  pkr_amount: string;
  locked_price_pkr_per_gram: string;
  market_reference: string;
  price_source: string;
  guardrail_applied: boolean;
  rounding_note: string;
  settled_at: string;
}

export function buildReceipt(trade: TradeRow, roundingNote: string): Receipt {
  return {
    order_id: trade.order_id,
    trade_id: trade.id,
    side: trade.side,
    grams: trade.grams,
    pkr_amount: trade.pkr_amount,
    locked_price_pkr_per_gram: trade.locked_price,
    market_reference: trade.market_reference,
    price_source: trade.price_source,
    guardrail_applied: trade.guardrail_applied,
    rounding_note: roundingNote,
    settled_at: trade.created_at.toISOString(),
  };
}

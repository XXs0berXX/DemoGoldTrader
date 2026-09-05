import type { PoolClient } from 'pg';
import { getPool } from '../db/pool';
import type { Side } from '../quotes/service';

/** A row of the immutable ledger. All numerics arrive as strings. */
export interface TradeRow {
  id: string;
  order_id: string;
  idempotency_key: string;
  side: Side;
  grams: string;
  pkr_amount: string;
  locked_price: string;
  market_reference: string;
  price_source: string;
  price_fetched_at: Date;
  guardrail_applied: boolean;
  created_at: Date;
}

export const TRADE_COLUMNS = `
  id, order_id, idempotency_key, side, grams, pkr_amount, locked_price,
  market_reference, price_source, price_fetched_at, guardrail_applied, created_at
`;

export async function findTradeByIdempotencyKey(
  key: string,
  client?: PoolClient,
): Promise<TradeRow | null> {
  const runner = client ?? getPool();
  const { rows } = await runner.query<TradeRow>(
    `SELECT ${TRADE_COLUMNS} FROM trades WHERE idempotency_key = $1`,
    [key],
  );
  return rows[0] ?? null;
}

export async function listRecentTrades(limit = 20): Promise<TradeRow[]> {
  const { rows } = await getPool().query<TradeRow>(
    `SELECT ${TRADE_COLUMNS} FROM trades ORDER BY created_at DESC, order_id DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function countTrades(): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>('SELECT count(*)::text AS n FROM trades');
  return Number.parseInt(rows[0]?.n ?? '0', 10);
}

/** Wire shape for `GET /api/state`. */
export interface TradeWire {
  id: string;
  order_id: string;
  side: Side;
  grams: string;
  pkr_amount: string;
  locked_price: string;
  market_reference: string;
  price_source: string;
  price_fetched_at: string;
  guardrail_applied: boolean;
  created_at: string;
}

export function tradeToWire(t: TradeRow): TradeWire {
  return {
    id: t.id,
    order_id: t.order_id,
    side: t.side,
    grams: t.grams,
    pkr_amount: t.pkr_amount,
    locked_price: t.locked_price,
    market_reference: t.market_reference,
    price_source: t.price_source,
    price_fetched_at: t.price_fetched_at.toISOString(),
    guardrail_applied: t.guardrail_applied,
    created_at: t.created_at.toISOString(),
  };
}

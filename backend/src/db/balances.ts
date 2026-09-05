import type { PoolClient } from 'pg';
import { getPool } from './pool';
import { config } from '../config';
import { D, Decimal, fmtGrams, fmtPkr } from '../money';

/** The demo is explicitly single-user: one global singleton balances row. */
export const BALANCES_ID = 'demo';

/** Raw row shape. All numerics arrive as strings (see pool.ts type parsers). */
interface BalancesRow {
  id: string;
  pkr_wallet: string;
  customer_gold_g: string;
  platform_gold_g: string;
  updated_at: Date;
}

export interface Balances {
  pkrWallet: Decimal;
  customerGoldG: Decimal;
  platformGoldG: Decimal;
  updatedAt: Date;
}

export interface BalancesWire {
  pkr_wallet: string;
  customer_gold_g: string;
  platform_gold_g: string;
  updated_at?: string;
}

function toBalances(row: BalancesRow): Balances {
  return {
    pkrWallet: D(row.pkr_wallet),
    customerGoldG: D(row.customer_gold_g),
    platformGoldG: D(row.platform_gold_g),
    updatedAt: row.updated_at,
  };
}

export function balancesToWire(b: Balances, includeUpdatedAt = true): BalancesWire {
  const wire: BalancesWire = {
    pkr_wallet: fmtPkr(b.pkrWallet),
    customer_gold_g: fmtGrams(b.customerGoldG),
    platform_gold_g: fmtGrams(b.platformGoldG),
  };
  if (includeUpdatedAt) wire.updated_at = b.updatedAt.toISOString();
  return wire;
}

const SELECT_COLUMNS = 'id, pkr_wallet, customer_gold_g, platform_gold_g, updated_at';

export async function getBalances(client?: PoolClient): Promise<Balances> {
  const runner = client ?? getPool();
  const { rows } = await runner.query<BalancesRow>(
    `SELECT ${SELECT_COLUMNS} FROM balances WHERE id = $1`,
    [BALANCES_ID],
  );
  const row = rows[0];
  if (!row) throw new Error(`balances row "${BALANCES_ID}" is missing — did the seed run?`);
  return toBalances(row);
}

/**
 * Take the row lock for settlement. Every writer must go through here, so
 * concurrent confirms serialise on the same row before any sufficiency check.
 */
export async function lockBalancesForUpdate(client: PoolClient): Promise<Balances> {
  const { rows } = await client.query<BalancesRow>(
    `SELECT ${SELECT_COLUMNS} FROM balances WHERE id = $1 FOR UPDATE`,
    [BALANCES_ID],
  );
  const row = rows[0];
  if (!row) throw new Error(`balances row "${BALANCES_ID}" is missing — did the seed run?`);
  return toBalances(row);
}

export interface BalanceTargets {
  pkrWallet: Decimal;
  customerGoldG: Decimal;
  platformGoldG: Decimal;
}

/** Absolute write, used by settlement (post-arithmetic) and by demo scenarios. */
export async function writeBalances(client: PoolClient | undefined, next: BalanceTargets): Promise<Balances> {
  const runner = client ?? getPool();
  const { rows } = await runner.query<BalancesRow>(
    `UPDATE balances
        SET pkr_wallet = $2, customer_gold_g = $3, platform_gold_g = $4, updated_at = now()
      WHERE id = $1
      RETURNING ${SELECT_COLUMNS}`,
    [BALANCES_ID, fmtPkr(next.pkrWallet), fmtGrams(next.customerGoldG), fmtGrams(next.platformGoldG)],
  );
  const row = rows[0];
  if (!row) throw new Error(`balances row "${BALANCES_ID}" is missing — did the seed run?`);
  return toBalances(row);
}

/** Create the singleton if it is absent. Never overwrites an existing demo state. */
export async function ensureSeeded(): Promise<Balances> {
  await getPool().query(
    `INSERT INTO balances (id, pkr_wallet, customer_gold_g, platform_gold_g)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [
      BALANCES_ID,
      fmtPkr(D(config.seed.pkrWallet)),
      fmtGrams(D(config.seed.customerGoldG)),
      fmtGrams(D(config.seed.platformGoldG)),
    ],
  );
  return getBalances();
}

/** Force the singleton back to the env seed values (`npm run seed`). */
export async function reseed(): Promise<Balances> {
  await ensureSeeded();
  return writeBalances(undefined, {
    pkrWallet: D(config.seed.pkrWallet),
    customerGoldG: D(config.seed.customerGoldG),
    platformGoldG: D(config.seed.platformGoldG),
  });
}

import { Pool, types, type PoolClient } from 'pg';
import { config } from '../config';

/**
 * Force every numeric/decimal column to arrive as a *string*.
 *
 * node-postgres already does this for OID 1700 by default, but it is set
 * explicitly here because it is the single most important line in the money
 * layer: if this parser ever became `parseFloat`, every balance in the system
 * would silently acquire binary floating-point error. int8 gets the same
 * treatment so a large sequence value cannot lose precision either.
 */
const NUMERIC_OID = 1700;
const INT8_OID = 20;
types.setTypeParser(NUMERIC_OID, (v: string) => v);
types.setTypeParser(INT8_OID, (v: string) => v);

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Railway's managed Postgres terminates TLS with its own CA; local Docker
    // has no TLS at all. Only opt in when the URL asks for it.
    ssl: /sslmode=require/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  pool.on('error', (err: Error) => {
    console.error('[pg] idle client error:', err.message);
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const p = pool;
  pool = null;
  await p.end();
}

/**
 * Run `fn` inside a single transaction. Commits on resolve, rolls back on
 * throw. The client is always released, including when ROLLBACK itself fails.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[pg] rollback failed:', (rollbackErr as Error).message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres unique_violation. This is the idempotency guarantee, not Redis. */
export const PG_UNIQUE_VIOLATION = '23505';
/** Postgres check_violation. This is the overdraw guarantee. */
export const PG_CHECK_VIOLATION = '23514';

export function isPgError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === code;
}

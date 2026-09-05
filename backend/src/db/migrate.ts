import fs from 'node:fs';
import path from 'node:path';
import { getPool } from './pool';

/**
 * Plain-SQL migration runner.
 *
 * - Every file is idempotent on its own (IF NOT EXISTS / CREATE OR REPLACE),
 *   and `schema_migrations` additionally stops re-execution.
 * - Runs on boot and via `npm run migrate`.
 * - An advisory lock serialises concurrent boots (two Railway instances, or a
 *   test suite racing the dev server) so two runners cannot apply the same file.
 */

const MIGRATION_ADVISORY_LOCK = 918_273_645;

function resolveMigrationsDir(): string {
  const candidates: string[] = [];
  if (process.env.MIGRATIONS_DIR) candidates.push(process.env.MIGRATIONS_DIR);
  if (typeof __dirname !== 'undefined') candidates.push(path.resolve(__dirname, 'migrations'));
  // Fallbacks for runners that do not provide __dirname (some ESM transforms).
  candidates.push(
    path.resolve(process.cwd(), 'src/db/migrations'),
    path.resolve(process.cwd(), 'dist/db/migrations'),
    path.resolve(process.cwd(), 'backend/src/db/migrations'),
    path.resolve(process.cwd(), 'backend/dist/db/migrations'),
  );
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
  }
  throw new Error(`Could not locate migrations directory. Tried:\n  ${candidates.join('\n  ')}`);
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(): Promise<MigrationResult> {
  const dir = resolveMigrationsDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pool = getPool();
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK]);

    const { rows } = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations');
    const done = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      // Each migration file is its own transaction: a failure leaves the
      // earlier files applied and this one entirely unapplied.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        console.log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK]);
    } catch {
      /* connection may already be gone */
    }
    client.release();
  }

  return { applied, skipped };
}

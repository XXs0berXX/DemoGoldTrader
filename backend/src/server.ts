import type { Server } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { runMigrations } from './db/migrate';
import { ensureSeeded } from './db/balances';
import { closePool } from './db/pool';
import { closeRedis } from './redis/client';
import { getPricingEngine } from './pricing/engine';

async function main(): Promise<void> {
  // Migrations run on boot so a fresh Railway deploy is ready with no manual
  // step, and so the reviewer's balances survive redeploys.
  const migrations = await runMigrations();
  console.log(
    `[boot] migrations: ${migrations.applied.length} applied, ${migrations.skipped.length} already present`,
  );
  const balances = await ensureSeeded();
  console.log(
    `[boot] balances: PKR ${balances.pkrWallet.toFixed(2)} · customer ${balances.customerGoldG.toFixed(4)} g · ` +
      `platform ${balances.platformGoldG.toFixed(4)} g`,
  );

  const app = createApp();
  const server: Server = app.listen(config.port, () => {
    console.log(`[boot] listening on :${config.port} (${config.nodeEnv})`);
  });

  // Warm the price cache so the first visitor does not wait on two upstream
  // calls. A failure here is not fatal — the API reports UNAVAILABLE honestly.
  void getPricingEngine()
    .getPrice()
    .then((p) =>
      console.log(
        p.freshness === 'LIVE'
          ? `[boot] price warm: ${p.market.toFixed(2)} PKR/g from ${p.source}`
          : `[boot] price unavailable at start: ${p.reason}`,
      ),
    )
    .catch((err: Error) => console.warn('[boot] price warm-up failed:', err.message));

  const shutdown = (signal: string): void => {
    console.log(`[shutdown] ${signal} received, draining…`);
    server.close(() => {
      void Promise.allSettled([closePool(), closeRedis()]).then(() => {
        console.log('[shutdown] done');
        process.exit(0);
      });
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  console.error('[boot] failed to start:', err);
  process.exit(1);
});

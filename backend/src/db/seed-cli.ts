import { runMigrations } from './migrate';
import { reseed } from './balances';
import { closePool } from './pool';

/**
 * `npm run seed` forces balances back to the env seed values.
 * It deliberately does NOT touch `trades` — the ledger is append-only.
 */
async function main(): Promise<void> {
  await runMigrations();
  const balances = await reseed();
  console.log(
    `[seed] balances reset to: PKR ${balances.pkrWallet.toFixed(2)} · ` +
      `customer ${balances.customerGoldG.toFixed(4)} g · platform ${balances.platformGoldG.toFixed(4)} g`,
  );
  console.log('[seed] trades ledger left untouched (append-only).');
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err: unknown) => {
    console.error('[seed] failed:', err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });

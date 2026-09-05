import { runMigrations } from './migrate';
import { ensureSeeded } from './balances';
import { closePool } from './pool';

async function main(): Promise<void> {
  const result = await runMigrations();
  console.log(
    `[migrate] done — applied ${result.applied.length}, already present ${result.skipped.length}`,
  );
  const balances = await ensureSeeded();
  console.log(
    `[migrate] balances singleton present: PKR ${balances.pkrWallet.toFixed(2)} · ` +
      `customer ${balances.customerGoldG.toFixed(4)} g · platform ${balances.platformGoldG.toFixed(4)} g`,
  );
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err: unknown) => {
    console.error('[migrate] failed:', err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });

// tsc does not copy non-TS assets. The .sql migration files must ship in dist/
// so that `npm start` (production, no tsx) can run migrations on boot.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = resolve(here, '../src/db/migrations');
const to = resolve(here, '../dist/db/migrations');

if (!existsSync(from)) {
  console.error(`[copy-migrations] source directory missing: ${from}`);
  process.exit(1);
}
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`[copy-migrations] copied ${from} -> ${to}`);

import { defineConfig } from 'vitest/config';

// Integration tests run against the real local Postgres + Redis from the
// repo-root docker-compose. Redis logical DB 1 is used so a test run never
// clobbers whatever the dev server has cached in DB 0.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // Keep the console output of failing tests, drop the noise from passing ones.
    silent: 'passed-only',
    // Postgres row-level locking + the singleton balances row mean parallel
    // test files would deadlock/interfere. One file at a time, deliberately.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://gold:gold@localhost:5433/goldtrader',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/1',
    },
  },
});

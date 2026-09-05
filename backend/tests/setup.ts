import { afterAll } from 'vitest';
import { closePool } from '../src/db/pool';
import { closeRedis } from '../src/redis/client';

// Without this the pg pool and the ioredis socket keep the process alive and
// vitest hangs after the last assertion.
afterAll(async () => {
  await Promise.allSettled([closePool(), closeRedis()]);
});

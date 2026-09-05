import Redis from 'ioredis';
import { config } from '../config';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    // Fail fast rather than queueing requests behind a dead Redis: a hung
    // /api/price is worse than an honest 503.
    enableOfflineQueue: true,
    lazyConnect: false,
    connectTimeout: 5_000,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
  });
  client.on('error', (err: Error) => {
    // ioredis emits on every reconnect attempt; log without crashing the process.
    console.error('[redis] error:', err.message);
  });
  return client;
}

export async function closeRedis(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  try {
    await c.quit();
  } catch {
    c.disconnect();
  }
}

/** Redis key namespace, in one place so nothing collides. */
export const keys = {
  priceCurrent: 'price:current',
  priceLock: 'price:lock',
  quote: (sid: string, quoteId: string): string => `quote:${sid}:${quoteId}`,
  activeQuote: (sid: string): string => `quote:active:${sid}`,
  consumedQuote: (sid: string, quoteId: string): string => `quote:consumed:${sid}:${quoteId}`,
  demoSourceFailure: 'demo:source_failure',
  demoGuardrail: 'demo:guardrail_override',
  demoScenario: 'demo:scenario',
} as const;

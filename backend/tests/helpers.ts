import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { getPool } from '../src/db/pool';
import { ensureSeeded, writeBalances } from '../src/db/balances';
import { runMigrations } from '../src/db/migrate';
import { D, Decimal } from '../src/money';
import { getRedis } from '../src/redis/client';
import { PricingEngine, setPricingEngine } from '../src/pricing/engine';
import type { PriceSource, SourceName } from '../src/pricing/sources';

/**
 * A deterministic price source. Counts its own upstream calls so the stampede
 * test can assert "exactly once" without instrumenting the engine.
 */
export class FakeSource implements PriceSource {
  hits = 0;

  constructor(
    readonly name: SourceName,
    private behaviour: { value?: string; fail?: string; delayMs?: number } = {},
  ) {}

  set(behaviour: { value?: string; fail?: string; delayMs?: number }): void {
    this.behaviour = behaviour;
  }

  async fetchPkrPerGram24k(_signal: AbortSignal): Promise<Decimal> {
    this.hits += 1;
    if (this.behaviour.delayMs) {
      await new Promise((r) => setTimeout(r, this.behaviour.delayMs));
    }
    if (this.behaviour.fail !== undefined) {
      throw new Error(this.behaviour.fail);
    }
    if (this.behaviour.value === undefined) {
      throw new Error(`FakeSource ${this.name} has no configured behaviour`);
    }
    return D(this.behaviour.value);
  }
}

export interface FakeRig {
  primary: FakeSource;
  fallback: FakeSource;
  engine: PricingEngine;
}

/**
 * Install a pricing engine backed by fakes. Every integration test uses this so
 * no test ever touches the real network or depends on the live gold price.
 */
export function installFakePricing(opts: {
  primary?: { value?: string; fail?: string; delayMs?: number };
  fallback?: { value?: string; fail?: string; delayMs?: number };
  lockTtlMs?: number;
} = {}): FakeRig {
  const primary = new FakeSource('pakgold', opts.primary ?? { value: '40000' });
  const fallback = new FakeSource('goldprice', opts.fallback ?? { value: '39000' });
  const engine = new PricingEngine({
    sources: [primary, fallback],
    lockTtlMs: opts.lockTtlMs ?? 5_000,
  });
  setPricingEngine(engine);
  return { primary, fallback, engine };
}

/** The deterministic market reference used across the API tests. */
export const TEST_MARKET = '40000.00';
export const TEST_BUY = '44000.00'; // 40000 x 1.10
export const TEST_SELL = '36000.00'; // 40000 x 0.90

let migrated = false;

/** Truncate the ledger, reset balances to seed, and wipe the test Redis db. */
export async function resetWorld(): Promise<void> {
  if (!migrated) {
    await runMigrations();
    await ensureSeeded();
    migrated = true;
  }
  // TRUNCATE is permitted; UPDATE/DELETE on trades are blocked by the
  // append-only trigger, which is exactly the point.
  await getPool().query('TRUNCATE trades');
  await getPool().query('ALTER SEQUENCE trade_order_seq RESTART WITH 1');
  await writeBalances(undefined, {
    pkrWallet: D(config.seed.pkrWallet),
    customerGoldG: D(config.seed.customerGoldG),
    platformGoldG: D(config.seed.platformGoldG),
  });
  await getRedis().flushdb();
  setPricingEngine(null);
}

export function makeApp(): Express {
  return createApp({ serveStatic: false });
}

/** A supertest client that carries the asasa_sid cookie explicitly. */
export class Client {
  private cookie: string | null = null;

  constructor(private readonly app: Express) {}

  get sidCookie(): string | null {
    return this.cookie;
  }

  private capture(res: request.Response): request.Response {
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const raw of list) {
      const pair = raw.split(';')[0];
      if (pair && pair.startsWith(`${config.sessionCookieName}=`)) this.cookie = pair;
    }
    return res;
  }

  async get(path: string): Promise<request.Response> {
    const req = request(this.app).get(path);
    if (this.cookie) req.set('Cookie', this.cookie);
    return this.capture(await req);
  }

  async post(path: string, body: unknown = {}): Promise<request.Response> {
    const req = request(this.app).post(path).send(body as object);
    if (this.cookie) req.set('Cookie', this.cookie);
    return this.capture(await req);
  }

  /** Fire two requests genuinely in parallel on the same session. */
  async postConcurrent(path: string, body: unknown, times: number): Promise<request.Response[]> {
    const fire = (): Promise<request.Response> => {
      const req = request(this.app).post(path).send(body as object);
      if (this.cookie) req.set('Cookie', this.cookie);
      return req.then((r) => r);
    };
    return Promise.all(Array.from({ length: times }, fire));
  }
}

/** Establish a session before the interesting requests. */
export async function newClient(app: Express): Promise<Client> {
  const client = new Client(app);
  await client.get('/api/health');
  return client;
}

export async function currentBalances(): Promise<{ pkr: Decimal; customer: Decimal; platform: Decimal }> {
  const { rows } = await getPool().query<{
    pkr_wallet: string;
    customer_gold_g: string;
    platform_gold_g: string;
  }>('SELECT pkr_wallet, customer_gold_g, platform_gold_g FROM balances WHERE id = $1', ['demo']);
  const row = rows[0];
  if (!row) throw new Error('balances row missing');
  return {
    pkr: D(row.pkr_wallet),
    customer: D(row.customer_gold_g),
    platform: D(row.platform_gold_g),
  };
}

export async function tradeCount(): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>('SELECT count(*)::text AS n FROM trades');
  return Number.parseInt(rows[0]?.n ?? '0', 10);
}

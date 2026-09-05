import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { setPricingEngine } from '../src/pricing/engine';
import { SCENARIOS } from '../src/demo/state';
import {
  Client,
  currentBalances,
  installFakePricing,
  makeApp,
  newClient,
  resetWorld,
  tradeCount,
  TEST_BUY,
  TEST_MARKET,
  TEST_SELL,
} from './helpers';

let app: Express;
let client: Client;

beforeEach(async () => {
  await resetWorld();
  installFakePricing();
  app = makeApp();
  client = await newClient(app);
});

afterEach(() => {
  setPricingEngine(null);
});

describe('GET /api/price', () => {
  it('reports the market reference, both customer prices and freshness', async () => {
    const res = await client.get('/api/price');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      trading_enabled: true,
      freshness: 'LIVE',
      market_pkr_per_gram: TEST_MARKET,
      buy_pkr_per_gram: TEST_BUY,
      sell_pkr_per_gram: TEST_SELL,
      guardrail_pkr_per_gram: '30000.00',
      guardrail_applied: false,
      source: 'pakgold',
      paused_reason: null,
    });
    expect(typeof res.body.fetched_at).toBe('string');
    expect(res.body.age_seconds).toBeGreaterThanOrEqual(0);
    expect(res.body.ttl_seconds).toBeGreaterThan(0);
    expect(res.body.ttl_seconds).toBeLessThanOrEqual(config.priceTtlSeconds);
  });

  it('sends every money value as a string, never a JSON number', async () => {
    const res = await client.get('/api/price');
    for (const field of [
      'market_pkr_per_gram',
      'buy_pkr_per_gram',
      'sell_pkr_per_gram',
      'guardrail_pkr_per_gram',
    ]) {
      expect(typeof res.body[field]).toBe('string');
    }
    const state = await client.get('/api/state');
    for (const field of ['pkr_wallet', 'customer_gold_g', 'platform_gold_g']) {
      expect(typeof state.body.balances[field]).toBe('string');
    }
  });
});

describe('GET /api/state', () => {
  it('returns seeded balances, limits, an empty ledger and the active scenario', async () => {
    const res = await client.get('/api/state');
    expect(res.status).toBe(200);
    expect(res.body.balances).toMatchObject({
      pkr_wallet: '250000.00',
      customer_gold_g: '6.8420',
      platform_gold_g: '100.0000',
    });
    expect(res.body.limits).toEqual({
      min_pkr: '1000.00',
      max_pkr: '50000.00',
      gram_dp: 4,
      pkr_dp: 2,
    });
    expect(res.body.trades).toEqual([]);
    expect(res.body.scenario).toBe('normal');
  });

  it('lists trades most recent first, capped at 20', async () => {
    for (let i = 0; i < 3; i += 1) {
      const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '1000' });
      await client.post('/api/confirm', { quote_id: q.body.quote_id });
    }
    const res = await client.get('/api/state');
    expect(res.body.trades).toHaveLength(3);
    const ids: string[] = res.body.trades.map((t: { order_id: string }) => t.order_id);
    expect([...ids].sort().reverse()).toEqual(ids);
    expect(res.body.trades[0]).toMatchObject({ side: 'BUY', pkr_amount: '1000.00' });
  });
});

describe('session identity', () => {
  it('issues an httpOnly asasa_sid cookie on first contact', async () => {
    const fresh = new Client(app);
    const res = await fresh.get('/api/price');
    const setCookie = res.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    const cookie = list.find((c) => typeof c === 'string' && c.startsWith('asasa_sid='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('reuses the cookie on subsequent requests rather than reissuing', async () => {
    const first = client.sidCookie;
    await client.get('/api/state');
    expect(client.sidCookie).toBe(first);
  });
});

describe('demo control: source failure', () => {
  it('mode "primary" flips the live source to goldprice immediately', async () => {
    const rig = installFakePricing({
      primary: { value: '40000' },
      fallback: { value: '39000' },
    });

    const res = await client.post('/api/demo/source-failure', { mode: 'primary' });
    expect(res.status).toBe(200);
    expect(res.body.source_failure_mode).toBe('primary');
    expect(res.body.price.source).toBe('goldprice');
    expect(res.body.price.market_pkr_per_gram).toBe('39000.00');
    // The primary was never contacted.
    expect(rig.primary.hits).toBe(0);

    const price = await client.get('/api/price');
    expect(price.body.source).toBe('goldprice');
    expect(price.body.trading_enabled).toBe(true);
  });

  it('mode "both" pauses trading and both quote and confirm refuse', async () => {
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    expect(q.status).toBe(200);

    const res = await client.post('/api/demo/source-failure', { mode: 'both' });
    expect(res.body.price.freshness).toBe('UNAVAILABLE');
    expect(res.body.price.trading_enabled).toBe(false);
    expect(res.body.price.market_pkr_per_gram).toBeNull();
    expect(res.body.price.paused_reason).toMatch(/paused/i);

    const price = await client.get('/api/price');
    expect(price.body.freshness).toBe('UNAVAILABLE');

    const newQuote = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    expect(newQuote.status).toBe(409);
    expect(newQuote.body.error.code).toBe('TRADING_PAUSED');

    const confirm = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('TRADING_PAUSED');
    expect(await tradeCount()).toBe(0);
  });

  it('mode "none" restores the primary', async () => {
    await client.post('/api/demo/source-failure', { mode: 'both' });
    const res = await client.post('/api/demo/source-failure', { mode: 'none' });
    expect(res.body.price.trading_enabled).toBe(true);
    expect(res.body.price.source).toBe('pakgold');
    expect((await client.get('/api/price')).body.source).toBe('pakgold');
  });

  it('rejects an unknown mode', async () => {
    const res = await client.post('/api/demo/source-failure', { mode: 'sideways' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });
});

describe('demo control: guardrail', () => {
  it('raising the floor binds the buy price and flags it everywhere', async () => {
    const res = await client.post('/api/demo/guardrail', { pkr_per_gram: '60000' });
    expect(res.status).toBe(200);
    expect(res.body.guardrail_override).toBe('60000.00');
    expect(res.body.price.guardrail_applied).toBe(true);
    expect(res.body.price.buy_pkr_per_gram).toBe('60000.00');
    // The sell side is untouched: the guardrail only protects the buy price.
    expect(res.body.price.sell_pkr_per_gram).toBe(TEST_SELL);

    const price = await client.get('/api/price');
    expect(price.body.guardrail_applied).toBe(true);
    expect(price.body.guardrail_pkr_per_gram).toBe('60000.00');

    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '6000' });
    expect(q.body.locked_price_pkr_per_gram).toBe('60000.00');
    expect(q.body.guardrail_applied).toBe(true);
    expect(q.body.grams).toBe('0.1000'); // 6,000 / 60,000

    const confirm = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(confirm.body.receipt.guardrail_applied).toBe(true);
    expect(confirm.body.receipt.locked_price_pkr_per_gram).toBe('60000.00');

    const state = await client.get('/api/state');
    expect(state.body.trades[0].guardrail_applied).toBe(true);
  });

  it('a floor below the marked-up price stays dormant', async () => {
    const res = await client.post('/api/demo/guardrail', { pkr_per_gram: '43000' });
    expect(res.body.price.guardrail_applied).toBe(false);
    expect(res.body.price.buy_pkr_per_gram).toBe(TEST_BUY);
  });

  it('reset restores the env default', async () => {
    await client.post('/api/demo/guardrail', { pkr_per_gram: '60000' });
    const res = await client.post('/api/demo/guardrail', { reset: true });
    expect(res.body.guardrail_override).toBeNull();
    expect(res.body.price.guardrail_applied).toBe(false);
    expect(res.body.price.guardrail_pkr_per_gram).toBe('30000.00');
    expect(res.body.price.buy_pkr_per_gram).toBe(TEST_BUY);
  });

  it('rejects a nonsense floor', async () => {
    for (const body of [{ pkr_per_gram: '-1' }, { pkr_per_gram: 'lots' }, {}]) {
      const res = await client.post('/api/demo/guardrail', body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REQUEST');
    }
  });
});

describe('demo control: scenarios', () => {
  it.each(['normal', 'low_cash', 'low_gold', 'low_inventory'] as const)(
    're-seeds balances for the %s scenario',
    async (scenario) => {
      const res = await client.post('/api/demo/scenario', { scenario });
      expect(res.status).toBe(200);
      expect(res.body.scenario).toBe(scenario);

      const preset = SCENARIOS[scenario];
      expect(res.body.balances).toMatchObject({
        pkr_wallet: preset.pkrWallet,
        customer_gold_g: preset.customerGoldG,
        platform_gold_g: preset.platformGoldG,
      });

      const balances = await currentBalances();
      expect(balances.pkr.toFixed(2)).toBe(preset.pkrWallet);
      expect(balances.customer.toFixed(4)).toBe(preset.customerGoldG);
      expect(balances.platform.toFixed(4)).toBe(preset.platformGoldG);

      expect((await client.get('/api/state')).body.scenario).toBe(scenario);
    },
  );

  it('does not touch the append-only ledger', async () => {
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(await tradeCount()).toBe(1);

    const res = await client.post('/api/demo/scenario', { scenario: 'low_cash' });
    expect(res.body.note).toMatch(/append-only/i);
    expect(await tradeCount()).toBe(1);
    expect((await client.get('/api/state')).body.trades).toHaveLength(1);
  });

  it('invalidates a quote issued against the old balances', async () => {
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const res = await client.post('/api/demo/scenario', { scenario: 'low_cash' });
    expect(res.body.cleared_quotes).toBeGreaterThan(0);

    const confirm = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(confirm.status).toBe(404);
    expect(confirm.body.error.code).toBe('QUOTE_NOT_FOUND');
    expect(await tradeCount()).toBe(0);
  });

  it('rejects an unknown scenario', async () => {
    const res = await client.post('/api/demo/scenario', { scenario: 'apocalypse' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });
});

describe('GET /api/demo/status', () => {
  it('reports the toggles currently in force', async () => {
    const initial = await client.get('/api/demo/status');
    expect(initial.body).toMatchObject({
      source_failure_mode: 'none',
      guardrail_override: null,
      scenario: 'normal',
      guardrail_in_force: '30000.00',
    });
    expect(Object.keys(initial.body.scenarios)).toEqual([
      'normal',
      'low_cash',
      'low_gold',
      'low_inventory',
    ]);

    await client.post('/api/demo/source-failure', { mode: 'primary' });
    await client.post('/api/demo/guardrail', { pkr_per_gram: '55000' });
    await client.post('/api/demo/scenario', { scenario: 'low_gold' });

    const res = await client.get('/api/demo/status');
    expect(res.body).toMatchObject({
      source_failure_mode: 'primary',
      guardrail_override: '55000.00',
      scenario: 'low_gold',
      guardrail_in_force: '55000.00',
    });
  });
});

describe('plumbing', () => {
  it('GET /api/health reports both dependencies', async () => {
    const res = await client.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' });
  });

  it('answers an unknown API route with a JSON 404, not an HTML page', async () => {
    const res = await client.get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers malformed JSON with INVALID_REQUEST', async () => {
    const request = (await import('supertest')).default;
    const res = await request(app)
      .post('/api/quote')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('always wraps errors in the { error: { code, message, details } } envelope', async () => {
    const res = await client.post('/api/quote', { side: 'BUY', pkr_amount: '1' });
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(Object.keys(res.body.error).sort()).toEqual(['code', 'details', 'message']);
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.message.length).toBeGreaterThan(10);
  });
});

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { D } from '../src/money';
import { deriveAmounts } from '../src/quotes/service';
import { setPricingEngine } from '../src/pricing/engine';
import { getRedis, keys } from '../src/redis/client';
import {
  Client,
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

describe('amount derivation and rounding direction', () => {
  it('BUY by PKR rounds the grams delivered DOWN', () => {
    // 5,000 / 44,000 = 0.113636... -> 0.1136 (customer receives less gold)
    const r = deriveAmounts('BUY', 'PKR', D('5000'), D('44000'));
    expect(r.pkr.toFixed(2)).toBe('5000.00');
    expect(r.grams.toFixed(4)).toBe('0.1136');
    expect(r.roundingNote).toMatch(/rounded down/i);
    // The gold handed over is worth no more than the cash taken.
    expect(r.grams.times(D('44000')).lte(r.pkr)).toBe(true);
  });

  it('BUY by grams rounds the PKR charged UP', () => {
    // 0.1137 x 44,000 = 5,002.80 exactly; use a value that needs rounding.
    const r = deriveAmounts('BUY', 'GRAMS', D('0.11365'), D('44000'));
    expect(r.grams.toFixed(4)).toBe('0.1136'); // input normalised down to 4 dp
    expect(r.pkr.toFixed(2)).toBe('4998.40');
    const exact = D('0.1136').times(D('44000'));
    expect(r.pkr.gte(exact)).toBe(true);
    expect(r.roundingNote).toMatch(/rounded up/i);
  });

  it('SELL by grams rounds the PKR paid out DOWN', () => {
    // 0.1234 x 36,000 = 4,442.40; use a price that produces a fraction.
    const r = deriveAmounts('SELL', 'GRAMS', D('0.1234'), D('35999.99'));
    expect(r.grams.toFixed(4)).toBe('0.1234');
    // 0.1234 x 35,999.99 = 4,442.398766 -> 4,442.39
    expect(r.pkr.toFixed(2)).toBe('4442.39');
    expect(r.pkr.lte(D('0.1234').times(D('35999.99')))).toBe(true);
    expect(r.roundingNote).toMatch(/rounded down/i);
  });

  it('SELL by PKR rounds the grams debited UP', () => {
    // 5,000 / 36,000 = 0.138888... -> 0.1389 (customer gives more gold)
    const r = deriveAmounts('SELL', 'PKR', D('5000'), D('36000'));
    expect(r.pkr.toFixed(2)).toBe('5000.00');
    expect(r.grams.toFixed(4)).toBe('0.1389');
    expect(r.grams.times(D('36000')).gte(r.pkr)).toBe(true);
    expect(r.roundingNote).toMatch(/rounded up/i);
  });

  it('never rounds in the customer favour on either side', () => {
    for (const pkr of ['1000', '1234.56', '4999.99', '50000']) {
      const buy = deriveAmounts('BUY', 'PKR', D(pkr), D('44000'));
      expect(buy.grams.times(D('44000')).lte(buy.pkr)).toBe(true);

      const sell = deriveAmounts('SELL', 'PKR', D(pkr), D('36000'));
      expect(sell.grams.times(D('36000')).gte(sell.pkr)).toBe(true);
    }
  });
});

describe('POST /api/quote', () => {
  it('issues a 75-second locked quote from a PKR amount', async () => {
    const res = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    expect(res.status).toBe(200);

    expect(res.body.side).toBe('BUY');
    expect(res.body.pkr_amount).toBe('5000.00');
    expect(res.body.grams).toBe('0.1136');
    expect(res.body.locked_price_pkr_per_gram).toBe(TEST_BUY);
    expect(res.body.market_reference).toBe(TEST_MARKET);
    expect(res.body.source).toBe('pakgold');
    expect(res.body.guardrail_applied).toBe(false);
    expect(res.body.ttl_seconds).toBeGreaterThan(70);
    expect(res.body.ttl_seconds).toBeLessThanOrEqual(75);

    const lifetimeMs = Date.parse(res.body.expires_at) - Date.parse(res.body.issued_at);
    expect(lifetimeMs).toBe(config.quoteTtlSeconds * 1000);

    expect(res.body.balances_after).toEqual({
      pkr_wallet: '245000.00',
      customer_gold_g: '6.9556',
      platform_gold_g: '99.8864',
    });
  });

  it('issues a quote from a gram amount on the sell side', async () => {
    const res = await client.post('/api/quote', { side: 'SELL', grams: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body.grams).toBe('0.5000');
    expect(res.body.pkr_amount).toBe('18000.00'); // 0.5 x 36,000
    expect(res.body.locked_price_pkr_per_gram).toBe(TEST_SELL);
    expect(res.body.balances_after).toEqual({
      pkr_wallet: '268000.00',
      customer_gold_g: '6.3420',
      platform_gold_g: '100.5000',
    });
  });

  it('stores the quote in Redis with expires_at inside the payload', async () => {
    const res = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const sid = client.sidCookie?.split('=')[1] ?? '';
    const raw = await getRedis().get(keys.quote(sid, res.body.quote_id));
    expect(raw).not.toBeNull();

    const stored = JSON.parse(raw ?? '{}');
    expect(stored.expires_at).toBe(res.body.expires_at);
    expect(stored.locked_price_pkr_per_gram).toBe(TEST_BUY);
    expect(stored.sid).toBe(sid);

    // The key deliberately outlives the quote so a late confirm can be told
    // "expired" rather than "never existed".
    const ttl = await getRedis().ttl(keys.quote(sid, res.body.quote_id));
    expect(ttl).toBeGreaterThan(config.quoteTtlSeconds);
  });

  it('keeps only one active quote per session', async () => {
    const first = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const second = await client.post('/api/quote', { side: 'BUY', pkr_amount: '6000' });
    expect(second.status).toBe(200);

    const sid = client.sidCookie?.split('=')[1] ?? '';
    expect(await getRedis().get(keys.quote(sid, first.body.quote_id))).toBeNull();
    expect(await getRedis().get(keys.quote(sid, second.body.quote_id))).not.toBeNull();

    // The superseded quote is no longer settleable.
    const confirm = await client.post('/api/confirm', { quote_id: first.body.quote_id });
    expect(confirm.status).toBe(404);
    expect(confirm.body.error.code).toBe('QUOTE_NOT_FOUND');
  });

  it('does not let one session settle another session quote', async () => {
    const res = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const stranger = await newClient(app);
    expect(stranger.sidCookie).not.toBe(client.sidCookie);

    const confirm = await stranger.post('/api/confirm', { quote_id: res.body.quote_id });
    expect(confirm.status).toBe(404);
    expect(confirm.body.error.code).toBe('QUOTE_NOT_FOUND');
    expect(await tradeCount()).toBe(0);
  });
});

describe('POST /api/quote validation', () => {
  it('rejects an amount below the minimum with the limit in details', async () => {
    const res = await client.post('/api/quote', { side: 'BUY', pkr_amount: '999.99' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AMOUNT_BELOW_MINIMUM');
    expect(res.body.error.details.min_pkr).toBe('1000.00');
  });

  it('rejects an amount above the maximum with the limit in details', async () => {
    const res = await client.post('/api/quote', { side: 'BUY', pkr_amount: '50000.01' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(res.body.error.details.max_pkr).toBe('50000.00');
  });

  it('applies the limits to the derived PKR leg of a gram-denominated trade', async () => {
    // 2 g x 36,000 = 72,000 -> above the 50,000 ceiling.
    const res = await client.post('/api/quote', { side: 'SELL', grams: '2' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AMOUNT_ABOVE_MAXIMUM');
  });

  it.each([
    ['both amounts', { side: 'BUY', pkr_amount: '5000', grams: '0.1' }],
    ['neither amount', { side: 'BUY' }],
    ['a bad side', { side: 'HODL', pkr_amount: '5000' }],
    ['a negative amount', { side: 'BUY', pkr_amount: '-5000' }],
    ['a non-numeric amount', { side: 'BUY', pkr_amount: 'five thousand' }],
    ['an exponential literal', { side: 'BUY', pkr_amount: '5e3' }],
    ['zero', { side: 'BUY', pkr_amount: '0' }],
  ])('rejects %s with INVALID_REQUEST', async (_label, body) => {
    const res = await client.post('/api/quote', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });
});

describe('quote expiry is decided by the stored timestamp', () => {
  it('returns 410 QUOTE_EXPIRED and writes no trade when expires_at has passed', async () => {
    const quote = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const sid = client.sidCookie?.split('=')[1] ?? '';
    const key = keys.quote(sid, quote.body.quote_id);

    // Backdate the stored quote. The key is still present with a healthy TTL,
    // so only the payload timestamp can produce the right answer here.
    const stored = JSON.parse((await getRedis().get(key)) ?? '{}');
    stored.expires_at = new Date(Date.now() - 1_000).toISOString();
    await getRedis().set(key, JSON.stringify(stored), 'KEEPTTL');
    expect(await getRedis().ttl(key)).toBeGreaterThan(60);

    const res = await client.post('/api/confirm', { quote_id: quote.body.quote_id });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('QUOTE_EXPIRED');
    expect(await tradeCount()).toBe(0);
  });

  it('returns 404 QUOTE_NOT_FOUND for an id that never existed', async () => {
    const res = await client.post('/api/confirm', {
      quote_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUOTE_NOT_FOUND');
    expect(await tradeCount()).toBe(0);
  });

  it('distinguishes expired from not-found in both status and code', async () => {
    const quote = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const sid = client.sidCookie?.split('=')[1] ?? '';
    const key = keys.quote(sid, quote.body.quote_id);
    const stored = JSON.parse((await getRedis().get(key)) ?? '{}');
    stored.expires_at = new Date(Date.now() - 1).toISOString();
    await getRedis().set(key, JSON.stringify(stored), 'KEEPTTL');

    const expired = await client.post('/api/confirm', { quote_id: quote.body.quote_id });
    const missing = await client.post('/api/confirm', { quote_id: 'no-such-quote' });

    expect([expired.status, expired.body.error.code]).toEqual([410, 'QUOTE_EXPIRED']);
    expect([missing.status, missing.body.error.code]).toEqual([404, 'QUOTE_NOT_FOUND']);
    expect(expired.body.error.message).not.toBe(missing.body.error.message);
  });

  it('accepts a quote that is still inside its window', async () => {
    const quote = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const res = await client.post('/api/confirm', { quote_id: quote.body.quote_id });
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(false);
  });
});

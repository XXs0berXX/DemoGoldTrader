import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D, fmtPkr } from '../src/money';
import { derivePricing, isLive, PricingEngine } from '../src/pricing/engine';
import { setPricingEngine } from '../src/pricing/engine';
import { getRedis, keys } from '../src/redis/client';
import { FakeSource, resetWorld } from './helpers';

beforeEach(async () => {
  await resetWorld();
});

afterEach(() => {
  setPricingEngine(null);
});

afterAll(() => {
  setPricingEngine(null);
});

describe('spread and guardrail', () => {
  const guardrail = D('30000');

  it('applies +10% on the buy side and -10% on the sell side', () => {
    const p = derivePricing(D('40000'), guardrail);
    expect(fmtPkr(p.market)).toBe('40000.00');
    expect(fmtPkr(p.buy)).toBe('44000.00');
    expect(fmtPkr(p.sell)).toBe('36000.00');
    expect(p.guardrailApplied).toBe(false);
  });

  it('reproduces the worked example in the contract', () => {
    // market 39,547.38 -> buy 43,502.118 (up) -> 43,502.12
    //                  -> sell 35,592.642 (down) -> 35,592.64
    const p = derivePricing(D('39547.38'), guardrail);
    expect(fmtPkr(p.buy)).toBe('43502.12');
    expect(fmtPkr(p.sell)).toBe('35592.64');
    expect(p.guardrailApplied).toBe(false);
  });

  it('rounds the buy price up and the sell price down — both in the platform favour', () => {
    // 12,345.67 x 1.10 = 13,580.237 -> up   -> 13,580.24
    // 12,345.67 x 0.90 = 11,111.103 -> down -> 11,111.10
    const p = derivePricing(D('12345.67'), D('1'));
    expect(fmtPkr(p.buy)).toBe('13580.24');
    expect(fmtPkr(p.sell)).toBe('11111.10');
  });

  it('does NOT flag the guardrail when the floor sits below the marked-up price', () => {
    // 40,000 x 1.10 = 44,000 which is above the 43,999 floor.
    const p = derivePricing(D('40000'), D('43999'));
    expect(p.guardrailApplied).toBe(false);
    expect(fmtPkr(p.buy)).toBe('44000.00');
  });

  it('binds the buy price to the guardrail floor when the floor is higher', () => {
    const p = derivePricing(D('40000'), D('60000'));
    expect(p.guardrailApplied).toBe(true);
    expect(fmtPkr(p.buy)).toBe('60000.00');
    // The sell side is never floored — only the buy price is protected.
    expect(fmtPkr(p.sell)).toBe('36000.00');
  });

  it('treats an exactly-equal floor as not binding', () => {
    const p = derivePricing(D('40000'), D('44000'));
    expect(p.guardrailApplied).toBe(false);
    expect(fmtPkr(p.buy)).toBe('44000.00');
  });
});

describe('source fallback chain', () => {
  it('uses the primary when it answers with a trustworthy value', async () => {
    const primary = new FakeSource('pakgold', { value: '39547.38' });
    const fallback = new FakeSource('goldprice', { value: '39538.75' });
    const engine = new PricingEngine({ sources: [primary, fallback] });

    const state = await engine.getPrice();
    expect(isLive(state)).toBe(true);
    if (!isLive(state)) throw new Error('unreachable');
    expect(state.source).toBe('pakgold');
    expect(fmtPkr(state.market)).toBe('39547.38');
    expect(primary.hits).toBe(1);
    expect(fallback.hits).toBe(0);
  });

  it('falls through to goldprice when the primary throws', async () => {
    const primary = new FakeSource('pakgold', { fail: 'gold-api returned HTTP 503' });
    const fallback = new FakeSource('goldprice', { value: '39538.75' });
    const engine = new PricingEngine({ sources: [primary, fallback] });

    const state = await engine.getPrice();
    if (!isLive(state)) throw new Error('expected LIVE, got UNAVAILABLE');
    expect(state.source).toBe('goldprice');
    expect(fmtPkr(state.market)).toBe('39538.75');
    expect(primary.hits).toBe(1);
    expect(fallback.hits).toBe(1);
  });

  it('reports UNAVAILABLE — never a stale price — when both fail and the cache is empty', async () => {
    const primary = new FakeSource('pakgold', { fail: 'timeout' });
    const fallback = new FakeSource('goldprice', { fail: 'Forbidden' });
    const engine = new PricingEngine({ sources: [primary, fallback] });

    const state = await engine.getPrice();
    expect(state.freshness).toBe('UNAVAILABLE');
    if (isLive(state)) throw new Error('unreachable');
    expect(state.reason).toMatch(/unreachable/i);
    expect(await getRedis().get(keys.priceCurrent)).toBeNull();
  });

  it('keeps serving the cached price when a later refresh would fail', async () => {
    const primary = new FakeSource('pakgold', { value: '40000' });
    const engine = new PricingEngine({ sources: [primary], ttlSeconds: 300 });

    const first = await engine.getPrice();
    expect(first.freshness).toBe('LIVE');

    primary.set({ fail: 'now down' });
    const second = await engine.getPrice();
    // Inside the 300s window we serve the cache and never touch upstream again.
    expect(second.freshness).toBe('LIVE');
    expect(primary.hits).toBe(1);
  });
});

describe('sanity band', () => {
  it('discards an implausibly low primary value and falls through to the fallback', async () => {
    // 1 PKR/g is below PRICE_SANITY_MIN (5,000): a source that answers with
    // nonsense is treated exactly like one that is down.
    const primary = new FakeSource('pakgold', { value: '1' });
    const fallback = new FakeSource('goldprice', { value: '39538.75' });
    const engine = new PricingEngine({ sources: [primary, fallback] });

    const state = await engine.getPrice();
    if (!isLive(state)) throw new Error('expected LIVE, got UNAVAILABLE');
    expect(state.source).toBe('goldprice');
    expect(fmtPkr(state.market)).toBe('39538.75');
    expect(primary.hits).toBe(1);
  });

  it('discards an implausibly high primary value too', async () => {
    const primary = new FakeSource('pakgold', { value: '9999999' });
    const fallback = new FakeSource('goldprice', { value: '39538.75' });
    const engine = new PricingEngine({ sources: [primary, fallback] });

    const state = await engine.getPrice();
    if (!isLive(state)) throw new Error('expected LIVE, got UNAVAILABLE');
    expect(state.source).toBe('goldprice');
  });

  it('pauses trading when every source is out of band', async () => {
    const primary = new FakeSource('pakgold', { value: '0.5' });
    const fallback = new FakeSource('goldprice', { value: '4000000' });
    const engine = new PricingEngine({ sources: [primary, fallback] });

    expect((await engine.getPrice()).freshness).toBe('UNAVAILABLE');
  });

  it('refuses to serve a cached value that has become implausible', async () => {
    const primary = new FakeSource('pakgold', { fail: 'down' });
    const engine = new PricingEngine({ sources: [primary] });
    // Hand-poison the cache the way a bad deploy or a bad actor might.
    await getRedis().set(
      keys.priceCurrent,
      JSON.stringify({ pkr_per_gram: '3.00', source: 'pakgold', fetched_at: new Date().toISOString() }),
      'EX',
      300,
    );

    expect((await engine.getPrice()).freshness).toBe('UNAVAILABLE');
  });
});

describe('cache stampede', () => {
  it('hits upstream exactly once for ~50 concurrent callers', async () => {
    const primary = new FakeSource('pakgold', { value: '40000', delayMs: 40 });
    const fallback = new FakeSource('goldprice', { value: '39000' });
    const engine = new PricingEngine({ sources: [primary, fallback], lockTtlMs: 5_000 });

    const results = await Promise.all(Array.from({ length: 50 }, () => engine.getPrice()));

    expect(primary.hits).toBe(1);
    expect(fallback.hits).toBe(0);
    expect(results).toHaveLength(50);
    for (const state of results) {
      expect(state.freshness).toBe('LIVE');
      if (!isLive(state)) throw new Error('unreachable');
      expect(fmtPkr(state.market)).toBe('40000.00');
      expect(state.source).toBe('pakgold');
    }
  });

  it('does not launch a second stampede when the single flight fails', async () => {
    const primary = new FakeSource('pakgold', { fail: 'down', delayMs: 30 });
    const fallback = new FakeSource('goldprice', { fail: 'down', delayMs: 30 });
    const engine = new PricingEngine({ sources: [primary, fallback], lockTtlMs: 5_000 });

    const results = await Promise.all(Array.from({ length: 25 }, () => engine.getPrice()));

    // One caller wins the lock and tries both sources. The other 24 wait and
    // then report unavailable rather than each hammering a source we know is down.
    expect(primary.hits).toBe(1);
    expect(fallback.hits).toBe(1);
    for (const state of results) expect(state.freshness).toBe('UNAVAILABLE');
  });

  it('releases the single-flight lock after a refresh', async () => {
    const primary = new FakeSource('pakgold', { value: '40000' });
    const engine = new PricingEngine({ sources: [primary] });
    await engine.getPrice();
    expect(await getRedis().exists(keys.priceLock)).toBe(0);
  });
});

describe('demo failure injection reaches the engine', () => {
  it('mode "primary" skips pakgold without calling it', async () => {
    const primary = new FakeSource('pakgold', { value: '40000' });
    const fallback = new FakeSource('goldprice', { value: '39000' });
    const engine = new PricingEngine({
      sources: [primary, fallback],
      failureMode: async () => 'primary',
    });

    const state = await engine.getPrice();
    if (!isLive(state)) throw new Error('expected LIVE');
    expect(state.source).toBe('goldprice');
    expect(primary.hits).toBe(0);
  });

  it('mode "both" pauses trading without calling anything', async () => {
    const primary = new FakeSource('pakgold', { value: '40000' });
    const fallback = new FakeSource('goldprice', { value: '39000' });
    const engine = new PricingEngine({
      sources: [primary, fallback],
      failureMode: async () => 'both',
    });

    const state = await engine.getPrice();
    expect(state.freshness).toBe('UNAVAILABLE');
    expect(primary.hits).toBe(0);
    expect(fallback.hits).toBe(0);
  });
});

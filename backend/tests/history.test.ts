import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHistoryCache,
  downsample,
  getHistory,
  isHistoryRange,
  summarise,
  type HistoryPoint,
} from '../src/pricing/history';
import { setPricingEngine } from '../src/pricing/engine';
import { setSourceFailureMode } from '../src/demo/state';
import { D, TROY_OUNCE_GRAMS } from '../src/money';
import { Client, installFakePricing, makeApp, newClient, resetWorld } from './helpers';

/**
 * Rate history.
 *
 * GoldPrice.org is the only upstream that publishes history — gold-api.com
 * gates it behind a key (401). Two payload shapes, both PKR per troy ounce:
 *   GetDataHistorical/PKR-XAU/0  "PKR-XAU!,<ts>,<v>,…"  ts x 100 = unix seconds
 *   GetData/PKR-XAU/0            "PKR-XAU,<v>,<v>,…"    undated, values repeat
 */

const OZ = TROY_OUNCE_GRAMS;

/** A daily payload: `days` closes ending `endSec`, one day apart. */
function dailyPayload(values: number[], endSec: number): string {
  const parts: string[] = [];
  values.forEach((v, i) => {
    const sec = endSec - (values.length - 1 - i) * 86_400;
    parts.push(String(Math.round(sec / 100)), String(v));
  });
  return JSON.stringify([`PKR-XAU!,${parts.join(',')}`]);
}

/** An intraday payload; each value repeated `repeat` times, as upstream does. */
function intradayPayload(values: number[], repeat = 6): string {
  const out: string[] = [];
  for (const v of values) for (let i = 0; i < repeat; i += 1) out.push(String(v));
  return JSON.stringify([`PKR-XAU,${out.join(',')}`]);
}

function stubFetch(handler: (url: string) => { ok: boolean; body: string }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const r = handler(url);
      return {
        ok: r.ok,
        status: r.ok ? 200 : 503,
        json: async () => JSON.parse(r.body) as unknown,
      } as unknown as Response;
    }),
  );
}

let app: Express;
let client: Client;

beforeEach(async () => {
  await resetWorld();
  await clearHistoryCache();
  installFakePricing();
  app = makeApp();
  client = await newClient(app);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await clearHistoryCache();
  await setSourceFailureMode('none');
  setPricingEngine(null);
});

describe('payload parsing and normalisation', () => {
  it('converts daily PKR/troy-ounce closes to PKR/gram and decodes the x100 timestamps', async () => {
    const endSec = Math.floor(Date.now() / 1000);
    const closes = [1_200_000, 1_210_000, 1_220_000, 1_230_000, 1_240_000];
    stubFetch((url) => ({
      ok: true,
      body: url.includes('GetDataHistorical') ? dailyPayload(closes, endSec) : intradayPayload([1]),
    }));

    const s = await getHistory('1M');
    expect(s.unavailable).toBe(false);
    expect(s.points.length).toBe(closes.length);

    // Values are the published ounce prices divided by 31.1034768 — nothing else.
    const expectedLast = D(closes[closes.length - 1] as number).dividedBy(OZ);
    expect(s.close).toBe(expectedLast.toFixed(2));
    expect(s.open).toBe(D(closes[0] as number).dividedBy(OZ).toFixed(2));

    // Daily points carry real timestamps, one day apart.
    const t0 = Date.parse(s.points[0]!.t);
    const t1 = Date.parse(s.points[1]!.t);
    expect(t1 - t0).toBe(86_400_000);
    expect(s.approximate_timestamps).toBe(false);
  });

  it('collapses the intraday padding so repeated values do not distort the series', async () => {
    // Six distinct observations, each published six times.
    const distinct = [1_200_000, 1_205_000, 1_210_000, 1_215_000, 1_220_000, 1_225_000];
    stubFetch((url) => ({
      ok: true,
      body: url.includes('GetDataHistorical') ? dailyPayload([1_200_000, 1_200_001], 0) : intradayPayload(distinct, 6),
    }));

    const s = await getHistory('1W');
    expect(s.points.length).toBe(distinct.length);
    expect(s.close).toBe(D(1_225_000).dividedBy(OZ).toFixed(2));
    // Undated upstream, so the x-axis is flagged as approximate.
    expect(s.approximate_timestamps).toBe(true);
  });

  it('marks 1D timestamps as spanning the last day, newest last', async () => {
    const distinct = Array.from({ length: 60 }, (_, i) => 1_200_000 + i * 100);
    stubFetch((url) => ({
      ok: true,
      body: url.includes('GetDataHistorical') ? dailyPayload([1, 2], 0) : intradayPayload(distinct, 6),
    }));

    const s = await getHistory('1D');
    expect(s.unavailable).toBe(false);
    const times = s.points.map((p) => Date.parse(p.t));
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    }
    const spanMs = times[times.length - 1]! - times[0]!;
    expect(spanMs).toBeLessThanOrEqual(86_400_000);
    expect(spanMs).toBeGreaterThan(0);
  });
});

describe('downsampling', () => {
  it('always keeps the first and last observation', () => {
    const items = Array.from({ length: 5000 }, (_, i) => i);
    const out = downsample(items, 72);
    expect(out.length).toBe(72);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(4999);
  });

  it('returns the input untouched when it is already small enough', () => {
    expect(downsample([1, 2, 3], 72)).toEqual([1, 2, 3]);
  });

  it('never drops the extremes, so the high/low stay truthful', () => {
    const items = Array.from({ length: 1000 }, (_, i) => (i === 0 ? 999 : i === 999 ? -999 : 0));
    const out = downsample(items, 50);
    expect(out[0]).toBe(999);
    expect(out[out.length - 1]).toBe(-999);
  });
});

describe('series summary', () => {
  const pts = (vals: number[]): HistoryPoint[] =>
    vals.map((v, i) => ({ t: new Date(1_700_000_000_000 + i * 60_000).toISOString(), v: v.toFixed(2) }));

  it('reports open, close, high, low and the percentage change', () => {
    const s = summarise('1M', pts([100, 140, 80, 120]), false);
    expect(s.open).toBe('100.00');
    expect(s.close).toBe('120.00');
    expect(s.high).toBe('140.00');
    expect(s.low).toBe('80.00');
    expect(s.change_pct).toBe('20.00');
  });

  it('reports a negative change when the range fell', () => {
    const s = summarise('1D', pts([200, 150]), true);
    expect(s.change_pct).toBe('-25.00');
    expect(s.approximate_timestamps).toBe(true);
  });

  it('flags an empty series as unavailable rather than inventing a flat line', () => {
    const s = summarise('1Y', [], false);
    expect(s.unavailable).toBe(true);
    expect(s.points).toEqual([]);
    expect(s.close).toBeNull();
  });
});

describe('degradation', () => {
  it('reports unavailable — not a fake series — when upstream fails', async () => {
    stubFetch(() => ({ ok: false, body: '[]' }));
    const s = await getHistory('1Y');
    expect(s.unavailable).toBe(true);
    expect(s.points).toEqual([]);
    expect(s.reason).toMatch(/unavailable/i);
  });

  it('hides history when the demo control forces both sources down', async () => {
    stubFetch((url) => ({
      ok: true,
      body: url.includes('GetDataHistorical') ? dailyPayload([1_200_000, 1_210_000], 0) : intradayPayload([1_200_000]),
    }));
    await setSourceFailureMode('both');
    const s = await getHistory('1M');
    expect(s.unavailable).toBe(true);
    expect(s.reason).toMatch(/unavailable/i);
  });

  it('a broken chart never blocks trading', async () => {
    stubFetch(() => ({ ok: false, body: '[]' }));
    const hist = await client.get('/api/price/history?range=1M');
    expect(hist.body.unavailable).toBe(true);

    // The live price comes from the pricing engine, not from history.
    vi.unstubAllGlobals();
    const quote = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    expect(quote.status).toBe(200);
  });
});

describe('the HTTP surface', () => {
  beforeEach(() => {
    stubFetch((url) => ({
      ok: true,
      body: url.includes('GetDataHistorical')
        ? dailyPayload([1_200_000, 1_210_000, 1_220_000], Math.floor(Date.now() / 1000))
        : intradayPayload([1_200_000, 1_210_000, 1_220_000]),
    }));
  });

  it.each(['1D', '1W', '1M', '1Y'])('serves %s', async (range) => {
    const res = await client.get(`/api/price/history?range=${range}`);
    expect(res.status).toBe(200);
    expect(res.body.range).toBe(range);
    expect(res.body.points.length).toBeGreaterThan(0);
    expect(res.body.source).toBe('goldprice');
  });

  it('defaults to 1M when no range is given', async () => {
    const res = await client.get('/api/price/history');
    expect(res.status).toBe(200);
    expect(res.body.range).toBe('1M');
  });

  it('rejects an unknown range rather than silently substituting one', async () => {
    const res = await client.get('/api/price/history?range=10Y');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('is never cached at the edge — freshness is the product', async () => {
    const res = await client.get('/api/price/history?range=1M');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('accepts only the four documented ranges', () => {
    expect(isHistoryRange('1D')).toBe(true);
    expect(isHistoryRange('1Y')).toBe(true);
    expect(isHistoryRange('5Y')).toBe(false);
    expect(isHistoryRange(null)).toBe(false);
  });
});

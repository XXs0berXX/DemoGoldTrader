import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPool, PG_CHECK_VIOLATION } from '../src/db/pool';
import { D } from '../src/money';
import { setPricingEngine } from '../src/pricing/engine';
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

/**
 * The quote fields these tests read. Declared as named properties rather than
 * an index signature so `noUncheckedIndexedAccess` does not widen every read
 * to `string | undefined`.
 */
interface QuoteBody {
  quote_id: string;
  side: string;
  grams: string;
  pkr_amount: string;
  locked_price_pkr_per_gram: string;
  market_reference: string;
  guardrail_applied: boolean;
}

type TradeInput = { side: string; pkr_amount?: string; grams?: string };

async function quoteAndConfirm(body: TradeInput): Promise<{
  quote: QuoteBody;
  confirm: Record<string, unknown>;
}> {
  const q = await client.post('/api/quote', body);
  expect(q.status).toBe(200);
  const c = await client.post('/api/confirm', { quote_id: q.body.quote_id });
  expect(c.status).toBe(200);
  return { quote: q.body, confirm: c.body };
}

describe('balance consistency — nothing is created or destroyed', () => {
  it('BUY moves PKR out, customer gold up and platform inventory down by the same grams', async () => {
    const before = await currentBalances();
    const { quote, confirm } = await quoteAndConfirm({ side: 'BUY', pkr_amount: '5000' });

    const grams = D(quote.grams);
    const pkr = D(quote.pkr_amount);
    expect(grams.toFixed(4)).toBe('0.1136');
    expect(pkr.toFixed(2)).toBe('5000.00');

    const after = await currentBalances();
    // Exact decimal equality — no float tolerance anywhere.
    expect(after.pkr.equals(before.pkr.minus(pkr))).toBe(true);
    expect(after.customer.equals(before.customer.plus(grams))).toBe(true);
    expect(after.platform.equals(before.platform.minus(grams))).toBe(true);

    // The gold moved is conserved: what the customer gained the platform lost.
    const customerDelta = after.customer.minus(before.customer);
    const platformDelta = after.platform.minus(before.platform);
    expect(customerDelta.plus(platformDelta).isZero()).toBe(true);

    expect(confirm.balances).toEqual({
      pkr_wallet: after.pkr.toFixed(2),
      customer_gold_g: after.customer.toFixed(4),
      platform_gold_g: after.platform.toFixed(4),
    });
  });

  it('SELL mirrors the movement exactly', async () => {
    const before = await currentBalances();
    const { quote } = await quoteAndConfirm({ side: 'SELL', grams: '0.5' });

    const grams = D(quote.grams);
    const pkr = D(quote.pkr_amount);
    expect(grams.toFixed(4)).toBe('0.5000');
    expect(pkr.toFixed(2)).toBe('18000.00');

    const after = await currentBalances();
    expect(after.pkr.equals(before.pkr.plus(pkr))).toBe(true);
    expect(after.customer.equals(before.customer.minus(grams))).toBe(true);
    expect(after.platform.equals(before.platform.plus(grams))).toBe(true);
    expect(after.customer.minus(before.customer).plus(after.platform.minus(before.platform)).isZero()).toBe(
      true,
    );
  });

  it('keeps total gold constant across a run of alternating trades', async () => {
    const before = await currentBalances();
    const totalBefore = before.customer.plus(before.platform);

    for (const body of [
      { side: 'BUY', pkr_amount: '5000' },
      { side: 'SELL', grams: '0.05' },
      { side: 'BUY', pkr_amount: '1234.56' },
      { side: 'SELL', pkr_amount: '2000' },
    ]) {
      await quoteAndConfirm(body);
    }

    const after = await currentBalances();
    expect(after.customer.plus(after.platform).equals(totalBefore)).toBe(true);
    expect(await tradeCount()).toBe(4);
  });

  it('records the receipt as a faithful rendering of the committed ledger row', async () => {
    const { quote, confirm } = await quoteAndConfirm({ side: 'BUY', pkr_amount: '5000' });
    const receipt = confirm.receipt as Record<string, unknown>;

    const { rows } = await getPool().query(
      'SELECT * FROM trades WHERE idempotency_key = $1',
      [quote.quote_id],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(receipt.order_id).toBe(row.order_id);
    expect(receipt.trade_id).toBe(row.id);
    expect(receipt.grams).toBe(row.grams);
    expect(receipt.pkr_amount).toBe(row.pkr_amount);
    expect(receipt.locked_price_pkr_per_gram).toBe(row.locked_price);
    expect(receipt.market_reference).toBe(TEST_MARKET);
    expect(receipt.price_source).toBe('pakgold');
    expect(receipt.rounding_note).toMatch(/platform's favour/);
    expect(String(row.order_id)).toMatch(/^ORDER-\d{4}-\d{7}$/);
  });
});

describe('idempotency — Confirm twice yields exactly one trade', () => {
  it('settles once when two confirms are fired concurrently', async () => {
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const before = await currentBalances();

    const [a, b] = await client.postConcurrent('/api/confirm', { quote_id: q.body.quote_id }, 2);
    if (!a || !b) throw new Error('expected two responses');

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await tradeCount()).toBe(1);

    expect(a.body.receipt.order_id).toBe(b.body.receipt.order_id);
    expect(a.body.receipt.trade_id).toBe(b.body.receipt.trade_id);

    const duplicates = [a.body.duplicate, b.body.duplicate].filter(Boolean);
    expect(duplicates).toHaveLength(1);

    // The money moved exactly once.
    const after = await currentBalances();
    expect(after.pkr.equals(before.pkr.minus(D('5000')))).toBe(true);
    expect(after.customer.equals(before.customer.plus(D('0.1136')))).toBe(true);
  });

  it('settles once for five simultaneous confirms', async () => {
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const responses = await client.postConcurrent('/api/confirm', { quote_id: q.body.quote_id }, 5);

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(await tradeCount()).toBe(1);
    const orderIds = new Set(responses.map((r) => r.body.receipt.order_id));
    expect(orderIds.size).toBe(1);
    expect(responses.filter((r) => r.body.duplicate === false)).toHaveLength(1);
  });

  it('returns the same receipt for a sequential second confirm', async () => {
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const first = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    const second = await client.post('/api/confirm', { quote_id: q.body.quote_id });

    expect(first.body.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.receipt).toEqual(first.body.receipt);
    expect(await tradeCount()).toBe(1);
  });

  it('still returns the receipt when the quote has expired since settling', async () => {
    // A user who settles, walks away, and presses Confirm again two minutes
    // later must see their receipt — not "expired", and not a second trade.
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const first = await client.post('/api/confirm', { quote_id: q.body.quote_id });

    const { getRedis, keys } = await import('../src/redis/client');
    const sid = client.sidCookie?.split('=')[1] ?? '';
    const key = keys.quote(sid, q.body.quote_id);
    const stored = JSON.parse((await getRedis().get(key)) ?? '{}');
    stored.expires_at = new Date(Date.now() - 60_000).toISOString();
    await getRedis().set(key, JSON.stringify(stored), 'KEEPTTL');

    const again = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.receipt.order_id).toBe(first.body.receipt.order_id);
    expect(await tradeCount()).toBe(1);
  });

  it('still returns the receipt after the quote payload is gone entirely', async () => {
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    const first = await client.post('/api/confirm', { quote_id: q.body.quote_id });

    const { getRedis, keys } = await import('../src/redis/client');
    const sid = client.sidCookie?.split('=')[1] ?? '';
    await getRedis().del(keys.quote(sid, q.body.quote_id));

    const again = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.receipt).toEqual(first.body.receipt);
    expect(await tradeCount()).toBe(1);
  });
});

describe('the database is the last line of defence', () => {
  it('rejects a direct UPDATE that would overdraw the PKR wallet', async () => {
    await expect(
      getPool().query(
        `UPDATE balances SET pkr_wallet = pkr_wallet - 999999999 WHERE id = 'demo'`,
      ),
    ).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });

    // The failed statement changed nothing.
    expect((await currentBalances()).pkr.toFixed(2)).toBe('250000.00');
  });

  it('rejects a direct UPDATE that would drive customer gold negative', async () => {
    await expect(
      getPool().query(`UPDATE balances SET customer_gold_g = -0.0001 WHERE id = 'demo'`),
    ).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });
  });

  it('rejects a direct UPDATE that would drive platform inventory negative', async () => {
    await expect(
      getPool().query(`UPDATE balances SET platform_gold_g = platform_gold_g - 1000 WHERE id = 'demo'`),
    ).rejects.toMatchObject({ code: PG_CHECK_VIOLATION });
  });

  it('allows a balance to reach exactly zero', async () => {
    await expect(
      getPool().query(`UPDATE balances SET pkr_wallet = 0 WHERE id = 'demo'`),
    ).resolves.toBeDefined();
    expect((await currentBalances()).pkr.toFixed(2)).toBe('0.00');
  });

  it('refuses a second trade row with the same idempotency key', async () => {
    const { quote } = await quoteAndConfirm({ side: 'BUY', pkr_amount: '5000' });
    await expect(
      getPool().query(
        `INSERT INTO trades (order_id, idempotency_key, side, grams, pkr_amount, locked_price,
                             market_reference, price_source, price_fetched_at, guardrail_applied)
         VALUES ('ORDER-2026-9999999', $1, 'BUY', 1, 1, 1, 1, 'pakgold', now(), false)`,
        [quote.quote_id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('refuses to mutate the append-only ledger', async () => {
    await quoteAndConfirm({ side: 'BUY', pkr_amount: '5000' });
    await expect(getPool().query(`UPDATE trades SET grams = 99`)).rejects.toThrow(/append-only/);
    await expect(getPool().query(`DELETE FROM trades`)).rejects.toThrow(/append-only/);
    expect(await tradeCount()).toBe(1);
  });
});

describe('insufficiency is reported with the shortfall, never a generic error', () => {
  it('INSUFFICIENT_PKR when the wallet cannot cover the buy', async () => {
    await client.post('/api/demo/scenario', { scenario: 'low_cash' }); // wallet 1,500
    const res = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_PKR');
    expect(res.body.error.details).toEqual({
      required: '5000.00',
      available: '1500.00',
      shortfall: '3500.00',
    });
    expect(res.body.error.message).toContain('3500.00');
  });

  it('INSUFFICIENT_GOLD when the customer does not hold enough to sell', async () => {
    await client.post('/api/demo/scenario', { scenario: 'low_gold' }); // 0.0500 g
    // 5,000 / 36,000 = 0.138888... -> 0.1389 g debited.
    const res = await client.post('/api/quote', { side: 'SELL', pkr_amount: '5000' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_GOLD');
    expect(res.body.error.details).toEqual({
      required: '0.1389',
      available: '0.0500',
      shortfall: '0.0889',
    });
  });

  it('INSUFFICIENT_INVENTORY when the platform has run out of gold to sell', async () => {
    await client.post('/api/demo/scenario', { scenario: 'low_inventory' }); // 0.0500 g
    const res = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_INVENTORY');
    expect(res.body.error.details).toEqual({
      required: '0.1136',
      available: '0.0500',
      shortfall: '0.0636',
    });
  });

  it('blocks again at settle time when balances moved after the quote was issued', async () => {
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    expect(q.status).toBe(200);

    // The wallet is drained between quote and confirm.
    await getPool().query(`UPDATE balances SET pkr_wallet = 100 WHERE id = 'demo'`);

    const res = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_PKR');
    expect(res.body.error.details.shortfall).toBe('4900.00');
    // Rolled back entirely: no trade, no partial balance movement.
    expect(await tradeCount()).toBe(0);
    expect((await currentBalances()).pkr.toFixed(2)).toBe('100.00');
    expect((await currentBalances()).customer.toFixed(4)).toBe('6.8420');
  });

  it('lets the customer spend their wallet down to exactly zero', async () => {
    await getPool().query(`UPDATE balances SET pkr_wallet = 5000 WHERE id = 'demo'`);
    const { confirm } = await quoteAndConfirm({ side: 'BUY', pkr_amount: '5000' });
    expect((confirm.balances as Record<string, string>).pkr_wallet).toBe('0.00');
    expect((await currentBalances()).pkr.isZero()).toBe(true);
  });
});

describe('settlement respects the locked price, not the current one', () => {
  it('settles at the quoted price even after the market moves', async () => {
    const rig = installFakePricing({ primary: { value: '40000' } });
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });
    expect(q.body.locked_price_pkr_per_gram).toBe(TEST_BUY);

    // Market jumps 25% while the user is reviewing.
    rig.primary.set({ value: '50000' });
    await rig.engine.invalidate();

    const res = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(res.status).toBe(200);
    expect(res.body.receipt.locked_price_pkr_per_gram).toBe(TEST_BUY);
    expect(res.body.receipt.grams).toBe('0.1136');
  });

  it('refuses to settle while the price feed is untrustworthy', async () => {
    const rig = installFakePricing({ primary: { value: '40000' } });
    const q = await client.post('/api/quote', { side: 'BUY', pkr_amount: '5000' });

    rig.primary.set({ fail: 'down' });
    rig.fallback.set({ fail: 'down' });
    await rig.engine.invalidate();

    const res = await client.post('/api/confirm', { quote_id: q.body.quote_id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRADING_PAUSED');
    expect(await tradeCount()).toBe(0);
  });
});

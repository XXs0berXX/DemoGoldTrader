import { describe, expect, it } from 'vitest';
import { ceilTo, floorTo, gramsFromPkr, parseAmount, pkrFromGrams } from './convert';
import { evaluateEntry, type EntryInputs } from './entry';
import { formatGrams, formatPkr } from './format';

/** The locked BUY price from the contract's worked example. */
const BUY_PRICE = 43502.12;
const SELL_PRICE = 35592.64;

describe('PKR <-> grams conversion', () => {
  it('converts PKR to grams at the locked price, rounded down to 4 dp', () => {
    // 5000 / 43502.12 = 0.114937... -> 0.1149 (platform's favour on a BUY)
    expect(gramsFromPkr(5000, BUY_PRICE)).toBe(0.1149);
    expect(gramsFromPkr(10000, BUY_PRICE)).toBe(0.2298);
    expect(gramsFromPkr(25000, BUY_PRICE)).toBe(0.5746);
  });

  it('converts grams to PKR at the locked price, rounded down to 2 dp', () => {
    // 0.1149 * 43502.12 = 4998.39... -> 4998.39
    expect(pkrFromGrams(0.1149, BUY_PRICE)).toBe(4998.39);
    expect(pkrFromGrams(1, BUY_PRICE)).toBe(43502.12);
    expect(pkrFromGrams(0.5, SELL_PRICE)).toBe(17796.32);
  });

  it('round-trips within one unit of the last decimal place', () => {
    const g = gramsFromPkr(5000, BUY_PRICE);
    const back = pkrFromGrams(g, BUY_PRICE);
    expect(back).toBeLessThanOrEqual(5000);
    expect(5000 - back).toBeLessThan(BUY_PRICE * 0.0001 + 0.01);
  });

  it('returns zero rather than Infinity or NaN for degenerate inputs', () => {
    expect(gramsFromPkr(5000, 0)).toBe(0);
    expect(gramsFromPkr(-5, BUY_PRICE)).toBe(0);
    expect(pkrFromGrams(Number.NaN, BUY_PRICE)).toBe(0);
  });

  it('floors and ceils exactly on binary-representation boundaries', () => {
    expect(floorTo(1.005, 2)).toBe(1.0);
    expect(ceilTo(1.005, 2)).toBe(1.01);
    expect(floorTo(0.1149999, 4)).toBe(0.1149);
    expect(ceilTo(0.11491, 4)).toBe(0.115);
  });

  it('parses user input with grouping separators', () => {
    expect(parseAmount('5,000')).toBe(5000);
    expect(parseAmount('0.1149')).toBe(0.1149);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
});

function inputs(overrides: Partial<EntryInputs> = {}): EntryInputs {
  return {
    side: 'BUY',
    mode: 'PKR',
    raw: '5000',
    pricePerGram: BUY_PRICE,
    walletPkr: 250000,
    customerGoldG: 6.842,
    minPkr: 1000,
    maxPkr: 50000,
    ...overrides,
  };
}

describe('evaluateEntry — both input directions', () => {
  it('derives grams when the user types PKR on a BUY', () => {
    const r = evaluateEntry(inputs());
    expect(r.pkr).toBe(5000);
    expect(r.gramsValue).toBe(0.1149);
    expect(r.canSubmit).toBe(true);
    expect(r.request).toEqual({ side: 'BUY', pkr_amount: '5000.00' });
    expect(formatGrams(r.gramsValue)).toBe('0.1149');
    expect(formatPkr(r.pkr)).toBe('5,000.00');
  });

  it('derives PKR when the user types grams on a BUY, rounding the cost up', () => {
    const r = evaluateEntry(inputs({ mode: 'GRAMS', raw: '0.1149' }));
    expect(r.gramsValue).toBe(0.1149);
    // 0.1149 * 43502.12 = 4998.3936 -> the customer pays 4998.40, not 4998.39
    expect(r.pkr).toBe(4998.4);
    expect(r.request).toEqual({ side: 'BUY', grams: '0.1149' });
  });

  it('derives PKR when the user types grams on a SELL, rounding proceeds down', () => {
    const r = evaluateEntry(
      inputs({ side: 'SELL', mode: 'GRAMS', raw: '0.5', pricePerGram: SELL_PRICE }),
    );
    expect(r.gramsValue).toBe(0.5);
    expect(r.pkr).toBe(17796.32);
    expect(r.request).toEqual({ side: 'SELL', grams: '0.5000' });
    expect(r.canSubmit).toBe(true);
  });

  it('derives grams when the user types PKR on a SELL, rounding the gold given up', () => {
    const r = evaluateEntry(
      inputs({ side: 'SELL', mode: 'PKR', raw: '5000', pricePerGram: SELL_PRICE }),
    );
    // 5000 / 35592.64 = 0.140474... -> 0.1405 g given up, not 0.1404
    expect(r.gramsValue).toBe(0.1405);
    expect(r.request).toEqual({ side: 'SELL', pkr_amount: '5000.00' });
  });
});

describe('evaluateEntry — guards', () => {
  it('blocks below the minimum trade size', () => {
    const r = evaluateEntry(inputs({ raw: '500' }));
    expect(r.canSubmit).toBe(false);
    expect(r.block).toBe('AMOUNT_BELOW_MINIMUM');
    expect(r.message).toContain('1,000');
  });

  it('blocks above the maximum trade size', () => {
    const r = evaluateEntry(inputs({ raw: '60000' }));
    expect(r.canSubmit).toBe(false);
    expect(r.block).toBe('AMOUNT_ABOVE_MAXIMUM');
    expect(r.message).toContain('50,000');
  });

  it('blocks a BUY the wallet cannot cover, with the shortfall', () => {
    const r = evaluateEntry(inputs({ raw: '5000', walletPkr: 1500 }));
    expect(r.canSubmit).toBe(false);
    expect(r.block).toBe('INSUFFICIENT_PKR');
    expect(r.details).toEqual({
      required: '5000.00',
      available: '1500.00',
      shortfall: '3500.00',
    });
  });

  it('blocks a SELL bigger than the customer holds', () => {
    const r = evaluateEntry(
      inputs({
        side: 'SELL',
        mode: 'GRAMS',
        raw: '0.5',
        pricePerGram: SELL_PRICE,
        customerGoldG: 0.05,
      }),
    );
    expect(r.canSubmit).toBe(false);
    expect(r.block).toBe('INSUFFICIENT_GOLD');
    expect(r.details).toEqual({
      required: '0.5000',
      available: '0.0500',
      shortfall: '0.4500',
    });
  });

  /* Platform inventory is a shared number the client cannot know is still true.
     Guessing it would mean refusing an order the platform may well be able to
     fill, so the request goes and the server answers. */
  it('does not pre-judge platform inventory — the request still goes to the server', () => {
    const r = evaluateEntry(inputs({ raw: '50000' }));
    expect(r.canSubmit).toBe(true);
    expect(r.block).toBeNull();
    expect(r.request).toEqual({ side: 'BUY', pkr_amount: '50000.00' });
  });

  it('takes no platform balance as an input at all', () => {
    expect(Object.keys(inputs())).not.toContain('platformGoldG');
  });

  it('cannot submit with no price', () => {
    const r = evaluateEntry(inputs({ pricePerGram: 0 }));
    expect(r.canSubmit).toBe(false);
    expect(r.request).toBeNull();
  });
});

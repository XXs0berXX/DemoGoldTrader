import { describe, expect, it } from 'vitest';
import {
  D,
  fmtGrams,
  fmtPkr,
  gramsToTola,
  perGramToPerTola,
  perTroyOunceToPerGram,
  toPure24k,
  tolaToGrams,
  TOLA_GRAMS,
  TROY_OUNCE_GRAMS,
} from '../src/money';

/**
 * Unit/purity/currency normalisation is where correctness is won or lost, so
 * these expectations are computed by hand from the constants rather than by
 * running the code under test.
 */
describe('price normalisation to PKR/gram 24K', () => {
  it('uses the exact troy ounce and tola constants', () => {
    expect(TROY_OUNCE_GRAMS.toString()).toBe('31.1034768');
    expect(TOLA_GRAMS.toString()).toBe('11.6638');
  });

  it('pakgold: XAU (USD/troy oz) x USD->PKR / 31.1034768 -> PKR/gram', () => {
    // 4000 USD/oz x 300 PKR/USD = 1,200,000 PKR/oz
    // 1,200,000 / 31.1034768 = 38,580.8958823536...
    const perGram = perTroyOunceToPerGram(D('4000').times(D('300')));
    expect(perGram.toFixed(10)).toBe('38580.8958823536');
    expect(fmtPkr(perGram)).toBe('38580.90');
  });

  it('goldprice: xauPrice (PKR/troy oz) / 31.1034768 -> PKR/gram', () => {
    // 1,230,000 / 31.1034768 = 39,545.4182794124...
    const perGram = perTroyOunceToPerGram(D('1230000'));
    expect(perGram.toFixed(10)).toBe('39545.4182794124');
    expect(fmtPkr(perGram)).toBe('39545.42');
  });

  it('the two sources agree to well within 1% on realistic live inputs', () => {
    // Values in the neighbourhood of the 2026-09-05 live cross-check
    // (pakgold 39,547.38 vs goldprice 39,538.75 PKR/g).
    const pakgold = perTroyOunceToPerGram(D('4023.10').times(D('305.75')));
    const goldprice = perTroyOunceToPerGram(D('1229900'));

    expect(fmtPkr(pakgold)).toBe('39547.44');
    expect(fmtPkr(goldprice)).toBe('39542.20');

    const mid = pakgold.plus(goldprice).dividedBy(2);
    const divergencePct = pakgold.minus(goldprice).abs().dividedBy(mid).times(100);
    expect(divergencePct.lt(1)).toBe(true);
    expect(divergencePct.toFixed(4)).toBe('0.0132');
  });

  it('round-trips a PKR/gram figure back through the ounce conversion', () => {
    const perGram = D('39547.38');
    const perOunce = perGram.times(TROY_OUNCE_GRAMS);
    expect(perTroyOunceToPerGram(perOunce).toFixed(10)).toBe(perGram.toFixed(10));
  });
});

describe('tola conversion', () => {
  it('converts grams to tola and back exactly', () => {
    expect(gramsToTola(D('11.6638')).toString()).toBe('1');
    expect(tolaToGrams(D('1')).toString()).toBe('11.6638');
    expect(fmtGrams(tolaToGrams(D('2.5')))).toBe('29.1595');
    expect(gramsToTola(tolaToGrams(D('3.25'))).toString()).toBe('3.25');
  });

  it('prices a tola from a PKR/gram reference', () => {
    // 39,547.38 x 11.6638 = 461,272.7308440
    expect(perGramToPerTola(D('39547.38')).toFixed(4)).toBe('461272.7308');
  });
});

describe('purity conversion', () => {
  it('scales a 22K per-gram price up to its 24K equivalent', () => {
    // A 22K price is 22/24 of the pure price, so pure = price / (22/24).
    const pure = toPure24k(D('36751.85'), 22);
    expect(pure.toFixed(4)).toBe(D('36751.85').times(24).dividedBy(22).toFixed(4));
    expect(toPure24k(D('40000'), 24).toString()).toBe('40000');
  });
});

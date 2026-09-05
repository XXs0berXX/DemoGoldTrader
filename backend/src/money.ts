/**
 * The money layer. Every PKR and gram value in this codebase is a Decimal or a
 * fixed-precision string — never a JS `number`, at any layer:
 *
 *   upstream JSON -> string -> Decimal -> Postgres numeric -> string -> JSON
 *
 * The only `number`s that touch money are the decimal-place counts.
 */
import Decimal from 'decimal.js';

// 40 significant digits is far more than PKR/gram arithmetic needs; the wide
// exponent bounds stop toString() ever emitting scientific notation.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

export { Decimal };

export const PKR_DP = 2;
export const GRAM_DP = 4;

export const TROY_OUNCE_GRAMS = new Decimal('31.1034768');
export const TOLA_GRAMS = new Decimal('11.6638');

export type Numeric = string | number | Decimal;

/** Construct a Decimal. `number` is accepted only for literals and constants. */
export function D(v: Numeric): Decimal {
  return v instanceof Decimal ? v : new Decimal(v);
}

/**
 * Strict parser for untrusted input (request bodies, upstream JSON).
 * Returns null for anything that is not a finite, non-negative decimal literal.
 * Deliberately rejects "1e5", "Infinity", "", "1,000", "-5" and objects.
 */
export function parseDecimal(input: unknown): Decimal | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return new Decimal(input);
  }
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  try {
    const d = new Decimal(trimmed);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Rounding helpers. The direction is always an explicit, auditable choice. */
export const roundDown = (d: Decimal, dp: number): Decimal => d.toDecimalPlaces(dp, Decimal.ROUND_DOWN);
export const roundUp = (d: Decimal, dp: number): Decimal => d.toDecimalPlaces(dp, Decimal.ROUND_UP);
export const roundHalfUp = (d: Decimal, dp: number): Decimal => d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);

export const pkrDown = (d: Decimal): Decimal => roundDown(d, PKR_DP);
export const pkrUp = (d: Decimal): Decimal => roundUp(d, PKR_DP);
export const gramsDown = (d: Decimal): Decimal => roundDown(d, GRAM_DP);
export const gramsUp = (d: Decimal): Decimal => roundUp(d, GRAM_DP);

/** Wire formatters — fixed dp, never exponential, always a string. */
export const fmtPkr = (d: Decimal): string => d.toFixed(PKR_DP, Decimal.ROUND_HALF_UP);
export const fmtGrams = (d: Decimal): string => d.toFixed(GRAM_DP, Decimal.ROUND_HALF_UP);

/** Unit conversions. Both sources publish pure/24K, so no karat scaling is applied. */
export const troyOuncesToGrams = (oz: Decimal): Decimal => oz.times(TROY_OUNCE_GRAMS);
export const perTroyOunceToPerGram = (perOz: Decimal): Decimal => perOz.dividedBy(TROY_OUNCE_GRAMS);
export const gramsToTola = (g: Decimal): Decimal => g.dividedBy(TOLA_GRAMS);
export const tolaToGrams = (t: Decimal): Decimal => t.times(TOLA_GRAMS);
export const perGramToPerTola = (perGram: Decimal): Decimal => perGram.times(TOLA_GRAMS);

/** Purity conversion, kept explicit so a non-24K source could be added safely. */
export const karatToPurity = (karat: number): Decimal => new Decimal(karat).dividedBy(24);
export const toPure24k = (pricePerGramAtKarat: Decimal, karat: number): Decimal =>
  pricePerGramAtKarat.dividedBy(karatToPurity(karat));

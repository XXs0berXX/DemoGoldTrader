/**
 * PKR <-> grams conversion for the amount entry screen.
 *
 * **These are display-only estimates.** The server issues the binding numbers
 * on `POST /api/quote`; this only exists so the field the user is not typing in
 * updates live as they type. It deliberately reproduces the server's rounding
 * rule — always in the platform's favour — so the preview does not read higher
 * than the quote that follows:
 *
 *   BUY  (PKR in -> grams out): grams round **down** to 4 dp
 *   SELL (grams in -> PKR out): PKR   rounds **down** to 2 dp
 */

export const PKR_DP = 2;
export const GRAM_DP = 4;
export const TOLA_GRAMS = 11.6638;

/**
 * Floor to `dp` decimal places. The epsilon nudge absorbs binary
 * representation error (e.g. `1.005 * 100 === 100.49999999999999`) so a value
 * that is exactly on a boundary is not silently rounded down a step.
 */
export function floorTo(value: number, dp: number): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** dp;
  return Math.floor(value * f + 1e-9) / f;
}

/** Ceil to `dp` decimal places, with the same epsilon guard as {@link floorTo}. */
export function ceilTo(value: number, dp: number): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** dp;
  return Math.ceil(value * f - 1e-9) / f;
}

/** Parse a user-typed amount. Tolerates grouping commas and spaces. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '');
  if (cleaned === '' || cleaned === '.') return null;
  if (!/^\d*(\.\d*)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse a server decimal string. Returns 0 for anything unusable. */
export function num(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Grams the customer receives for `pkr` at `pricePerGram`, rounded down. */
export function gramsFromPkr(pkr: number, pricePerGram: number): number {
  if (!(pricePerGram > 0) || !Number.isFinite(pkr) || pkr <= 0) return 0;
  return floorTo(pkr / pricePerGram, GRAM_DP);
}

/** PKR the customer pays/receives for `grams` at `pricePerGram`, rounded down. */
export function pkrFromGrams(gramsIn: number, pricePerGram: number): number {
  if (!(pricePerGram > 0) || !Number.isFinite(gramsIn) || gramsIn <= 0) return 0;
  return floorTo(gramsIn * pricePerGram, PKR_DP);
}

export function gramsToTola(gramsIn: number): number {
  return gramsIn / TOLA_GRAMS;
}

export function tolaToGrams(tola: number): number {
  return tola * TOLA_GRAMS;
}

/**
 * Largest whole-PKR amount the customer can spend on a BUY, given their wallet,
 * the platform's remaining inventory and the trade maximum. Used for the
 * "Max buy 0.661 g" hint and to keep the entry screen from proposing an amount
 * that the server would only reject.
 */
export function maxBuyPkr(
  walletPkr: number,
  platformGoldG: number,
  buyPricePerGram: number,
  maxTradePkr: number,
): number {
  const inventoryCap =
    buyPricePerGram > 0 ? floorTo(platformGoldG * buyPricePerGram, PKR_DP) : 0;
  return floorTo(Math.max(0, Math.min(walletPkr, inventoryCap, maxTradePkr)), PKR_DP);
}

/** Largest gram amount the customer can sell: their holdings, capped by the PKR maximum. */
export function maxSellGrams(
  customerGoldG: number,
  sellPricePerGram: number,
  maxTradePkr: number,
): number {
  const pkrCap =
    sellPricePerGram > 0 ? maxTradePkr / sellPricePerGram : Number.POSITIVE_INFINITY;
  return floorTo(Math.max(0, Math.min(customerGoldG, pkrCap)), GRAM_DP);
}

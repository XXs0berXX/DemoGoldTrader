import type { QuoteRequest, ShortfallDetails, Side } from '../api/types';
import { GRAM_DP, PKR_DP, ceilTo, floorTo, num, parseAmount } from './convert';

/** Which side of the pair the user is typing into. */
export type EntryMode = 'PKR' | 'GRAMS';

/**
 * What the client refuses to send on its own.
 *
 * The customer's own two constraints — wallet cash and gold holdings — stay
 * here. We already hold both numbers, they only move when *this* user trades,
 * and telling someone their wallet is short is faster and clearer than a round
 * trip. The server re-checks both anyway, under a row lock, so this is a
 * courtesy and never the guarantee.
 *
 * Platform inventory is deliberately **absent**. It is a shared resource: it
 * can move for reasons that have nothing to do with this user, between the last
 * `/api/state` read and the tap. The client cannot know it, so it must not
 * pretend to — `INSUFFICIENT_INVENTORY` only ever arrives from the server.
 */
export type EntryBlock =
  | 'INSUFFICIENT_PKR'
  | 'INSUFFICIENT_GOLD'
  | 'AMOUNT_BELOW_MINIMUM'
  | 'AMOUNT_ABOVE_MAXIMUM';

export interface EntryInputs {
  side: Side;
  mode: EntryMode;
  /** Exactly as typed. */
  raw: string;
  /** Customer-facing price for this side, PKR/gram. */
  pricePerGram: number;
  walletPkr: number;
  customerGoldG: number;
  minPkr: number;
  maxPkr: number;
}

export interface EntryResult {
  /** Parsed amount in the unit the user is typing, or null. */
  entered: number | null;
  /** PKR leg of the trade (paid on BUY, received on SELL). */
  pkr: number;
  /** Gram leg of the trade. */
  gramsValue: number;
  /** True when a quote may be requested. */
  canSubmit: boolean;
  /** Set when the client can already tell this trade cannot go through. */
  block: EntryBlock | null;
  /** Populated for the two shortfall blocks. */
  details: ShortfallDetails;
  /** Inline copy for limit blocks. */
  message: string | null;
  /** The exact body to POST to /api/quote. */
  request: QuoteRequest | null;
}

const empty = (): EntryResult => ({
  entered: null,
  pkr: 0,
  gramsValue: 0,
  canSubmit: false,
  block: null,
  details: {},
  message: null,
  request: null,
});

/**
 * Derives the other leg of the trade and decides whether we can quote.
 *
 * The conversion mirrors the server's rounding rule — always in the platform's
 * favour — so the preview never promises more than the quote will deliver:
 *
 *   BUY  + PKR in    -> grams floor  (customer receives no more than they paid for)
 *   BUY  + grams in  -> PKR   ceil   (customer pays no less than the gold costs)
 *   SELL + grams in  -> PKR   floor  (customer is paid no more than the gold is worth)
 *   SELL + PKR in    -> grams ceil   (customer gives up no less gold than the cash needs)
 *
 * These are display-only. The binding numbers arrive with the quote.
 */
export function evaluateEntry(inputs: EntryInputs): EntryResult {
  const { side, mode, raw, pricePerGram, walletPkr, customerGoldG, minPkr, maxPkr } =
    inputs;

  const entered = parseAmount(raw);
  if (entered === null || entered <= 0 || !(pricePerGram > 0)) {
    return { ...empty(), entered };
  }

  let pkr: number;
  let gramsValue: number;

  if (mode === 'PKR') {
    pkr = floorTo(entered, PKR_DP);
    gramsValue =
      side === 'BUY'
        ? floorTo(pkr / pricePerGram, GRAM_DP)
        : ceilTo(pkr / pricePerGram, GRAM_DP);
  } else {
    gramsValue = floorTo(entered, GRAM_DP);
    pkr =
      side === 'BUY'
        ? ceilTo(gramsValue * pricePerGram, PKR_DP)
        : floorTo(gramsValue * pricePerGram, PKR_DP);
  }

  const request: QuoteRequest =
    mode === 'PKR'
      ? { side, pkr_amount: pkr.toFixed(PKR_DP) }
      : { side, grams: gramsValue.toFixed(GRAM_DP) };

  const base = { ...empty(), entered, pkr, gramsValue, request };

  // Trade-size limits are checked against the PKR leg, matching the server.
  if (pkr < minPkr) {
    return {
      ...base,
      block: 'AMOUNT_BELOW_MINIMUM',
      message: `Minimum trade is Rs. ${minPkr.toLocaleString('en-US')}.`,
    };
  }
  if (pkr > maxPkr) {
    return {
      ...base,
      block: 'AMOUNT_ABOVE_MAXIMUM',
      message: `Maximum trade is Rs. ${maxPkr.toLocaleString('en-US')}.`,
    };
  }

  // The customer's own two constraints. Blocked here with the exact shortfall
  // so the reason is on screen immediately — never a silent dead button.
  if (side === 'BUY' && pkr > walletPkr) {
    return {
      ...base,
      block: 'INSUFFICIENT_PKR',
      details: {
        required: pkr.toFixed(PKR_DP),
        available: walletPkr.toFixed(PKR_DP),
        shortfall: (pkr - walletPkr).toFixed(PKR_DP),
      },
    };
  }
  if (side === 'SELL' && gramsValue > customerGoldG) {
    return {
      ...base,
      block: 'INSUFFICIENT_GOLD',
      details: {
        required: gramsValue.toFixed(GRAM_DP),
        available: customerGoldG.toFixed(GRAM_DP),
        shortfall: (gramsValue - customerGoldG).toFixed(GRAM_DP),
      },
    };
  }

  // Whether the platform can actually source the gold is the server's call, so
  // Continue stays live and the user gets a real answer rather than a refusal.
  return { ...base, canSubmit: true };
}

/** Convenience wrapper so callers can pass raw server strings. */
export function toNumbers(...values: Array<string | number | null | undefined>): number[] {
  return values.map(num);
}

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { invalidRequest, tradingPaused } from '../../errors';
import { fmtGrams, fmtPkr, parseDecimal } from '../../money';
import { getBalances } from '../../db/balances';
import { derivePricing, getPricingEngine, isLive } from '../../pricing/engine';
import { getEffectiveGuardrail } from '../../demo/state';
import { issueQuote, projectBalances, secondsRemaining, type InputMode } from '../../quotes/service';
import { D } from '../../money';

export const quoteRouter: Router = Router();

/**
 * Amounts arrive as strings (the contract's rule), but a JSON number is
 * tolerated and converted through decimal.js rather than rejected — the value
 * is re-parsed strictly by parseDecimal either way.
 */
const amountSchema = z.union([z.string(), z.number()]).nullish();

const quoteBodySchema = z.object({
  side: z.enum(['BUY', 'SELL']),
  pkr_amount: amountSchema,
  grams: amountSchema,
});

quoteRouter.post('/quote', async (req: Request, res: Response) => {
  const parsed = quoteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw invalidRequest('Send a side of "BUY" or "SELL" with either pkr_amount or grams.', {
      issues: parsed.data === undefined ? parsed.error.issues.map((i) => i.message) : [],
    });
  }

  const { side } = parsed.data;
  const hasPkr = parsed.data.pkr_amount !== undefined && parsed.data.pkr_amount !== null;
  const hasGrams = parsed.data.grams !== undefined && parsed.data.grams !== null;

  if (hasPkr === hasGrams) {
    throw invalidRequest(
      hasPkr
        ? 'Send either an amount in PKR or an amount in grams — not both.'
        : 'Send an amount, either in PKR or in grams.',
    );
  }

  const inputMode: InputMode = hasPkr ? 'PKR' : 'GRAMS';
  const rawAmount = hasPkr ? parsed.data.pkr_amount : parsed.data.grams;
  const amount = parseDecimal(rawAmount);
  if (amount === null || amount.lte(0)) {
    throw invalidRequest('That amount is not a valid positive number.');
  }

  const [priceState, guardrail] = await Promise.all([
    getPricingEngine().getPrice(),
    getEffectiveGuardrail(),
  ]);
  if (!isLive(priceState)) {
    throw tradingPaused(priceState.reason);
  }

  const pricing = derivePricing(priceState.market, guardrail);
  const balances = await getBalances();

  const quote = await issueQuote({
    sid: req.sid,
    side,
    inputMode,
    amount,
    pricing,
    source: priceState.source,
    priceFetchedAt: priceState.fetchedAt,
    balances,
  });

  const after = projectBalances(side, D(quote.grams), D(quote.pkr_amount), balances);

  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    quote_id: quote.quote_id,
    side: quote.side,
    grams: quote.grams,
    pkr_amount: quote.pkr_amount,
    locked_price_pkr_per_gram: quote.locked_price_pkr_per_gram,
    market_reference: quote.market_reference,
    source: quote.source,
    price_fetched_at: quote.price_fetched_at,
    guardrail_applied: quote.guardrail_applied,
    issued_at: quote.issued_at,
    expires_at: quote.expires_at,
    ttl_seconds: secondsRemaining(quote),
    rounding_note: quote.rounding_note,
    balances_after: {
      pkr_wallet: fmtPkr(after.pkrWallet),
      customer_gold_g: fmtGrams(after.customerGoldG),
      platform_gold_g: fmtGrams(after.platformGoldG),
    },
  });
});

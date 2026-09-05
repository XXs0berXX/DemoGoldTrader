import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { invalidRequest, quoteExpired, quoteNotFound, tradingPaused } from '../../errors';
import { balancesToWire, getBalances } from '../../db/balances';
import { getPricingEngine, isLive } from '../../pricing/engine';
import { isExpired, loadQuote, markConsumed, wasConsumed } from '../../quotes/service';
import { findTradeByIdempotencyKey } from '../../trades/repository';
import { buildReceipt, settleQuote } from '../../trades/settle';

export const confirmRouter: Router = Router();

const confirmBodySchema = z.object({
  quote_id: z.string().trim().min(1).max(128),
});

confirmRouter.post('/confirm', async (req: Request, res: Response) => {
  const parsed = confirmBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw invalidRequest('Send the quote_id of the quote you want to settle.');
  }
  const quoteId = parsed.data.quote_id;
  const sid = req.sid;
  res.set('Cache-Control', 'no-store');

  const quote = await loadQuote(sid, quoteId);

  if (!quote) {
    // The quote payload is gone. It may still have settled — the ledger, not
    // Redis, decides. The consumed marker proves it belonged to this session.
    const marker = await wasConsumed(sid, quoteId);
    if (marker) {
      const trade = await findTradeByIdempotencyKey(quoteId);
      if (trade) {
        res.status(200).json({
          receipt: buildReceipt(trade, marker.rounding_note),
          balances: balancesToWire(await getBalances(), false),
          duplicate: true,
        });
        return;
      }
    }
    throw quoteNotFound();
  }

  // Already settled? Answer with the original receipt *before* considering
  // expiry, so a second press 80 seconds later still returns the same document
  // rather than a confusing "expired".
  const alreadySettled = await findTradeByIdempotencyKey(quoteId);
  if (alreadySettled) {
    res.status(200).json({
      receipt: buildReceipt(alreadySettled, quote.rounding_note),
      balances: balancesToWire(await getBalances(), false),
      duplicate: true,
    });
    return;
  }

  // Expiry is decided by the stored timestamp, never by the key's absence.
  if (isExpired(quote)) {
    throw quoteExpired();
  }

  // We settle at the *locked* price, but we refuse to settle at all while the
  // price feed is untrustworthy — a paused market is paused for everyone.
  const priceState = await getPricingEngine().getPrice();
  if (!isLive(priceState)) {
    throw tradingPaused(priceState.reason);
  }

  const result = await settleQuote(quote);
  await markConsumed(sid, quoteId, {
    order_id: result.trade.order_id,
    rounding_note: quote.rounding_note,
  });

  res.status(200).json({
    receipt: buildReceipt(result.trade, quote.rounding_note),
    balances: balancesToWire(result.balances, false),
    duplicate: result.duplicate,
  });
});

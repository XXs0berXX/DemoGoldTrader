import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { invalidRequest } from '../../errors';
import { D, fmtPkr, parseDecimal } from '../../money';
import { balancesToWire, writeBalances } from '../../db/balances';
import { getPricingEngine } from '../../pricing/engine';
import { clearHistoryCache } from '../../pricing/history';
import {
  clearGuardrailOverride,
  getDemoStatus,
  getEffectiveGuardrail,
  SCENARIOS,
  setGuardrailOverride,
  setScenario,
  setSourceFailureMode,
  SOURCE_FAILURE_MODES,
  SCENARIO_NAMES,
} from '../../demo/state';
import { clearAllQuotes } from '../../quotes/service';
import { priceToWire } from '../wire';

/**
 * Reviewer stress controls (product_spec.md §7).
 *
 * These are deliberately obvious and deliberately non-production: they let a
 * reviewer trigger every failure mode without redeploying. Nothing here can
 * fabricate a trade or bypass a balance constraint — the worst it can do is
 * make the product tell the truth about a degraded state.
 */
export const demoRouter: Router = Router();

/** Re-read the price after a toggle so the response already reflects the change. */
async function currentPriceWire(): Promise<ReturnType<typeof priceToWire>> {
  const [state, guardrail] = await Promise.all([
    getPricingEngine().getPrice(),
    getEffectiveGuardrail(),
  ]);
  return priceToWire(state, guardrail);
}

const sourceFailureSchema = z.object({
  mode: z.enum(['none', 'primary', 'both']),
});

demoRouter.post('/demo/source-failure', async (req: Request, res: Response) => {
  const parsed = sourceFailureSchema.safeParse(req.body);
  if (!parsed.success) {
    throw invalidRequest(`mode must be one of: ${SOURCE_FAILURE_MODES.join(', ')}.`);
  }
  await setSourceFailureMode(parsed.data.mode);
  // Flush both caches so the toggle is observable immediately rather than in 5
  // min. History is flushed too, otherwise a reviewer who kills the sources
  // would still see a live-looking chart next to a paused price.
  await Promise.all([getPricingEngine().invalidate(), clearHistoryCache()]);

  res.set('Cache-Control', 'no-store');
  res.json({ ...(await getDemoStatus()), price: await currentPriceWire() });
});

const guardrailSchema = z.union([
  z.object({ reset: z.literal(true) }),
  z.object({ pkr_per_gram: z.union([z.string(), z.number()]) }),
]);

demoRouter.post('/demo/guardrail', async (req: Request, res: Response) => {
  const parsed = guardrailSchema.safeParse(req.body);
  if (!parsed.success) {
    throw invalidRequest('Send { "pkr_per_gram": "60000" } to raise the floor, or { "reset": true }.');
  }

  if ('reset' in parsed.data) {
    await clearGuardrailOverride();
  } else {
    const value = parseDecimal(parsed.data.pkr_per_gram);
    if (value === null || value.lte(0)) {
      throw invalidRequest('pkr_per_gram must be a positive decimal number.');
    }
    if (value.gt(D('10000000'))) {
      throw invalidRequest('pkr_per_gram is implausibly large; keep the demo believable.');
    }
    await setGuardrailOverride(value);
  }
  await getPricingEngine().invalidate();

  res.set('Cache-Control', 'no-store');
  res.json({ ...(await getDemoStatus()), price: await currentPriceWire() });
});

const scenarioSchema = z.object({
  scenario: z.enum(['normal', 'low_cash', 'low_gold', 'low_inventory']),
});

demoRouter.post('/demo/scenario', async (req: Request, res: Response) => {
  const parsed = scenarioSchema.safeParse(req.body);
  if (!parsed.success) {
    throw invalidRequest(`scenario must be one of: ${SCENARIO_NAMES.join(', ')}.`);
  }

  const preset = SCENARIOS[parsed.data.scenario];
  const balances = await writeBalances(undefined, {
    pkrWallet: D(preset.pkrWallet),
    customerGoldG: D(preset.customerGoldG),
    platformGoldG: D(preset.platformGoldG),
  });
  await setScenario(parsed.data.scenario);
  // Any quote issued against the old balances is now meaningless.
  const clearedQuotes = await clearAllQuotes();

  res.set('Cache-Control', 'no-store');
  res.json({
    ...(await getDemoStatus()),
    balances: balancesToWire(balances),
    intent: preset.intent,
    cleared_quotes: clearedQuotes,
    // Stated explicitly because it surprises people: re-seeding moves balances
    // but does not rewrite history.
    note: 'Balances re-seeded. The trade ledger is append-only and was not modified.',
  });
});

demoRouter.get('/demo/status', async (_req: Request, res: Response) => {
  const status = await getDemoStatus();
  res.set('Cache-Control', 'no-store');
  res.json({
    ...status,
    guardrail_in_force: fmtPkr(await getEffectiveGuardrail()),
    scenarios: Object.fromEntries(
      Object.entries(SCENARIOS).map(([name, preset]) => [
        name,
        {
          pkr_wallet: preset.pkrWallet,
          customer_gold_g: preset.customerGoldG,
          platform_gold_g: preset.platformGoldG,
          intent: preset.intent,
        },
      ]),
    ),
  });
});

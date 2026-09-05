import { Router, type Request, type Response } from 'express';
import { getPricingEngine } from '../../pricing/engine';
import { getEffectiveGuardrail } from '../../demo/state';
import { priceToWire } from '../wire';

export const priceRouter: Router = Router();

priceRouter.get('/price', async (_req: Request, res: Response) => {
  const [state, guardrail] = await Promise.all([
    getPricingEngine().getPrice(),
    getEffectiveGuardrail(),
  ]);
  // Never let a CDN or browser cache a price: freshness is the product.
  res.set('Cache-Control', 'no-store');
  res.json(priceToWire(state, guardrail));
});

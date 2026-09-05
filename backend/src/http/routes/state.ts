import { Router, type Request, type Response } from 'express';
import { balancesToWire, getBalances } from '../../db/balances';
import { listRecentTrades, tradeToWire } from '../../trades/repository';
import { getScenario } from '../../demo/state';
import { limitsToWire } from '../wire';

export const stateRouter: Router = Router();

stateRouter.get('/state', async (_req: Request, res: Response) => {
  const [balances, trades, scenario] = await Promise.all([
    getBalances(),
    listRecentTrades(20),
    getScenario(),
  ]);

  res.set('Cache-Control', 'no-store');
  res.json({
    balances: balancesToWire(balances),
    limits: limitsToWire(),
    trades: trades.map(tradeToWire),
    scenario,
  });
});

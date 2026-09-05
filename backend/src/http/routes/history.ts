import { Router, type Request, type Response } from 'express';
import { getHistory, isHistoryRange, type HistoryRange } from '../../pricing/history';
import { ApiError } from '../../errors';

export const historyRouter: Router = Router();

/**
 * `GET /api/price/history?range=1D|1W|1M|1Y`
 *
 * Read-only. History never gates trading: if it is unavailable the series comes
 * back flagged rather than as an error, and the chart says so while the rest of
 * the product carries on.
 */
historyRouter.get('/price/history', async (req: Request, res: Response) => {
  const raw = req.query.range ?? '1M';
  if (!isHistoryRange(raw)) {
    throw new ApiError(400, 'INVALID_REQUEST', 'range must be one of 1D, 1W, 1M or 1Y.', {
      allowed: ['1D', '1W', '1M', '1Y'],
    });
  }
  const series = await getHistory(raw as HistoryRange);
  res.set('Cache-Control', 'no-store');
  res.json(series);
});

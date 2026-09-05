import { Router, type Request, type Response } from 'express';
import { getPool } from '../../db/pool';
import { getRedis } from '../../redis/client';

export const healthRouter: Router = Router();

const startedAt = Date.now();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  const [db, redis] = await Promise.all([
    getPool()
      .query('SELECT 1')
      .then(() => 'ok' as const)
      .catch((err: Error) => `error: ${err.message}`),
    getRedis()
      .ping()
      .then(() => 'ok' as const)
      .catch((err: Error) => `error: ${err.message}`),
  ]);

  const healthy = db === 'ok' && redis === 'ok';
  res.set('Cache-Control', 'no-store');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    db,
    redis,
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
  });
});

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { ApiError } from './errors';
import { config } from './config';
import { sessionMiddleware } from './http/session';
import { priceRouter } from './http/routes/price';
import { historyRouter } from './http/routes/history';
import { stateRouter } from './http/routes/state';
import { quoteRouter } from './http/routes/quote';
import { confirmRouter } from './http/routes/confirm';
import { demoRouter } from './http/routes/demo';
import { healthRouter } from './http/routes/health';
import { mountStatic } from './http/static';

export interface CreateAppOptions {
  /** Skip static serving (tests, and any API-only deployment). */
  serveStatic?: boolean;
}

export function createApp(opts: CreateAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // Railway terminates TLS upstream; trust it so `secure` cookies are set.
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '16kb' }));
  app.use(sessionMiddleware);

  if (!config.isTest) app.use(requestLogger);

  app.use('/api', healthRouter);
  app.use('/api', priceRouter);
  app.use('/api', historyRouter);
  app.use('/api', stateRouter);
  app.use('/api', quoteRouter);
  app.use('/api', confirmRouter);
  app.use('/api', demoRouter);

  // Unmatched API routes get a JSON 404, not the SPA shell.
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'No such endpoint.', details: {} },
    });
  });

  if (opts.serveStatic ?? config.isProduction) {
    mountStatic(app);
  }

  app.use(errorHandler);
  return app;
}

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`);
    }
  });
  next();
}

/**
 * The single place the error envelope from API_CONTRACT.md §4 is produced.
 * Anything that is not an ApiError is a bug: log it in full, tell the client
 * nothing but a generic sentence.
 */
function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json(err.toEnvelope());
    return;
  }

  // express.json() rejects malformed bodies with a SyntaxError.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'That request body was not valid JSON.', details: {} },
    });
    return;
  }

  console.error('[error] unhandled:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Nothing was charged and no trade was made.',
      details: {},
    },
  });
}

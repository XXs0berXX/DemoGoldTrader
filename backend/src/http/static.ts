import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { config } from '../config';

/**
 * Serve the built SPA so the whole demo is one Railway service on one URL.
 *
 * Deliberately optional: if `frontend/dist` has not been built yet the API must
 * still boot (and say so), because the backend is developed and tested
 * independently of the frontend.
 */
export function resolveFrontendDist(): string | null {
  const candidates: string[] = [];
  if (config.frontendDist) candidates.push(path.resolve(config.frontendDist));
  if (typeof __dirname !== 'undefined') {
    // dist/http -> backend -> repo root; and src/http -> backend -> repo root
    candidates.push(path.resolve(__dirname, '../../../frontend/dist'));
  }
  candidates.push(
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), 'frontend/dist'),
  );

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

export function mountStatic(app: Express): void {
  const dist = resolveFrontendDist();

  if (!dist) {
    console.warn(
      '[static] frontend/dist not found — serving the API only. ' +
        'Run the frontend build (or set FRONTEND_DIST) to serve the SPA from this process.',
    );
    return;
  }

  console.log(`[static] serving SPA from ${dist}`);

  app.use(
    express.static(dist, {
      index: false,
      // Vite emits content-hashed asset filenames, so they are safe to cache
      // hard; index.html must never be cached or a deploy would not take.
      setHeaders: (res, filePath) => {
        res.setHeader(
          'Cache-Control',
          /[.-][0-9a-f]{8,}\.[a-z0-9]+$/i.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    }),
  );

  // SPA fallback for client-side routes. Express 5's router no longer accepts
  // a bare '*' path, and an /api miss must stay a JSON 404 rather than being
  // answered with an HTML page — so this is a plain terminal middleware.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

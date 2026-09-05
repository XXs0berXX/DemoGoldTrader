import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

declare module 'express-serve-static-core' {
  interface Request {
    /** Opaque per-browser session id. Not authentication — it only scopes quotes. */
    sid: string;
  }
}

const SID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/**
 * Issues an httpOnly `asasa_sid` cookie on first contact.
 *
 * Balances are a single global singleton (this is a single-user demo and the UI
 * says so), but *quotes* are scoped to this cookie so two reviewers hitting the
 * same deployment cannot consume each other's price lock. The value is a random
 * UUID and is validated on the way in, so a hand-crafted cookie cannot be used
 * to shape Redis keys.
 */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies[config.sessionCookieName];

  if (existing && SID_PATTERN.test(existing)) {
    req.sid = existing.toLowerCase();
    next();
    return;
  }

  const sid = randomUUID();
  req.sid = sid;
  res.cookie(config.sessionCookieName, sid, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionCookieMaxAgeMs,
    secure: config.isProduction,
  });
  next();
}

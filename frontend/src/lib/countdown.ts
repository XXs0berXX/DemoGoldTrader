/**
 * Quote countdown maths.
 *
 * The server owns the quote. `expires_at` is server truth; the client only
 * *displays* the distance to it. Everything here is derived from an absolute
 * timestamp rather than a decrementing counter, so a backgrounded tab (whose
 * timers get throttled) cannot drift out of agreement with the server.
 */

/** Milliseconds until `expiresAt`, clamped at zero. Never negative. */
export function remainingMs(expiresAt: string | number | null, now: number): number {
  if (expiresAt === null) return 0;
  const t = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, t - now);
}

/** Whole seconds remaining, rounded up so the clock reads `0:00` only once it is truly over. */
export function remainingSeconds(expiresAt: string | number | null, now: number): number {
  return Math.ceil(remainingMs(expiresAt, now) / 1000);
}

/** `0` … `1` — how much of the lock window is left, for the countdown meter. */
export function remainingFraction(
  issuedAt: string | number | null,
  expiresAt: string | number | null,
  now: number,
): number {
  const start = typeof issuedAt === 'number' ? issuedAt : Date.parse(issuedAt ?? '');
  const end = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

/** The last 15 seconds are called out visually — the user is about to lose the price. */
export const URGENT_SECONDS = 15;

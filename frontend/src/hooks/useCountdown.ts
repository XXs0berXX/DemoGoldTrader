import { useCallback, useEffect, useState } from 'react';
import { remainingFraction, remainingMs, remainingSeconds } from '../lib/countdown';

export interface Countdown {
  /** Whole seconds left, rounded up. Clamped at 0 — never negative. */
  secondsLeft: number;
  /** Milliseconds left, clamped at 0. */
  msLeft: number;
  /** True once `expires_at` has passed. */
  expired: boolean;
  /** 1 → 0 across the lock window, for the progress meter. */
  fraction: number;
}

const TICK_MS = 250;

/**
 * Displays the distance to a server-issued `expires_at`.
 *
 * Recomputed from the absolute timestamp on every tick — and again whenever the
 * tab is refocused or made visible — rather than decrementing a local counter.
 * A backgrounded tab has its timers throttled, so a decrementing counter would
 * come back reading a lock the server has already released.
 */
export function useCountdown(
  expiresAt: string | number | null,
  issuedAt: string | number | null = null,
): Countdown {
  const compute = useCallback((): Countdown => {
    const now = Date.now();
    return {
      secondsLeft: remainingSeconds(expiresAt, now),
      msLeft: remainingMs(expiresAt, now),
      expired: remainingMs(expiresAt, now) <= 0,
      fraction: remainingFraction(issuedAt, expiresAt, now),
    };
  }, [expiresAt, issuedAt]);

  const [value, setValue] = useState<Countdown>(compute);

  useEffect(() => {
    setValue(compute());
    if (expiresAt === null) return;

    const resync = () => setValue(compute());
    const id = window.setInterval(resync, TICK_MS);

    // A throttled/backgrounded tab can miss many ticks; resync the instant it
    // comes back so the user never sees a lock that has really expired.
    window.addEventListener('focus', resync);
    window.addEventListener('pageshow', resync);
    document.addEventListener('visibilitychange', resync);

    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', resync);
      window.removeEventListener('pageshow', resync);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [compute, expiresAt]);

  return value;
}

import type { Redis } from 'ioredis';
import { config } from '../config';
import { D, Decimal, fmtPkr, parseDecimal, roundDown, roundHalfUp, roundUp } from '../money';
import { getRedis, keys } from '../redis/client';
import { getSourceFailureMode, type SourceFailureMode } from '../demo/state';
import { defaultSources, SourceError, type PriceSource, type SourceName } from './sources';

export type Freshness = 'LIVE' | 'UNAVAILABLE';

/** What we persist in Redis under `price:current`. */
interface CacheEnvelope {
  pkr_per_gram: string;
  source: SourceName;
  fetched_at: string;
}

export interface LivePrice {
  freshness: 'LIVE';
  /** Market reference: PKR per gram, 24K, already rounded to 2 dp. */
  market: Decimal;
  source: SourceName;
  fetchedAt: Date;
  ageSeconds: number;
  ttlSeconds: number;
}

export interface UnavailablePrice {
  freshness: 'UNAVAILABLE';
  reason: string;
}

export type PriceState = LivePrice | UnavailablePrice;

export const isLive = (p: PriceState): p is LivePrice => p.freshness === 'LIVE';

/**
 * Customer-facing prices derived from the market reference.
 *
 *   BUY  /g = max(market x BUY_SPREAD, guardrail)   -- rounded UP   to 2 dp
 *   SELL /g = market x SELL_SPREAD                  -- rounded DOWN to 2 dp
 *
 * Both roundings favour the platform, consistently with settlement rounding.
 */
export interface CustomerPricing {
  market: Decimal;
  buy: Decimal;
  sell: Decimal;
  guardrail: Decimal;
  guardrailApplied: boolean;
}

export function derivePricing(market: Decimal, guardrail: Decimal): CustomerPricing {
  const marketRef = roundHalfUp(market, 2);
  const buySpread = D(config.buySpread);
  const sellSpread = D(config.sellSpread);

  const buyRaw = marketRef.times(buySpread);
  const guardrailApplied = guardrail.gt(buyRaw);
  const buy = roundUp(guardrailApplied ? guardrail : buyRaw, 2);
  const sell = roundDown(marketRef.times(sellSpread), 2);

  return { market: marketRef, buy, sell, guardrail, guardrailApplied };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface PricingEngineOptions {
  sources?: readonly PriceSource[];
  redis?: Redis;
  ttlSeconds?: number;
  lockTtlMs?: number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to the Redis-backed demo toggle. */
  failureMode?: () => Promise<SourceFailureMode>;
}

export class PricingEngine {
  private readonly sources: readonly PriceSource[];
  private readonly ttlSeconds: number;
  private readonly lockTtlMs: number;
  private readonly timeoutMs: number;
  private readonly failureMode: () => Promise<SourceFailureMode>;
  private readonly redisOverride?: Redis;

  constructor(opts: PricingEngineOptions = {}) {
    this.sources = opts.sources ?? defaultSources;
    this.ttlSeconds = opts.ttlSeconds ?? config.priceTtlSeconds;
    this.lockTtlMs = opts.lockTtlMs ?? config.priceLockTtlMs;
    this.timeoutMs = opts.timeoutMs ?? config.upstreamTimeoutMs;
    this.failureMode = opts.failureMode ?? getSourceFailureMode;
    this.redisOverride = opts.redis;
  }

  private get redis(): Redis {
    return this.redisOverride ?? getRedis();
  }

  /**
   * The only way to obtain a price.
   *
   * 1. Serve the cache if it is warm (this is what enforces "at most one
   *    upstream fetch per 300s").
   * 2. On a miss, contend for a single-flight Redis lock. The winner refreshes;
   *    everyone else polls the cache rather than piling onto the upstream.
   * 3. If no trustworthy value can be produced, report UNAVAILABLE. We never
   *    serve a stale value dressed up as live.
   */
  async getPrice(): Promise<PriceState> {
    const cached = await this.readCache();
    if (cached) return cached;

    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const acquired = await this.redis.set(keys.priceLock, token, 'PX', this.lockTtlMs, 'NX');

    if (acquired !== 'OK') return this.awaitRefreshByLockHolder();

    try {
      // Re-check under the lock: another process may have populated the cache
      // between our miss and our acquisition.
      const raced = await this.readCache();
      if (raced) return raced;
      return await this.refresh();
    } finally {
      await this.releaseLock(token);
    }
  }

  /** Drop the cached price so the next read refetches. Used by the demo controls. */
  async invalidate(): Promise<void> {
    await this.redis.del(keys.priceCurrent, keys.priceLock);
  }

  /** Directly seed the cache. Test-only helper; not reachable over HTTP. */
  async primeCache(pkrPerGram: Decimal, source: SourceName, fetchedAt = new Date()): Promise<void> {
    await this.writeCache(roundHalfUp(pkrPerGram, 2), source, fetchedAt);
  }

  // ---------------------------------------------------------------- internals

  private async refresh(): Promise<PriceState> {
    const mode = await this.failureMode();
    const failures: string[] = [];

    for (const [index, source] of this.sources.entries()) {
      const forcedFail =
        mode === 'both' || (mode === 'primary' && (index === 0 || source.name === 'pakgold'));
      if (forcedFail) {
        failures.push(`${source.name}: forced to fail by the demo control`);
        continue;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const raw = await source.fetchPkrPerGram24k(controller.signal);
        const untrustworthy = this.rejectReason(raw);
        if (untrustworthy) {
          // A source that answers with nonsense is worse than one that is down:
          // discard it and fall through, exactly as if it had failed.
          failures.push(`${source.name}: ${untrustworthy}`);
          console.warn(`[pricing] discarding ${source.name} — ${untrustworthy}`);
          continue;
        }
        const fetchedAt = new Date();
        const market = roundHalfUp(raw, 2);
        await this.writeCache(market, source.name, fetchedAt);
        console.log(`[pricing] refreshed from ${source.name}: ${fmtPkr(market)} PKR/g`);
        return {
          freshness: 'LIVE',
          market,
          source: source.name,
          fetchedAt,
          ageSeconds: 0,
          ttlSeconds: this.ttlSeconds,
        };
      } catch (err) {
        const message = err instanceof SourceError ? err.message : (err as Error).message;
        failures.push(`${source.name}: ${message}`);
        console.warn(`[pricing] ${source.name} failed — ${message}`);
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      freshness: 'UNAVAILABLE',
      reason:
        mode === 'both'
          ? 'Both price sources are forced to fail by the demo control. Trading is paused.'
          : 'Both price sources are unreachable. Trading is paused until a trustworthy price returns.',
    } satisfies UnavailablePrice & { reason: string };
  }

  /**
   * Why a fetched value must not be trusted. Returning a *reason* rather than a
   * boolean means the log says which bound was breached.
   */
  private rejectReason(value: Decimal): string | null {
    if (!value.isFinite()) return 'value is not finite';
    if (value.lte(0)) return `value ${value.toString()} is not positive`;
    const min = D(config.priceSanityMin);
    const max = D(config.priceSanityMax);
    if (value.lt(min) || value.gt(max)) {
      return `value ${value.toFixed(2)} PKR/g is outside the sanity band ${min.toFixed(0)}–${max.toFixed(0)}`;
    }
    return null;
  }

  private async awaitRefreshByLockHolder(): Promise<PriceState> {
    const deadline = Date.now() + this.lockTtlMs + 1_000;
    let delay = 15;
    while (Date.now() < deadline) {
      await sleep(delay);
      delay = Math.min(delay * 2, 100);

      const cached = await this.readCache();
      if (cached) return cached;

      const lockHeld = await this.redis.exists(keys.priceLock);
      if (lockHeld === 0) {
        // The holder finished. Either it wrote a price (re-read to close the
        // write/delete race) or it failed — in which case so do we, rather than
        // launching a second stampede at a source we know is down.
        const settled = await this.readCache();
        if (settled) return settled;
        return {
          freshness: 'UNAVAILABLE',
          reason: 'Both price sources are unreachable. Trading is paused until a trustworthy price returns.',
        };
      }
    }
    return {
      freshness: 'UNAVAILABLE',
      reason: 'The price refresh did not complete in time. Trading is paused.',
    };
  }

  private async writeCache(market: Decimal, source: SourceName, fetchedAt: Date): Promise<void> {
    const envelope: CacheEnvelope = {
      pkr_per_gram: fmtPkr(market),
      source,
      fetched_at: fetchedAt.toISOString(),
    };
    await this.redis.set(keys.priceCurrent, JSON.stringify(envelope), 'EX', this.ttlSeconds);
  }

  private async readCache(): Promise<LivePrice | null> {
    const [rawResult, ttlResult] = await this.redis
      .multi()
      .get(keys.priceCurrent)
      .ttl(keys.priceCurrent)
      .exec()
      .then((r) => r ?? []);

    const raw = (rawResult?.[1] ?? null) as string | null;
    const ttl = (ttlResult?.[1] ?? -2) as number;
    if (raw === null) return null;

    let envelope: CacheEnvelope;
    try {
      envelope = JSON.parse(raw) as CacheEnvelope;
    } catch {
      await this.redis.del(keys.priceCurrent);
      return null;
    }

    const market = parseDecimal(envelope.pkr_per_gram);
    const fetchedAt = new Date(envelope.fetched_at);
    if (market === null || Number.isNaN(fetchedAt.getTime()) || this.rejectReason(market) !== null) {
      // Corrupt or now-implausible cache entry: bin it rather than serve it.
      await this.redis.del(keys.priceCurrent);
      return null;
    }

    return {
      freshness: 'LIVE',
      market,
      source: envelope.source,
      fetchedAt,
      ageSeconds: Math.max(0, Math.floor((Date.now() - fetchedAt.getTime()) / 1000)),
      ttlSeconds: ttl >= 0 ? ttl : 0,
    };
  }

  /** Compare-and-delete: never release a lock that has already been taken over. */
  private async releaseLock(token: string): Promise<void> {
    const script = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
    try {
      await this.redis.eval(script, 1, keys.priceLock, token);
    } catch (err) {
      console.warn('[pricing] failed to release price lock:', (err as Error).message);
    }
  }
}

// --- module singleton -------------------------------------------------------
// Routes go through the getter so tests can swap in an engine with fake sources.

let engine: PricingEngine | null = null;

export function getPricingEngine(): PricingEngine {
  if (!engine) engine = new PricingEngine();
  return engine;
}

export function setPricingEngine(next: PricingEngine | null): void {
  engine = next;
}

import { config } from '../config';
import { D, Decimal, perTroyOunceToPerGram } from '../money';
import { getRedis, keys } from '../redis/client';
import { getSourceFailureMode } from '../demo/state';
import { SourceError } from './sources';

/**
 * Rate history.
 *
 * Both series come from GoldPrice.org, which is the only one of our two
 * upstreams that publishes history at all:
 *
 *   GetDataHistorical/PKR-XAU/0   daily closes back to 1998, WITH timestamps
 *   GetData/PKR-XAU/0             a live intraday tail, WITHOUT timestamps
 *
 * Both already quote PKR per troy ounce, so there is no FX leg to source
 * separately and no currency conversion to get wrong — the only normalisation
 * is the same divide-by-31.1034768 the live price uses.
 *
 * (The other upstream, gold-api.com, gates its history endpoint behind an API
 * key — `/history/XAU` answers 401 — so it cannot serve this.)
 */

export type HistoryRange = '1D' | '1W' | '1M' | '1Y';
export const HISTORY_RANGES: readonly HistoryRange[] = ['1D', '1W', '1M', '1Y'];

export function isHistoryRange(v: unknown): v is HistoryRange {
  return typeof v === 'string' && (HISTORY_RANGES as readonly string[]).includes(v);
}

export interface HistoryPoint {
  /** ISO-8601 instant. */
  t: string;
  /** PKR per gram, 24K. */
  v: string;
}

export interface HistorySeries {
  range: HistoryRange;
  points: HistoryPoint[];
  open: string | null;
  close: string | null;
  high: string | null;
  low: string | null;
  change_pct: string | null;
  source: 'goldprice' | null;
  granularity: string;
  /**
   * True for the intraday ranges. GoldPrice's live array carries values only —
   * no timestamps — so points are distributed evenly across the window ending
   * at the latest observation. The SHAPE and the values are real; the x-axis
   * instants are approximate. The daily ranges carry real timestamps.
   */
  approximate_timestamps: boolean;
  as_of: string | null;
  unavailable: boolean;
  reason: string | null;
}

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HISTORY_HEADERS: Record<string, string> = {
  'user-agent': DESKTOP_UA,
  referer: 'https://goldprice.org/',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
};

const INTRADAY_URL = 'https://data-asg.goldprice.org/GetData/PKR-XAU/0';
const DAILY_URL = 'https://data-asg.goldprice.org/GetDataHistorical/PKR-XAU/0';

/**
 * The intraday array is undated. Measured against the dated daily series its
 * high/low band matches roughly the last trading week, so we treat it as a
 * six-day window. Only the x-axis labelling depends on this; every plotted
 * value is exactly as published.
 */
const INTRADAY_WINDOW_DAYS = 6;

/** Target point counts — enough to draw a smooth line, small enough to ship. */
const TARGET_POINTS: Record<HistoryRange, number> = { '1D': 72, '1W': 96, '1M': 60, '1Y': 180 };

/** How long a built series stays cached. Longer ranges move more slowly. */
const CACHE_TTL_SECONDS: Record<HistoryRange, number> = {
  '1D': 300,
  '1W': 900,
  '1M': 3600,
  '1Y': 21600,
};

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Upstream fetching
// ---------------------------------------------------------------------------

async function fetchCsvPayload(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);
  try {
    const res = await fetch(url, { headers: HISTORY_HEADERS, signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new SourceError('goldprice', `${url} returned HTTP ${res.status}`);
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json) || typeof json[0] !== 'string' || json[0].length === 0) {
      throw new SourceError('goldprice', `${url} returned an unexpected payload`);
    }
    return json[0];
  } catch (err) {
    if (err instanceof SourceError) throw err;
    const reason = controller.signal.aborted ? `timed out after ${config.upstreamTimeoutMs}ms` : (err as Error).message;
    throw new SourceError('goldprice', `${url} request failed: ${reason}`, err);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `["PKR-XAU,<v>,<v>,…"]` — PKR per troy ounce, newest last, no timestamps.
 * Consecutive duplicates are padding (each observation repeats ~6x), so they
 * are collapsed; otherwise a flat run would distort the even time spacing.
 */
async function fetchIntraday(): Promise<Decimal[]> {
  const payload = await fetchCsvPayload(INTRADAY_URL);
  const parts = payload.split(',');
  const out: Decimal[] = [];
  let previous: string | null = null;
  for (let i = 1; i < parts.length; i += 1) {
    const raw = parts[i]?.trim();
    if (!raw || raw === previous) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    previous = raw;
    out.push(perTroyOunceToPerGram(D(raw)));
  }
  if (out.length < 2) throw new SourceError('goldprice', 'intraday series had too few usable points');
  return out;
}

export interface DatedPoint {
  atMs: number;
  perGram: Decimal;
}

/**
 * `["PKR-XAU!,<ts>,<v>,<ts>,<v>,…"]` — daily closes, PKR per troy ounce.
 * Timestamps are unix seconds divided by 100.
 */
async function fetchDaily(): Promise<DatedPoint[]> {
  const payload = await fetchCsvPayload(DAILY_URL);
  const body = payload.includes('!,') ? payload.split('!,')[1] : payload.split(',').slice(1).join(',');
  const parts = (body ?? '').split(',');
  const out: DatedPoint[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const ts = Number(parts[i]);
    const value = Number(parts[i + 1]);
    if (!Number.isFinite(ts) || !Number.isFinite(value) || value <= 0) continue;
    out.push({ atMs: ts * 100_000, perGram: perTroyOunceToPerGram(D(parts[i + 1] as string)) });
  }
  if (out.length < 2) throw new SourceError('goldprice', 'daily series had too few usable points');
  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/** Evenly spaced sample that always keeps the first and last observation. */
export function downsample<T>(items: readonly T[], target: number): T[] {
  if (items.length <= target || target < 2) return [...items];
  const out: T[] = [];
  const step = (items.length - 1) / (target - 1);
  for (let i = 0; i < target; i += 1) {
    const item = items[Math.round(i * step)];
    if (item !== undefined) out.push(item);
  }
  return out;
}

export function summarise(range: HistoryRange, points: HistoryPoint[], approximate: boolean): HistorySeries {
  if (points.length === 0) {
    return {
      range,
      points,
      open: null,
      close: null,
      high: null,
      low: null,
      change_pct: null,
      source: 'goldprice',
      granularity: granularityOf(range),
      approximate_timestamps: approximate,
      as_of: null,
      unavailable: true,
      reason: 'No history points were returned.',
    };
  }
  const values = points.map((p) => D(p.v));
  let high = values[0] as Decimal;
  let low = values[0] as Decimal;
  for (const v of values) {
    if (v.greaterThan(high)) high = v;
    if (v.lessThan(low)) low = v;
  }
  const open = values[0] as Decimal;
  const close = values[values.length - 1] as Decimal;
  const changePct = open.isZero() ? D(0) : close.minus(open).dividedBy(open).times(100);

  return {
    range,
    points,
    open: open.toFixed(2),
    close: close.toFixed(2),
    high: high.toFixed(2),
    low: low.toFixed(2),
    change_pct: changePct.toFixed(2),
    source: 'goldprice',
    granularity: granularityOf(range),
    approximate_timestamps: approximate,
    as_of: points[points.length - 1]?.t ?? null,
    unavailable: false,
    reason: null,
  };
}

function granularityOf(range: HistoryRange): string {
  switch (range) {
    case '1D':
      return 'intraday, ~20 minutes per point';
    case '1W':
      return 'intraday, ~90 minutes per point';
    case '1M':
      return 'daily close';
    case '1Y':
      return 'daily close';
  }
}

/** Spread undated intraday values evenly across `windowDays` ending now. */
function dateIntraday(values: readonly Decimal[], windowDays: number, endMs: number): HistoryPoint[] {
  const spanMs = windowDays * MS_PER_DAY;
  const last = values.length - 1;
  return values.map((v, i) => ({
    t: new Date(endMs - ((last - i) / Math.max(last, 1)) * spanMs).toISOString(),
    v: v.toFixed(2),
  }));
}

async function build(range: HistoryRange): Promise<HistorySeries> {
  const now = Date.now();

  if (range === '1D' || range === '1W') {
    const all = await fetchIntraday();
    // The array spans about a week; a day is the final sixth of it.
    const slice = range === '1D' ? all.slice(Math.floor(all.length * (1 - 1 / INTRADAY_WINDOW_DAYS))) : all;
    const windowDays = range === '1D' ? 1 : INTRADAY_WINDOW_DAYS;
    const sampled = downsample(slice, TARGET_POINTS[range]);
    return summarise(range, dateIntraday(sampled, windowDays, now), true);
  }

  const daily = await fetchDaily();
  const cutoff = now - (range === '1M' ? 31 : 366) * MS_PER_DAY;
  const windowed = daily.filter((p) => p.atMs >= cutoff);
  const sampled = downsample(windowed.length >= 2 ? windowed : daily.slice(-2), TARGET_POINTS[range]);
  return summarise(
    range,
    sampled.map((p) => ({ t: new Date(p.atMs).toISOString(), v: p.perGram.toFixed(2) })),
    false,
  );
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function unavailable(range: HistoryRange, reason: string): HistorySeries {
  return {
    range,
    points: [],
    open: null,
    close: null,
    high: null,
    low: null,
    change_pct: null,
    source: null,
    granularity: granularityOf(range),
    approximate_timestamps: range === '1D' || range === '1W',
    as_of: null,
    unavailable: true,
    reason,
  };
}

const cacheKey = (range: HistoryRange): string => `price:history:${range}`;

/**
 * Cached per range. History is a read-only convenience — if it cannot be
 * fetched the caller gets an `unavailable` series and the UI says the chart is
 * unavailable. It never blocks or degrades trading, which depends only on the
 * live price.
 */
export async function getHistory(range: HistoryRange): Promise<HistorySeries> {
  const redis = getRedis();
  const key = cacheKey(range);

  const cached = await redis.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as HistorySeries;
    } catch {
      await redis.del(key);
    }
  }

  // The demo "sources down" toggle covers history too: a reviewer who kills the
  // feeds should not still see a live-looking chart.
  if ((await getSourceFailureMode()) === 'both') {
    return unavailable(range, 'Price sources are unavailable, so the rate history cannot be shown.');
  }

  try {
    const series = await build(range);
    await redis.set(key, JSON.stringify(series), 'EX', CACHE_TTL_SECONDS[range]);
    return series;
  } catch (err) {
    const message = err instanceof SourceError ? err.message : (err as Error).message;
    return unavailable(range, `Rate history is temporarily unavailable (${message}).`);
  }
}

export async function clearHistoryCache(): Promise<void> {
  const redis = getRedis();
  await Promise.all(HISTORY_RANGES.map((r) => redis.del(cacheKey(r))));
}

export const __testing = { build, fetchIntraday, fetchDaily, dateIntraday, granularityOf };

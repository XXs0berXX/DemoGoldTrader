import { config } from '../config';
import { Decimal, parseDecimal, perTroyOunceToPerGram } from '../money';

export type SourceName = 'pakgold' | 'goldprice';

/**
 * Every price source normalises to the same market reference:
 * **PKR per gram, 24K (pure)**.
 *
 * Adapters are behind this interface so (a) tests inject deterministic fakes
 * and (b) the demo failure-injection toggle can force a source to fail without
 * touching the network.
 */
export interface PriceSource {
  readonly name: SourceName;
  /** Resolves to PKR/gram 24K, or throws `SourceError`. */
  fetchPkrPerGram24k(signal: AbortSignal): Promise<Decimal>;
}

export class SourceError extends Error {
  readonly source: SourceName;
  readonly reason: unknown;

  constructor(source: SourceName, message: string, reason?: unknown) {
    super(message);
    this.name = 'SourceError';
    this.source = source;
    this.reason = reason;
  }
}

/** A real desktop UA. goldprice.org returns `Forbidden` without one. */
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchJson(
  source: SourceName,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal, redirect: 'follow' });
  } catch (err) {
    const reason = signal.aborted ? `timed out after ${config.upstreamTimeoutMs}ms` : (err as Error).message;
    throw new SourceError(source, `${url} request failed: ${reason}`, err);
  }
  if (!res.ok) {
    throw new SourceError(source, `${url} returned HTTP ${res.status}`);
  }
  try {
    return (await res.json()) as unknown;
  } catch (err) {
    throw new SourceError(source, `${url} returned a non-JSON body`, err);
  }
}

/** Narrow an unknown JSON value to a Decimal, or throw a schema error. */
function requireDecimal(source: SourceName, value: unknown, path: string): Decimal {
  const d = parseDecimal(typeof value === 'number' ? value : typeof value === 'string' ? value : null);
  if (d === null || !d.isFinite() || d.lte(0)) {
    throw new SourceError(source, `unexpected schema: ${path} was ${JSON.stringify(value)}`);
  }
  return d;
}

function get(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
}

/**
 * PRIMARY — `pakgold`.
 *
 * Replicates pakgold.pk's published method:
 *   XAU (USD per troy ounce, pure) x USD->PKR, divided by 31.1034768.
 * Two upstream calls; either failing fails the source.
 */
export const pakgoldSource: PriceSource = {
  name: 'pakgold',
  async fetchPkrPerGram24k(signal: AbortSignal): Promise<Decimal> {
    const [xauJson, fxJson] = await Promise.all([
      fetchJson('pakgold', 'https://api.gold-api.com/price/XAU', { accept: 'application/json' }, signal),
      fetchJson('pakgold', 'https://open.er-api.com/v6/latest/USD', { accept: 'application/json' }, signal),
    ]);

    const usdPerTroyOunce = requireDecimal('pakgold', get(xauJson, 'price'), 'gold-api .price');
    const pkrPerUsd = requireDecimal('pakgold', get(get(fxJson, 'rates'), 'PKR'), 'er-api .rates.PKR');

    return perTroyOunceToPerGram(usdPerTroyOunce.times(pkrPerUsd));
  },
};

/**
 * FALLBACK — `goldprice`.
 *
 * GoldPrice.org's own feed already quotes PKR per troy ounce, so this needs no
 * FX leg — which is exactly why it is a useful fallback: it fails independently
 * of the exchange-rate provider. The browser UA + Referer are mandatory.
 */
export const goldpriceSource: PriceSource = {
  name: 'goldprice',
  async fetchPkrPerGram24k(signal: AbortSignal): Promise<Decimal> {
    const json = await fetchJson(
      'goldprice',
      'https://data-asg.goldprice.org/dbXRates/PKR',
      {
        'user-agent': DESKTOP_UA,
        referer: 'https://goldprice.org/',
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
      },
      signal,
    );

    const items = get(json, 'items');
    if (!Array.isArray(items) || items.length === 0) {
      throw new SourceError('goldprice', 'unexpected schema: .items was empty or not an array');
    }
    const pkrPerTroyOunce = requireDecimal('goldprice', get(items[0], 'xauPrice'), '.items[0].xauPrice');

    return perTroyOunceToPerGram(pkrPerTroyOunce);
  },
};

/** Ordered by preference: primary first, fallback second. */
export const defaultSources: readonly PriceSource[] = [pakgoldSource, goldpriceSource];

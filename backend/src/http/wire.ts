import { config } from '../config';
import { D, Decimal, fmtPkr } from '../money';
import { derivePricing, isLive, type PriceState } from '../pricing/engine';
import type { SourceName } from '../pricing/sources';

/** `GET /api/price` response, and the same block reused inside demo responses. */
export interface PriceWire {
  trading_enabled: boolean;
  freshness: 'LIVE' | 'UNAVAILABLE';
  market_pkr_per_gram: string | null;
  buy_pkr_per_gram: string | null;
  sell_pkr_per_gram: string | null;
  guardrail_pkr_per_gram: string;
  guardrail_applied: boolean;
  source: SourceName | null;
  fetched_at: string | null;
  age_seconds: number | null;
  ttl_seconds: number | null;
  paused_reason: string | null;
}

export function priceToWire(state: PriceState, guardrail: Decimal): PriceWire {
  if (!isLive(state)) {
    return {
      trading_enabled: false,
      freshness: 'UNAVAILABLE',
      market_pkr_per_gram: null,
      buy_pkr_per_gram: null,
      sell_pkr_per_gram: null,
      guardrail_pkr_per_gram: fmtPkr(guardrail),
      guardrail_applied: false,
      source: null,
      fetched_at: null,
      age_seconds: null,
      ttl_seconds: null,
      paused_reason: state.reason,
    };
  }

  const pricing = derivePricing(state.market, guardrail);
  return {
    trading_enabled: true,
    freshness: 'LIVE',
    market_pkr_per_gram: fmtPkr(pricing.market),
    buy_pkr_per_gram: fmtPkr(pricing.buy),
    sell_pkr_per_gram: fmtPkr(pricing.sell),
    guardrail_pkr_per_gram: fmtPkr(pricing.guardrail),
    guardrail_applied: pricing.guardrailApplied,
    source: state.source,
    fetched_at: state.fetchedAt.toISOString(),
    age_seconds: state.ageSeconds,
    ttl_seconds: state.ttlSeconds,
    paused_reason: null,
  };
}

export interface LimitsWire {
  min_pkr: string;
  max_pkr: string;
  gram_dp: number;
  pkr_dp: number;
}

export function limitsToWire(): LimitsWire {
  return {
    min_pkr: fmtPkr(D(config.minTradePkr)),
    max_pkr: fmtPkr(D(config.maxTradePkr)),
    gram_dp: 4,
    pkr_dp: 2,
  };
}

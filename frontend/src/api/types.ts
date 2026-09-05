/**
 * Wire types for the Gold Trading Demo API.
 *
 * These mirror API_CONTRACT.md exactly. Every money / gram value crosses the
 * wire as a **string** so nothing is corrupted by JS float parsing on the way
 * in. The frontend formats those strings for display and may derive
 * *display-only* estimates from them, but every binding number — the locked
 * price, the grams delivered, the balances after — comes from the server.
 */

export type Side = 'BUY' | 'SELL';
export type Freshness = 'LIVE' | 'UNAVAILABLE';
export type PriceSource = 'pakgold' | 'goldprice';
export type Scenario = 'normal' | 'low_cash' | 'low_gold' | 'low_inventory';
export type SourceFailureMode = 'none' | 'primary' | 'both';

/** `GET /api/price` */
export interface PriceResponse {
  trading_enabled: boolean;
  freshness: Freshness;
  market_pkr_per_gram: string | null;
  buy_pkr_per_gram: string | null;
  sell_pkr_per_gram: string | null;
  guardrail_pkr_per_gram: string;
  guardrail_applied: boolean;
  source: PriceSource | null;
  fetched_at: string | null;
  age_seconds: number | null;
  ttl_seconds: number | null;
  paused_reason: string | null;
}

export interface Balances {
  pkr_wallet: string;
  customer_gold_g: string;
  platform_gold_g: string;
  updated_at?: string;
}

export interface Limits {
  min_pkr: string;
  max_pkr: string;
  gram_dp: number;
  pkr_dp: number;
}

export interface Trade {
  id: string;
  order_id: string;
  side: Side;
  grams: string;
  pkr_amount: string;
  locked_price: string;
  market_reference: string;
  price_source: PriceSource;
  price_fetched_at: string;
  guardrail_applied: boolean;
  created_at: string;
}

/** `GET /api/state` */
export interface StateResponse {
  balances: Balances;
  limits: Limits;
  trades: Trade[];
  scenario: Scenario;
}

/** `POST /api/quote` request — exactly one of `pkr_amount` / `grams`. */
export interface QuoteRequest {
  side: Side;
  pkr_amount?: string;
  grams?: string;
}

/** `POST /api/quote` 200 */
export interface Quote {
  quote_id: string;
  side: Side;
  grams: string;
  pkr_amount: string;
  locked_price_pkr_per_gram: string;
  market_reference: string;
  source: PriceSource;
  price_fetched_at: string;
  guardrail_applied: boolean;
  issued_at: string;
  expires_at: string;
  ttl_seconds: number;
  balances_after: Balances;
}

export interface Receipt {
  order_id: string;
  trade_id: string;
  side: Side;
  grams: string;
  pkr_amount: string;
  locked_price_pkr_per_gram: string;
  market_reference: string;
  price_source: PriceSource;
  guardrail_applied: boolean;
  rounding_note: string;
  settled_at: string;
}

/** `POST /api/confirm` 200 */
export interface ConfirmResponse {
  receipt: Receipt;
  balances: Balances;
  duplicate: boolean;
}

/** `GET /api/demo/status` */
export interface DemoStatus {
  source_failure_mode: SourceFailureMode;
  guardrail_override: string | null;
  scenario: Scenario;
}

/** Machine-readable error codes the UI switches on. */
export type ApiErrorCode =
  | 'TRADING_PAUSED'
  | 'AMOUNT_BELOW_MINIMUM'
  | 'AMOUNT_ABOVE_MAXIMUM'
  | 'INVALID_REQUEST'
  | 'INSUFFICIENT_PKR'
  | 'INSUFFICIENT_GOLD'
  | 'INSUFFICIENT_INVENTORY'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_NOT_FOUND'
  | 'NETWORK'
  | 'UNKNOWN';

/** `details` shape carried by the three insufficiency codes. */
export interface ShortfallDetails {
  required?: string;
  available?: string;
  shortfall?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

import { vi } from 'vitest';
import type {
  ConfirmResponse,
  DemoStatus,
  PriceResponse,
  Quote,
  StateResponse,
} from '../api/types';

/** Fixtures mirroring the seeded demo state in API_CONTRACT.md §1.4. */
export const LIVE_PRICE: PriceResponse = {
  trading_enabled: true,
  freshness: 'LIVE',
  market_pkr_per_gram: '39547.38',
  buy_pkr_per_gram: '43502.12',
  sell_pkr_per_gram: '35592.64',
  guardrail_pkr_per_gram: '30000.00',
  guardrail_applied: false,
  source: 'pakgold',
  fetched_at: '2026-09-05T20:19:32.000Z',
  age_seconds: 12,
  ttl_seconds: 288,
  paused_reason: null,
};

export const PAUSED_PRICE: PriceResponse = {
  trading_enabled: false,
  freshness: 'UNAVAILABLE',
  market_pkr_per_gram: null,
  buy_pkr_per_gram: null,
  sell_pkr_per_gram: null,
  guardrail_pkr_per_gram: '30000.00',
  guardrail_applied: false,
  source: null,
  fetched_at: null,
  age_seconds: null,
  ttl_seconds: null,
  paused_reason: 'Both price sources are unreachable.',
};

export const BASE_STATE: StateResponse = {
  balances: {
    pkr_wallet: '250000.00',
    customer_gold_g: '6.8420',
    platform_gold_g: '100.0000',
    updated_at: '2026-09-05T20:19:32.000Z',
  },
  limits: { min_pkr: '1000.00', max_pkr: '50000.00', gram_dp: 4, pkr_dp: 2 },
  trades: [],
  scenario: 'normal',
};

export const DEMO_STATUS: DemoStatus = {
  source_failure_mode: 'none',
  guardrail_override: null,
  scenario: 'normal',
};

export function makeQuote(overrides: Partial<Quote> = {}): Quote {
  const issued = new Date();
  const expires = new Date(issued.getTime() + 75_000);
  return {
    quote_id: 'q-1',
    side: 'BUY',
    grams: '0.1149',
    pkr_amount: '5000.00',
    locked_price_pkr_per_gram: '43502.12',
    market_reference: '39547.38',
    source: 'pakgold',
    price_fetched_at: LIVE_PRICE.fetched_at as string,
    guardrail_applied: false,
    issued_at: issued.toISOString(),
    expires_at: expires.toISOString(),
    ttl_seconds: 75,
    balances_after: {
      pkr_wallet: '245000.00',
      customer_gold_g: '6.9569',
      platform_gold_g: '99.8851',
    },
    ...overrides,
  };
}

export function makeConfirm(overrides: Partial<ConfirmResponse> = {}): ConfirmResponse {
  return {
    receipt: {
      order_id: 'ORDER-2026-0012345',
      trade_id: 'trade-uuid-1',
      side: 'BUY',
      grams: '0.1149',
      pkr_amount: '5000.00',
      locked_price_pkr_per_gram: '43502.12',
      market_reference: '39547.38',
      price_source: 'pakgold',
      guardrail_applied: false,
      rounding_note: "Grams rounded down to 4 dp in the platform's favour.",
      settled_at: '2026-09-05T20:19:40.000Z',
    },
    balances: {
      pkr_wallet: '245000.00',
      customer_gold_g: '6.9569',
      platform_gold_g: '99.8851',
    },
    duplicate: false,
    ...overrides,
  };
}

export interface MockResult {
  status: number;
  body: unknown;
}

export function ok(body: unknown): MockResult {
  return { status: 200, body };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): MockResult {
  return { status, body: { error: { code, message, details } } };
}

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

export type Handler = (call: RecordedCall) => MockResult | Promise<MockResult>;

export interface FetchMock {
  calls: RecordedCall[];
  /** Calls whose path matches, in order. */
  callsTo(path: string): RecordedCall[];
  fetch: ReturnType<typeof vi.fn>;
}

/**
 * Installs a `fetch` double over the whole API surface. Unit tests never need a
 * live backend; every route can be swapped per test.
 */
export function installFetchMock(handlers: Partial<Record<string, Handler>> = {}): FetchMock {
  const defaults: Record<string, Handler> = {
    'GET /api/price': () => ok(LIVE_PRICE),
    'GET /api/state': () => ok(BASE_STATE),
    'GET /api/demo/status': () => ok(DEMO_STATUS),
    'POST /api/quote': () => ok(makeQuote()),
    'POST /api/confirm': () => ok(makeConfirm()),
    'POST /api/demo/source-failure': () => ok({}),
    'POST /api/demo/guardrail': () => ok({}),
    'POST /api/demo/scenario': () => ok({}),
  };
  const table = { ...defaults, ...handlers };
  const calls: RecordedCall[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const call: RecordedCall = { method, path, body };
    calls.push(call);

    const handler = table[`${method} ${path}`];
    if (!handler) {
      return makeResponse({ status: 404, body: { error: { code: 'UNKNOWN', message: `No mock for ${method} ${path}` } } });
    }
    return makeResponse(await handler(call));
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    calls,
    callsTo: (path: string) => calls.filter((c) => c.path === path),
    fetch: fetchMock,
  };
}

function makeResponse(result: MockResult): Response {
  const text = JSON.stringify(result.body);
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

/** A promise you can settle from the test body — for in-flight assertions. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

import type {
  ApiErrorBody,
  ApiErrorCode,
  ConfirmResponse,
  DemoStatus,
  PriceResponse,
  Quote,
  QuoteRequest,
  Scenario,
  ShortfallDetails,
  SourceFailureMode,
  StateResponse,
} from './types';

/**
 * A failed API call, normalised so the UI can switch on `code` and show
 * `message` verbatim. Network/parse failures are folded into the same shape
 * with code `NETWORK` so no call site ever has to deal with two error kinds.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Typed accessor for the `{ required, available, shortfall }` payload. */
  get shortfall(): ShortfallDetails {
    const d = this.details;
    return {
      required: typeof d.required === 'string' ? d.required : undefined,
      available: typeof d.available === 'string' ? d.available : undefined,
      shortfall: typeof d.shortfall === 'string' ? d.shortfall : undefined,
    };
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'TRADING_PAUSED',
  'AMOUNT_BELOW_MINIMUM',
  'AMOUNT_ABOVE_MAXIMUM',
  'INVALID_REQUEST',
  'INSUFFICIENT_PKR',
  'INSUFFICIENT_GOLD',
  'INSUFFICIENT_INVENTORY',
  'QUOTE_EXPIRED',
  'QUOTE_NOT_FOUND',
]);

function toCode(raw: unknown): ApiErrorCode {
  return typeof raw === 'string' && KNOWN_CODES.has(raw)
    ? (raw as ApiErrorCode)
    : 'UNKNOWN';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      // Quotes are keyed to an httpOnly `asasa_sid` cookie the backend issues,
      // so the session cookie has to ride along on every call.
      credentials: 'same-origin',
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(
      'NETWORK',
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const body = parsed as ApiErrorBody | null;
    const err = body?.error;
    throw new ApiError(
      toCode(err?.code),
      err?.message ?? `Request failed (${res.status}).`,
      res.status,
      err?.details ?? {},
    );
  }

  return parsed as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export const api = {
  getPrice: (): Promise<PriceResponse> => request<PriceResponse>('/api/price'),

  getState: (): Promise<StateResponse> => request<StateResponse>('/api/state'),

  createQuote: (req: QuoteRequest): Promise<Quote> =>
    postJson<Quote>('/api/quote', req),

  confirm: (quoteId: string): Promise<ConfirmResponse> =>
    postJson<ConfirmResponse>('/api/confirm', { quote_id: quoteId }),

  demo: {
    getStatus: (): Promise<DemoStatus> => request<DemoStatus>('/api/demo/status'),

    setSourceFailure: (mode: SourceFailureMode): Promise<unknown> =>
      postJson('/api/demo/source-failure', { mode }),

    setGuardrail: (pkrPerGram: string): Promise<unknown> =>
      postJson('/api/demo/guardrail', { pkr_per_gram: pkrPerGram }),

    resetGuardrail: (): Promise<unknown> =>
      postJson('/api/demo/guardrail', { reset: true }),

    setScenario: (scenario: Scenario): Promise<unknown> =>
      postJson('/api/demo/scenario', { scenario }),
  },
};

export type Api = typeof api;

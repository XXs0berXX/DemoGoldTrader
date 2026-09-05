/**
 * Every failure the client can see is an ApiError, so the wire envelope from
 * API_CONTRACT.md §4 is produced in exactly one place (the error middleware).
 */
export type ErrorDetails = Record<string, unknown>;

export interface ErrorEnvelope {
  error: { code: string; message: string; details: ErrorDetails };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetails;

  constructor(status: number, code: string, message: string, details?: ErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }

  toEnvelope(): ErrorEnvelope {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const invalidRequest = (message: string, details?: ErrorDetails): ApiError =>
  new ApiError(400, 'INVALID_REQUEST', message, details);

export const tradingPaused = (reason: string): ApiError => new ApiError(409, 'TRADING_PAUSED', reason);

export const quoteExpired = (): ApiError =>
  new ApiError(
    410,
    'QUOTE_EXPIRED',
    'This quote has expired. Gold prices move, so we will not settle at the old rate — get a fresh quote to continue.',
  );

export const quoteNotFound = (): ApiError =>
  new ApiError(
    404,
    'QUOTE_NOT_FOUND',
    'We could not find that quote. It may belong to a different browser session. Start a new one to continue.',
  );

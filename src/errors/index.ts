export type ErrorCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'payload_too_large'
  | 'provider_unavailable'
  | 'service_unavailable'
  | 'internal_error';

/** An error whose message is safe to show to API clients. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  invalidRequest: (message: string, details?: Record<string, unknown>) =>
    new AppError('invalid_request', 400, message, details),
  unauthorized: (message = 'Authentication required') =>
    new AppError('unauthorized', 401, message, undefined, { 'WWW-Authenticate': 'Bearer' }),
  forbidden: (message = 'Insufficient permissions') => new AppError('forbidden', 403, message),
  notFound: (message: string, details?: Record<string, unknown>) =>
    new AppError('not_found', 404, message, details),
  conflict: (message: string) => new AppError('conflict', 409, message),
  payloadTooLarge: () => new AppError('payload_too_large', 413, 'Request body is too large'),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError('rate_limited', 429, 'Too many requests', { retry_after_seconds: retryAfterSeconds }, {
      'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
    }),
  providerUnavailable: () =>
    new AppError('provider_unavailable', 503, 'Metadata providers are temporarily unavailable'),
  serviceUnavailable: () => new AppError('service_unavailable', 503, 'Service temporarily unavailable'),
};

/** Internal failure (database, storage). Never shown to clients; logged server-side only. */
export class InfrastructureError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'InfrastructureError';
  }
}

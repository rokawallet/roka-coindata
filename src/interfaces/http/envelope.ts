import { NextResponse } from 'next/server';
import { AppError, InfrastructureError } from '@/errors';
import { serializeError } from '@/infrastructure/logging/logger';
import type { Logger } from '@/infrastructure/logging/logger';

export interface SuccessBody {
  success: true;
  data: unknown;
  metadata: Record<string, unknown>;
  request_id: string;
}

export interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
  request_id: string;
}

export function successResponse(
  data: unknown,
  metadata: Record<string, unknown>,
  requestId: string,
  status: number,
  headers: Record<string, string>,
): NextResponse {
  const body: SuccessBody = { success: true, data, metadata, request_id: requestId };
  return NextResponse.json(body, { status, headers });
}

/** Maps any thrown value to a safe error response. Internal details are logged, never returned. */
export function errorResponse(error: unknown, requestId: string, logger: Logger, extra: Record<string, string> = {}): NextResponse {
  let status = 500;
  let code = 'internal_error';
  let message = 'Internal server error';
  let details: Record<string, unknown> | undefined;
  let headers: Record<string, string> = {};

  if (error instanceof AppError) {
    status = error.status;
    code = error.code;
    message = error.message;
    details = error.details;
    headers = error.headers ?? {};
    if (status >= 500) logger.error('request failed', { code, ...serializeError(error) });
  } else if (error instanceof InfrastructureError) {
    status = 503;
    code = 'service_unavailable';
    message = 'Service temporarily unavailable';
    logger.error('infrastructure failure', serializeError(error));
  } else {
    logger.error('unhandled error', serializeError(error));
  }

  const body: ErrorBody = {
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    request_id: requestId,
  };
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId, ...extra, ...headers },
  });
}

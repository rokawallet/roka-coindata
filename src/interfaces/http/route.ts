import { after } from 'next/server';
import type { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { getContainer } from '@/infrastructure/container';
import type { Container } from '@/infrastructure/container';
import { errors, AppError } from '@/errors';
import { serializeError, silentLogger } from '@/infrastructure/logging/logger';
import type { Logger } from '@/infrastructure/logging/logger';
import { parse } from '@/validation/schemas';
import { resolvePrincipal } from './auth';
import type { Principal } from './auth';
import { errorResponse, successResponse } from './envelope';

export type RateLimitPolicy = 'public' | 'discovery' | 'admin';

export interface RouteConfig {
  auth: 'public' | 'admin';
  rateLimit: RateLimitPolicy;
}

export interface HttpContext {
  request: NextRequest;
  requestId: string;
  params: Record<string, string>;
  query: URLSearchParams;
  principal: Principal | null;
  container: Container;
  logger: Logger;
  /** Runs work after the response is sent (stale-while-revalidate). */
  background: (task: () => Promise<void>) => void;
  readJson<S extends z.ZodTypeAny>(schema: S): Promise<z.output<S>>;
}

export interface HandlerResult {
  data: unknown;
  metadata?: Record<string, unknown>;
  status?: number;
  headers?: Record<string, string>;
}

export type RouteHandler = (ctx: HttpContext) => Promise<HandlerResult>;
export type RouteContext = { params: Promise<Record<string, string>> };

/** Cache header for responses that may be shared by the CDN (cache hits only). */
export const PUBLIC_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600';

function clientIpHash(request: NextRequest, pepper: string): string {
  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return createHash('sha256').update(`${pepper}:${ip}`).digest('hex').slice(0, 32);
}

async function readBodyCapped(request: NextRequest, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw errors.payloadTooLarge();
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    throw errors.invalidRequest('Content-Type must be application/json');
  }
  const reader = request.body?.getReader();
  if (!reader) throw errors.invalidRequest('Request body is required');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw errors.payloadTooLarge();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw errors.invalidRequest('Body must be valid JSON');
  }
}

/**
 * Wraps a handler with request ids, authentication, rate limiting, validation helpers,
 * the response envelope and safe error mapping. Handlers contain no HTTP plumbing.
 */
export function createRoute(config: RouteConfig, handler: RouteHandler) {
  return async (request: NextRequest, routeCtx: RouteContext): Promise<NextResponse> => {
    const requestId = randomUUID();
    const started = Date.now();
    let container: Container;
    try {
      container = getContainer();
    } catch (error) {
      // Misconfiguration: log details server-side, reveal nothing to the client.
      console.error(JSON.stringify({ level: 'error', msg: 'container init failed', request_id: requestId, ...serializeError(error) }));
      return errorResponse(errors.serviceUnavailable(), requestId, silentLogger);
    }
    const logger = container.logger.child({ request_id: requestId, method: request.method, path: request.nextUrl.pathname });

    try {
      const env = container.env;
      const ipHash = clientIpHash(request, env.API_KEY_PEPPER);

      let principal: Principal | null;
      try {
        principal = await resolvePrincipal(request.headers, container.apiKeys, env.API_KEY_PEPPER, container.now());
      } catch (error) {
        if (error instanceof AppError && error.status === 401) await throttleAuthFailures(container, ipHash);
        throw error;
      }
      if (config.auth === 'admin') {
        if (!principal) {
          await throttleAuthFailures(container, ipHash);
          throw errors.unauthorized();
        }
        if (!principal.scopes.includes('admin')) throw errors.forbidden();
      }

      const limit =
        config.rateLimit === 'admin'
          ? env.RATE_LIMIT_ADMIN_PER_MINUTE
          : config.rateLimit === 'discovery'
            ? principal ? env.RATE_LIMIT_DISCOVERY_SERVICE_PER_MINUTE : env.RATE_LIMIT_DISCOVERY_PER_MINUTE
            : principal ? env.RATE_LIMIT_SERVICE_PER_MINUTE : env.RATE_LIMIT_PUBLIC_PER_MINUTE;
      const subject = principal ? `key:${principal.id}` : `ip:${ipHash}`;
      const rate = await container.rateLimiter.hit(`${config.rateLimit}:${subject}`, limit, 60);
      const rateHeaders = {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(rate.remaining),
        'X-RateLimit-Reset': String(Math.ceil(rate.resetAt.getTime() / 1000)),
      };
      if (!rate.allowed) {
        const retryAfter = Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000));
        const denied = errors.rateLimited(retryAfter);
        return errorResponse(denied, requestId, logger, rateHeaders);
      }

      const result = await handler({
        request,
        requestId,
        params: (await routeCtx?.params) ?? {},
        query: request.nextUrl.searchParams,
        principal,
        container,
        logger,
        background: (task) => after(task),
        readJson: async (schema) => parse(schema, await readBodyCapped(request, env.MAX_BODY_BYTES)),
      });

      logger.info('request completed', { status: result.status ?? 200, duration_ms: Date.now() - started });
      return successResponse(result.data, result.metadata ?? {}, requestId, result.status ?? 200, {
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
        ...rateHeaders,
        ...result.headers,
      });
    } catch (error) {
      return errorResponse(error, requestId, logger);
    }
  };
}

async function throttleAuthFailures(container: Container, ipHash: string): Promise<void> {
  const result = await container.rateLimiter.hit(`authfail:${ipHash}`, 20, 60);
  if (!result.allowed) {
    throw errors.rateLimited(Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)));
  }
}

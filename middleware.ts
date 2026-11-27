import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * CORS and baseline security headers for API routes.
 * Admin and cron endpoints never receive CORS headers: they are for server-to-server use only.
 * Only the Edge-safe process.env is read here; no application code is imported.
 */
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const serverOnly = path.startsWith('/api/v1/admin') || path.startsWith('/api/cron');
  const origin = request.headers.get('origin');
  const allowed = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const wildcard = allowed.includes('*');
  const originAllowed = !serverOnly && origin !== null && (wildcard || allowed.includes(origin));

  const response =
    request.method === 'OPTIONS' ? new NextResponse(null, { status: 204 }) : NextResponse.next();

  if (originAllowed) {
    response.headers.set('Access-Control-Allow-Origin', wildcard ? '*' : origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.headers.set('Access-Control-Expose-Headers', 'X-Request-Id, X-RateLimit-Remaining, Retry-After');
    response.headers.set('Access-Control-Max-Age', '86400');
    if (!wildcard) response.headers.append('Vary', 'Origin');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  return response;
}

export const config = { matcher: ['/api/:path*', '/health'] };

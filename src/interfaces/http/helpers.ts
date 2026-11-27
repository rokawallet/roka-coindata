import { errors } from '@/errors';
import type { CoinResult } from '@/application/metadata/metadata-service';
import { PUBLIC_CACHE } from './route';
import type { HandlerResult, HttpContext } from './route';
import { toCoinDto } from './dto';

export function pageMetadata(page: number, limit: number, total: number): Record<string, unknown> {
  return { pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) } };
}

export function coinResult(ctx: HttpContext, result: CoinResult): HandlerResult {
  return {
    data: toCoinDto(result.asset, result.chain, ctx.container.fallbackLogoUrl),
    metadata: { cache: result.cache },
    // Only fully fresh hits are CDN-cacheable; misses and stale responses are not.
    headers: result.cache === 'hit' ? { 'Cache-Control': PUBLIC_CACHE } : undefined,
  };
}

export function actorOf(ctx: HttpContext): string {
  if (!ctx.principal) throw errors.unauthorized();
  return ctx.principal.name;
}

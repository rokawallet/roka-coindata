import { createRoute } from '@/interfaces/http/route';
import { coinResult } from '@/interfaces/http/helpers';
import { chainIdSchema, parse } from '@/validation/schemas';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const GET = createRoute({ auth: 'public', rateLimit: 'public' }, async (ctx) => {
  const chainId = parse(chainIdSchema, ctx.params.chainId);
  return coinResult(ctx, await ctx.container.metadata.getNative({ chainId, background: ctx.background }));
});

import { createRoute } from '@/interfaces/http/route';
import { coinResult } from '@/interfaces/http/helpers';
import { addressSchema, chainIdSchema, parse } from '@/validation/schemas';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const GET = createRoute({ auth: 'public', rateLimit: 'public' }, async (ctx) => {
  const chainId = parse(chainIdSchema, ctx.params.chainId);
  const address = parse(addressSchema, ctx.params.address);
  const result = await ctx.container.metadata.getToken({
    chainId,
    address,
    allowDiscovery: ctx.container.env.PUBLIC_DISCOVERY_ENABLED,
    background: ctx.background,
  });
  return coinResult(ctx, result);
});

import { createRoute } from '@/interfaces/http/route';
import { coinResult } from '@/interfaces/http/helpers';
import { discoverBodySchema } from '@/validation/schemas';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Discovers metadata for a token not yet in the database. Stricter rate limit than reads. */
export const POST = createRoute({ auth: 'public', rateLimit: 'discovery' }, async (ctx) => {
  const body = await ctx.readJson(discoverBodySchema);
  const result = await ctx.container.metadata.getToken({
    chainId: body.chain_id,
    address: body.contract_address,
    allowDiscovery: true,
    background: ctx.background,
  });
  const out = coinResult(ctx, result);
  return { ...out, status: result.cache === 'miss' ? 201 : 200, headers: undefined };
});

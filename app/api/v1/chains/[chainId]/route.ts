import { createRoute, PUBLIC_CACHE } from '@/interfaces/http/route';
import { toChainDto } from '@/interfaces/http/dto';
import { errors } from '@/errors';
import { chainIdSchema, parse } from '@/validation/schemas';

export const runtime = 'nodejs';

export const GET = createRoute({ auth: 'public', rateLimit: 'public' }, async (ctx) => {
  const chainId = parse(chainIdSchema, ctx.params.chainId);
  const chain = await ctx.container.chains.findByChainId(chainId);
  if (!chain || !chain.is_active) throw errors.notFound('Chain is not supported');
  return { data: toChainDto(chain), headers: { 'Cache-Control': PUBLIC_CACHE } };
});

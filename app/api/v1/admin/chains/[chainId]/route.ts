import { createRoute } from '@/interfaces/http/route';
import { toChainDto } from '@/interfaces/http/dto';
import { actorOf } from '@/interfaces/http/helpers';
import { chainIdSchema, chainUpdateSchema, parse } from '@/validation/schemas';

export const runtime = 'nodejs';

export const PATCH = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const chainId = parse(chainIdSchema, ctx.params.chainId);
  const body = await ctx.readJson(chainUpdateSchema);
  return { data: toChainDto(await ctx.container.admin.updateChain(actorOf(ctx), chainId, body)) };
});

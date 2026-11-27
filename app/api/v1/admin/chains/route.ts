import { createRoute } from '@/interfaces/http/route';
import { toChainDto } from '@/interfaces/http/dto';
import { actorOf } from '@/interfaces/http/helpers';
import { chainCreateSchema } from '@/validation/schemas';

export const runtime = 'nodejs';

export const GET = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const chains = await ctx.container.chains.list();
  return { data: chains.map((c) => ({ ...toChainDto(c), provider_ids: {
    coingecko_platform: c.coingecko_platform_id, coingecko_native: c.coingecko_native_id, geckoterminal_network: c.geckoterminal_network_id } })) };
});

export const POST = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const body = await ctx.readJson(chainCreateSchema);
  const chain = await ctx.container.admin.createChain(actorOf(ctx), body);
  return { data: toChainDto(chain), status: 201 };
});

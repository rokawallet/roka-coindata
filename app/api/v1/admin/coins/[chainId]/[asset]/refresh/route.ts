import { createRoute } from '@/interfaces/http/route';
import { toAdminCoinDto } from '@/interfaces/http/dto';
import { actorOf } from '@/interfaces/http/helpers';
import { assetRefSchema, chainIdSchema, parse } from '@/validation/schemas';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const POST = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const chainId = parse(chainIdSchema, ctx.params.chainId);
  const ref = parse(assetRefSchema, ctx.params.asset);
  const { asset, skipped } = await ctx.container.admin.refreshNow(actorOf(ctx), chainId, ref);
  const { chain } = await ctx.container.admin.requireAsset(chainId, ref);
  return { data: toAdminCoinDto(asset, chain, ctx.container.fallbackLogoUrl), metadata: { skipped } };
});

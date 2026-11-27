import { createRoute } from '@/interfaces/http/route';
import { toAdminCoinDto } from '@/interfaces/http/dto';
import { actorOf } from '@/interfaces/http/helpers';
import { assetRefSchema, chainIdSchema, overrideBodySchema, parse, toMetadataFields } from '@/validation/schemas';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const PUT = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const chainId = parse(chainIdSchema, ctx.params.chainId);
  const ref = parse(assetRefSchema, ctx.params.asset);
  const { reason, ...fields } = await ctx.readJson(overrideBodySchema);
  const asset = await ctx.container.admin.setOverride(actorOf(ctx), chainId, ref, toMetadataFields(fields), reason);
  const { chain } = await ctx.container.admin.requireAsset(chainId, ref);
  return { data: toAdminCoinDto(asset, chain, ctx.container.fallbackLogoUrl) };
});

export const DELETE = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const chainId = parse(chainIdSchema, ctx.params.chainId);
  const ref = parse(assetRefSchema, ctx.params.asset);
  const asset = await ctx.container.admin.removeOverride(actorOf(ctx), chainId, ref);
  const { chain } = await ctx.container.admin.requireAsset(chainId, ref);
  return { data: toAdminCoinDto(asset, chain, ctx.container.fallbackLogoUrl) };
});

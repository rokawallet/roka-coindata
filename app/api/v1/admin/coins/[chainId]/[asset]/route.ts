import { createRoute } from '@/interfaces/http/route';
import { toAdminCoinDto } from '@/interfaces/http/dto';
import { actorOf } from '@/interfaces/http/helpers';
import { assetRefSchema, chainIdSchema, parse, verificationBodySchema } from '@/validation/schemas';

export const runtime = 'nodejs';

export const GET = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const { chain, asset } = await ctx.container.admin.requireAsset(
    parse(chainIdSchema, ctx.params.chainId), parse(assetRefSchema, ctx.params.asset));
  const [mappings, override] = await Promise.all([
    ctx.container.assets.getMappings(asset.id),
    ctx.container.assets.getOverride(asset.id),
  ]);
  return { data: { ...toAdminCoinDto(asset, chain, ctx.container.fallbackLogoUrl), provider_mappings: mappings, override } };
});

export const PATCH = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const chainId = parse(chainIdSchema, ctx.params.chainId);
  const ref = parse(assetRefSchema, ctx.params.asset);
  const body = await ctx.readJson(verificationBodySchema);
  const asset = await ctx.container.admin.setVerification(actorOf(ctx), chainId, ref, body.verification_status);
  const chain = await ctx.container.admin.requireAsset(chainId, ref);
  return { data: toAdminCoinDto(asset, chain.chain, ctx.container.fallbackLogoUrl) };
});

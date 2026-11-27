import { createRoute } from '@/interfaces/http/route';
import { toAdminCoinDto } from '@/interfaces/http/dto';
import { actorOf, pageMetadata } from '@/interfaces/http/helpers';
import { adminCoinListQuerySchema, parse, registerAssetBodySchema, toMetadataFields } from '@/validation/schemas';

export const runtime = 'nodejs';

export const GET = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const q = parse(adminCoinListQuerySchema, Object.fromEntries(ctx.query));
  const { items, total } = await ctx.container.assets.list(
    { chainIds: q.chain_id ? [q.chain_id] : undefined, verification: q.verification_status },
    q.page,
    q.limit,
  );
  const chains = new Map((await ctx.container.chains.list()).map((c) => [c.chain_id, c]));
  const data = items.flatMap((a) => {
    const chain = chains.get(a.chain_id);
    return chain ? [toAdminCoinDto(a, chain, ctx.container.fallbackLogoUrl)] : [];
  });
  return { data, metadata: pageMetadata(q.page, q.limit, total) };
});

/** Registers an official asset (omit contract_address for a native asset). */
export const POST = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const body = await ctx.readJson(registerAssetBodySchema);
  const ref = body.contract_address ? ({ kind: 'token', address: body.contract_address } as const) : ({ kind: 'native' } as const);
  const asset = await ctx.container.admin.registerOfficialAsset(
    actorOf(ctx), body.chain_id, ref, toMetadataFields(body), body.verification_status, body.reason,
  );
  const chain = await ctx.container.chains.findByChainId(asset.chain_id);
  return { data: chain ? toAdminCoinDto(asset, chain, ctx.container.fallbackLogoUrl) : null, status: 201 };
});

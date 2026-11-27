import { createRoute } from '@/interfaces/http/route';
import { toAdminCoinDto } from '@/interfaces/http/dto';
import { pageMetadata } from '@/interfaces/http/helpers';
import { paginationSchema, parse } from '@/validation/schemas';

export const runtime = 'nodejs';

/** Discovered tokens awaiting review (verification_status = unverified), newest first. */
export const GET = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const q = parse(paginationSchema, Object.fromEntries(ctx.query));
  const { items, total } = await ctx.container.assets.list({ verification: 'unverified' }, q.page, q.limit);
  const chains = new Map((await ctx.container.chains.list()).map((c) => [c.chain_id, c]));
  const data = items.flatMap((a) => {
    const chain = chains.get(a.chain_id);
    return chain ? [toAdminCoinDto(a, chain, ctx.container.fallbackLogoUrl)] : [];
  });
  return { data, metadata: pageMetadata(q.page, q.limit, total) };
});

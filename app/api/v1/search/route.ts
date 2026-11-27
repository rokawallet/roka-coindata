import { createRoute } from '@/interfaces/http/route';
import { toCoinDto } from '@/interfaces/http/dto';
import { pageMetadata } from '@/interfaces/http/helpers';
import { parse, searchQuerySchema } from '@/validation/schemas';

export const runtime = 'nodejs';

export const GET = createRoute({ auth: 'public', rateLimit: 'public' }, async (ctx) => {
  const q = parse(searchQuerySchema, Object.fromEntries(ctx.query));
  const { items, total } = await ctx.container.search.search(q.q, q.chain, q.page, q.limit);
  const chains = await ctx.container.chains.list({ activeOnly: true });
  const byId = new Map(chains.map((c) => [c.chain_id, c]));
  const data = items.flatMap((a) => {
    const chain = byId.get(a.chain_id);
    return chain ? [toCoinDto(a, chain, ctx.container.fallbackLogoUrl)] : [];
  });
  return { data, metadata: pageMetadata(q.page, q.limit, total) };
});

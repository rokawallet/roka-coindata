import { createRoute } from '@/interfaces/http/route';
import { toCoinDto } from '@/interfaces/http/dto';
import { pageMetadata } from '@/interfaces/http/helpers';
import { errors } from '@/errors';
import { coinListQuerySchema, parse } from '@/validation/schemas';

export const runtime = 'nodejs';

export const GET = createRoute({ auth: 'public', rateLimit: 'public' }, async (ctx) => {
  const q = parse(coinListQuerySchema, Object.fromEntries(ctx.query));
  const chains = await ctx.container.chains.list({ activeOnly: true });
  let selected = chains;
  if (q.chain) {
    selected = chains.filter((c) => String(c.chain_id) === q.chain || c.slug === q.chain.toLowerCase());
    if (selected.length === 0) throw errors.invalidRequest('Unknown or inactive chain filter');
  }
  const { items, total } = await ctx.container.assets.list(
    { chainIds: selected.map((c) => c.chain_id), excludeRejected: true },
    q.page,
    q.limit,
  );
  const byId = new Map(chains.map((c) => [c.chain_id, c]));
  const data = items.flatMap((a) => {
    const chain = byId.get(a.chain_id);
    return chain ? [toCoinDto(a, chain, ctx.container.fallbackLogoUrl)] : [];
  });
  return { data, metadata: pageMetadata(q.page, q.limit, total) };
});

import { createRoute, PUBLIC_CACHE } from '@/interfaces/http/route';
import { toChainDto } from '@/interfaces/http/dto';

export const runtime = 'nodejs';

export const GET = createRoute({ auth: 'public', rateLimit: 'public' }, async (ctx) => {
  const chains = await ctx.container.chains.list({ activeOnly: true });
  return { data: chains.map(toChainDto), metadata: { count: chains.length }, headers: { 'Cache-Control': PUBLIC_CACHE } };
});

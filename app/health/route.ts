import { createRoute } from '@/interfaces/http/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createRoute({ auth: 'public', rateLimit: 'public' }, async (ctx) => {
  await ctx.container.chains.list({ activeOnly: true }); // throws (503) if the database is unreachable
  return { data: { status: 'ok' } };
});

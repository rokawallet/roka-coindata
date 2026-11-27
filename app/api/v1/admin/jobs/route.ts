import { createRoute } from '@/interfaces/http/route';
import { toJobDto } from '@/interfaces/http/dto';
import { pageMetadata } from '@/interfaces/http/helpers';
import { jobListQuerySchema, parse } from '@/validation/schemas';

export const runtime = 'nodejs';

export const GET = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const q = parse(jobListQuerySchema, Object.fromEntries(ctx.query));
  const { items, total } = await ctx.container.jobs.list({ status: q.status }, q.page, q.limit);
  return { data: items.map(toJobDto), metadata: pageMetadata(q.page, q.limit, total) };
});

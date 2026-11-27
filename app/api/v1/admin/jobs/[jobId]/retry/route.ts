import { z } from 'zod';
import { createRoute } from '@/interfaces/http/route';
import { toJobDto } from '@/interfaces/http/dto';
import { actorOf } from '@/interfaces/http/helpers';
import { parse } from '@/validation/schemas';

export const runtime = 'nodejs';

export const POST = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const jobId = parse(z.string().uuid(), ctx.params.jobId);
  return { data: toJobDto(await ctx.container.admin.retryJob(actorOf(ctx), jobId)) };
});

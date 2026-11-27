import { createRoute } from '@/interfaces/http/route';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Recorded provider health. Add ?probe=true to run a live liveness check (uses provider quota). */
export const GET = createRoute({ auth: 'admin', rateLimit: 'admin' }, async (ctx) => {
  const probes = ctx.query.get('probe') === 'true' ? await ctx.container.orchestrator.probeAll() : undefined;
  const health = await ctx.container.health.list();
  return { data: { providers: health, probes: probes ?? null, order: ctx.container.env.providerOrder } };
});

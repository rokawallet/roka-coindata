import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getContainer } from '@/infrastructure/container';
import { serializeError, createLogger } from '@/infrastructure/logging/logger';
import { safeEqual } from '@/security/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Anything else is rejected. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  const log = createLogger({ request_id: requestId, job: 'cron-refresh' });
  try {
    const c = getContainer();
    const header = request.headers.get('authorization') ?? '';
    if (!safeEqual(header, `Bearer ${c.env.CRON_SECRET}`)) {
      return NextResponse.json({ success: false, error: { code: 'unauthorized', message: 'Unauthorized' }, request_id: requestId }, { status: 401 });
    }
    const report = await c.refresh.runScheduledBatch();
    await c.rateLimiter.cleanup();
    log.info('scheduled refresh finished', { ...report });
    return NextResponse.json({ success: true, data: report, metadata: {}, request_id: requestId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    log.error('scheduled refresh failed', serializeError(error));
    return NextResponse.json({ success: false, error: { code: 'internal_error', message: 'Internal server error' }, request_id: requestId }, { status: 500 });
  }
}

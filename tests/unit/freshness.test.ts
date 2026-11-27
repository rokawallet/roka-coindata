import { describe, expect, it } from 'vitest';
import { backoffSeconds, isStale, nextRefreshAfterSuccess, tierFor, unknownTokenCooldownSeconds } from '@/domain/freshness';
import { POLICY } from '../helpers/fakes';

const now = new Date('2026-06-01T00:00:00Z');

describe('freshness', () => {
  it('assigns tiers', () => {
    expect(tierFor({ verification_status: 'verified', asset_type: 'token', coingecko_id: null })).toBe('verified');
    expect(tierFor({ verification_status: 'unverified', asset_type: 'native', coingecko_id: null })).toBe('established');
    expect(tierFor({ verification_status: 'unverified', asset_type: 'token', coingecko_id: 'usd-coin' })).toBe('established');
    expect(tierFor({ verification_status: 'unverified', asset_type: 'token', coingecko_id: null })).toBe('discovered');
  });
  it('schedules by tier', () => {
    expect(nextRefreshAfterSuccess('verified', now, POLICY).getTime() - now.getTime()).toBe(100_000);
    expect(nextRefreshAfterSuccess('discovered', now, POLICY).getTime() - now.getTime()).toBe(300_000);
  });
  it('detects staleness', () => {
    expect(isStale({ next_refresh_at: '2026-05-31T00:00:00Z' }, now)).toBe(true);
    expect(isStale({ next_refresh_at: '2026-06-02T00:00:00Z' }, now)).toBe(false);
  });
  it('backs off exponentially with a cap', () => {
    expect([1, 2, 3, 4, 50].map((n) => backoffSeconds(n, POLICY))).toEqual([10, 20, 40, 80, 100]);
    expect(unknownTokenCooldownSeconds(3, 60, 600)).toBe(240);
    expect(unknownTokenCooldownSeconds(30, 60, 600)).toBe(600);
  });
});

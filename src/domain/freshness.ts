import type { Asset } from './types';

export interface FreshnessPolicy {
  verifiedSeconds: number;
  establishedSeconds: number;
  discoveredSeconds: number;
  failureBackoffSeconds: number;
  maxBackoffSeconds: number;
}

export type RefreshTier = 'verified' | 'established' | 'discovered';

/** verified: official/admin-approved. established: native assets and assets known to CoinGecko. */
export function tierFor(asset: Pick<Asset, 'verification_status' | 'asset_type' | 'coingecko_id'>): RefreshTier {
  if (asset.verification_status === 'verified') return 'verified';
  if (asset.asset_type === 'native' || asset.coingecko_id) return 'established';
  return 'discovered';
}

export function refreshIntervalSeconds(tier: RefreshTier, policy: FreshnessPolicy): number {
  return tier === 'verified'
    ? policy.verifiedSeconds
    : tier === 'established'
      ? policy.establishedSeconds
      : policy.discoveredSeconds;
}

export function nextRefreshAfterSuccess(tier: RefreshTier, now: Date, policy: FreshnessPolicy): Date {
  return new Date(now.getTime() + refreshIntervalSeconds(tier, policy) * 1000);
}

/** Exponential backoff: base * 2^(failures-1), capped. */
export function backoffSeconds(failures: number, policy: FreshnessPolicy): number {
  const exponent = Math.min(Math.max(failures - 1, 0), 20);
  return Math.min(policy.failureBackoffSeconds * 2 ** exponent, policy.maxBackoffSeconds);
}

export function nextRefreshAfterFailure(failures: number, now: Date, policy: FreshnessPolicy): Date {
  return new Date(now.getTime() + backoffSeconds(failures, policy) * 1000);
}

export function isStale(asset: Pick<Asset, 'next_refresh_at'>, now: Date): boolean {
  return new Date(asset.next_refresh_at).getTime() <= now.getTime();
}

export function refreshPriority(tier: RefreshTier): number {
  return tier === 'verified' ? 100 : tier === 'established' ? 50 : 10;
}

/** Cooldown for unknown tokens, doubling with each failed discovery attempt. */
export function unknownTokenCooldownSeconds(attempts: number, baseSeconds: number, maxSeconds: number): number {
  return Math.min(baseSeconds * 2 ** Math.min(Math.max(attempts - 1, 0), 20), maxSeconds);
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApiKeyRepository,
  AuditRepository,
  DiscoveryMiss,
  MissRepository,
  ProviderHealthRecord,
  ProviderHealthRepository,
  RateLimiter,
  RateLimitResult,
} from '@/domain/ports';
import type { ApiKeyRecord, ProviderId } from '@/domain/types';
import { check } from './client';

export class SupabaseMissRepository implements MissRepository {
  constructor(private readonly db: SupabaseClient) {}

  async get(assetKey: string): Promise<DiscoveryMiss | null> {
    const { data, error } = await this.db
      .from('discovery_misses')
      .select('asset_key, attempts, next_attempt_at')
      .eq('asset_key', assetKey)
      .maybeSingle();
    check(error, 'misses.get');
    return (data as DiscoveryMiss | null) ?? null;
  }

  async record(input: Parameters<MissRepository['record']>[0]): Promise<void> {
    const { error } = await this.db.from('discovery_misses').upsert(
      {
        ...input,
        next_attempt_at: input.next_attempt_at.toISOString(),
        last_attempt_at: new Date().toISOString(),
      },
      { onConflict: 'asset_key' },
    );
    check(error, 'misses.record');
  }

  async clear(assetKey: string): Promise<void> {
    const { error } = await this.db.from('discovery_misses').delete().eq('asset_key', assetKey);
    check(error, 'misses.clear');
  }
}

export class SupabaseApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findActiveByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
    const { data, error } = await this.db
      .from('api_keys')
      .select('*')
      .eq('key_prefix', prefix)
      .eq('is_active', true)
      .maybeSingle();
    check(error, 'apiKeys.find');
    return (data as ApiKeyRecord | null) ?? null;
  }

  async touch(id: string): Promise<void> {
    const { error } = await this.db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', id);
    check(error, 'apiKeys.touch');
  }
}

export class SupabaseRateLimiter implements RateLimiter {
  constructor(private readonly db: SupabaseClient) {}

  async hit(key: string, limit: number, windowSeconds: number, cost = 1): Promise<RateLimitResult> {
    const { data, error } = await this.db.rpc('rate_limit_hit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
      p_cost: cost,
    });
    check(error, 'rateLimit.hit');
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed: boolean; remaining: number; reset_at: string }
      | undefined;
    if (!row) throw new Error('rateLimit.hit: empty result');
    return { allowed: row.allowed, remaining: row.remaining, resetAt: new Date(row.reset_at) };
  }

  async cleanup(): Promise<void> {
    const { error } = await this.db.rpc('rate_limit_cleanup');
    check(error, 'rateLimit.cleanup');
  }
}

export class SupabaseProviderHealthRepository implements ProviderHealthRepository {
  constructor(private readonly db: SupabaseClient) {}

  async recordSuccess(provider: ProviderId): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.db
      .from('provider_health')
      .upsert(
        { provider, last_success_at: now, consecutive_failures: 0, updated_at: now },
        { onConflict: 'provider' },
      );
    check(error, 'providerHealth.success');
  }

  async recordFailure(provider: ProviderId, message: string): Promise<void> {
    const { data } = await this.db
      .from('provider_health')
      .select('consecutive_failures')
      .eq('provider', provider)
      .maybeSingle();
    const failures = Number((data as { consecutive_failures?: number } | null)?.consecutive_failures ?? 0) + 1;
    const now = new Date().toISOString();
    const { error } = await this.db.from('provider_health').upsert(
      {
        provider,
        last_failure_at: now,
        last_error: message.slice(0, 200),
        consecutive_failures: failures,
        updated_at: now,
      },
      { onConflict: 'provider' },
    );
    check(error, 'providerHealth.failure');
  }

  async list(): Promise<ProviderHealthRecord[]> {
    const { data, error } = await this.db.from('provider_health').select('*').order('provider');
    check(error, 'providerHealth.list');
    return (data ?? []) as ProviderHealthRecord[];
  }
}

export class SupabaseAuditRepository implements AuditRepository {
  constructor(private readonly db: SupabaseClient) {}

  async record(entry: { actor: string; action: string; target?: string; details?: Record<string, unknown> }): Promise<void> {
    const { error } = await this.db.from('audit_log').insert({
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      details: entry.details ?? {},
    });
    check(error, 'audit.record');
  }
}

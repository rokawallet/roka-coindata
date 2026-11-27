import type { Chain, ProviderId } from '@/domain/types';
import { ProviderUnavailableError } from '@/domain/providers';
import type { FoundLookup, Lookup, MetadataProvider, ProviderResult } from '@/domain/providers';
import type { ProviderHealthRepository, RateLimiter } from '@/domain/ports';
import { emptyMetadata, isComplete, isUsable, mergeMetadata } from '@/domain/metadata';
import { normalizeMetadata } from '@/domain/normalize';
import type { Logger } from '@/infrastructure/logging/logger';

/** Shared (database-backed) per-provider request budget so serverless instances don't exceed quotas. */
export interface ProviderBudget {
  tryConsume(provider: ProviderId, cost: number): Promise<boolean>;
}

export class RateLimiterBudget implements ProviderBudget {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly limitsPerMinute: Record<ProviderId, number>,
  ) {}

  async tryConsume(provider: ProviderId, cost: number): Promise<boolean> {
    const result = await this.limiter.hit(`provider:${provider}`, this.limitsPerMinute[provider], 60, cost);
    return result.allowed;
  }
}

export interface ProbeResult {
  provider: ProviderId;
  ok: boolean;
  latency_ms: number;
}

/**
 * Queries providers in configured order, normalizes each answer, and stops as soon as the merged
 * result is complete. Falls through to the next provider on failure or missing data.
 * Throws ProviderUnavailableError when nothing was found and at least one provider failed.
 */
export class ProviderOrchestrator {
  constructor(
    private readonly providers: MetadataProvider[],
    private readonly budget: ProviderBudget,
    private readonly health: ProviderHealthRepository,
    private readonly logger: Logger,
  ) {}

  lookupToken(chain: Chain, address: string): Promise<Lookup> {
    return this.lookup(chain, (p) => p.fetchToken(chain, address));
  }

  lookupNative(chain: Chain): Promise<Lookup> {
    return this.lookup(chain, (p) => p.fetchNative(chain));
  }

  async probeAll(): Promise<ProbeResult[]> {
    return Promise.all(
      this.providers.map(async (p) => {
        const started = Date.now();
        try {
          await p.probe();
          await this.health.recordSuccess(p.id);
          return { provider: p.id, ok: true, latency_ms: Date.now() - started };
        } catch (error) {
          await this.health.recordFailure(p.id, error instanceof Error ? error.message : 'probe failed');
          return { provider: p.id, ok: false, latency_ms: Date.now() - started };
        }
      }),
    );
  }

  private async lookup(
    chain: Chain,
    call: (provider: MetadataProvider) => Promise<ProviderResult | null>,
  ): Promise<Lookup> {
    let merged = emptyMetadata();
    let found = false;
    let coingeckoId: string | null = null;
    const sources: string[] = [];
    const mappings: FoundLookup['mappings'] = [];
    let failures = 0;

    for (const provider of this.providers) {
      if (!provider.supportsChain(chain)) continue;
      if (found && isComplete(merged)) break;

      if (!(await this.budget.tryConsume(provider.id, provider.requestsPerLookup))) {
        this.logger.warn('provider budget exhausted', { provider: provider.id });
        failures++;
        continue;
      }

      let result: ProviderResult | null;
      try {
        result = await call(provider);
        await this.health.recordSuccess(provider.id);
      } catch (error) {
        failures++;
        const message = error instanceof ProviderUnavailableError ? error.message : 'unexpected provider error';
        this.logger.warn('provider lookup failed', { provider: provider.id, reason: message });
        await this.health.recordFailure(provider.id, message).catch(() => undefined);
        continue;
      }
      if (!result) continue;

      const normalized = normalizeMetadata(result.raw);
      if (!isUsable(normalized)) {
        this.logger.warn('provider returned unusable metadata', { provider: provider.id });
        continue;
      }
      merged = found ? mergeMetadata(merged, normalized) : normalized;
      found = true;
      sources.push(provider.id);
      coingeckoId ??= result.coingeckoId;
      if (result.providerRef) mappings.push({ provider: provider.id, provider_ref: result.providerRef });
    }

    if (found) return { status: 'found', metadata: merged, sources, coingecko_id: coingeckoId, mappings };
    if (failures > 0) throw new ProviderUnavailableError('No provider could answer');
    return { status: 'not_found' };
  }
}

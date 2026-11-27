import type { Chain, CoinMetadata, ProviderId } from './types';
import type { RawMetadata } from './normalize';

/** Provider could not give an answer (network, 5xx, bad payload, rate limit). */
export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderRateLimitedError extends ProviderUnavailableError {
  constructor(readonly retryAfterSeconds: number | null = null) {
    super('Provider rate limit reached', false);
    this.name = 'ProviderRateLimitedError';
  }
}

/** Unnormalized result from one provider. `null` from a provider means "asset not found". */
export interface ProviderResult {
  provider: ProviderId;
  providerRef: string | null;
  coingeckoId: string | null;
  raw: RawMetadata;
}

export interface MetadataProvider {
  readonly id: ProviderId;
  /** Number of upstream HTTP requests one lookup costs (used for quota budgeting). */
  readonly requestsPerLookup: number;
  supportsChain(chain: Chain): boolean;
  fetchToken(chain: Chain, address: string): Promise<ProviderResult | null>;
  fetchNative(chain: Chain): Promise<ProviderResult | null>;
  /** Lightweight liveness check; throws on failure. */
  probe(): Promise<void>;
}

export interface FoundLookup {
  status: 'found';
  metadata: CoinMetadata;
  /** Provider ids that contributed, or `config` when built from the chain registry only. */
  sources: string[];
  coingecko_id: string | null;
  mappings: { provider: ProviderId; provider_ref: string }[];
}

export type Lookup = FoundLookup | { status: 'not_found' };

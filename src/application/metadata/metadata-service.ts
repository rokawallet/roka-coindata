import { assetKey } from '@/domain/address';
import type { AssetRepository, ChainRepository, MissRepository } from '@/domain/ports';
import type { FreshnessPolicy } from '@/domain/freshness';
import { isStale, unknownTokenCooldownSeconds } from '@/domain/freshness';
import { ProviderUnavailableError } from '@/domain/providers';
import type { FoundLookup } from '@/domain/providers';
import { emptyMetadata } from '@/domain/metadata';
import type { Asset, Chain } from '@/domain/types';
import { errors } from '@/errors';
import type { Logger } from '@/infrastructure/logging/logger';
import { serializeError } from '@/infrastructure/logging/logger';
import { InflightMap } from '@/utils/async';
import type { AssetWriter } from './asset-writer';
import type { ProviderOrchestrator } from './provider-orchestrator';
import type { RefreshService } from '../refresh/refresh-service';

export type CacheState = 'hit' | 'stale' | 'miss';
export interface CoinResult {
  asset: Asset;
  chain: Chain;
  cache: CacheState;
}

export interface MetadataServiceDeps {
  chains: ChainRepository;
  assets: AssetRepository;
  misses: MissRepository;
  orchestrator: ProviderOrchestrator;
  writer: AssetWriter;
  refresh: RefreshService;
  policy: FreshnessPolicy;
  unknownCooldownSeconds: number;
  unknownMaxCooldownSeconds: number;
  now: () => Date;
  logger: Logger;
}

export type Background = (task: () => Promise<void>) => void;

/** Read-through cache: database first, stale-while-revalidate, provider discovery on miss. */
export class MetadataService {
  private readonly inflight = new InflightMap<Asset>();

  constructor(private readonly d: MetadataServiceDeps) {}

  async requireActiveChain(chainId: number): Promise<Chain> {
    const chain = await this.d.chains.findByChainId(chainId);
    if (!chain || !chain.is_active) throw errors.notFound('Chain is not supported', { chain_id: chainId });
    return chain;
  }

  async getToken(input: {
    chainId: number;
    address: string;
    allowDiscovery: boolean;
    background: Background;
  }): Promise<CoinResult> {
    const chain = await this.requireActiveChain(input.chainId);
    const existing = await this.d.assets.findToken(chain.chain_id, input.address);
    const notFound = () => errors.notFound('Asset not found', { chain_id: chain.chain_id, contract_address: input.address });

    if (existing) {
      if (existing.verification_status === 'rejected') throw notFound();
      return this.serveCached(chain, existing, input.background);
    }
    if (!input.allowDiscovery) throw notFound();

    const key = assetKey(chain.chain_id, input.address);
    const miss = await this.d.misses.get(key);
    if (miss && new Date(miss.next_attempt_at) > this.d.now()) {
      const retryAfter = Math.ceil((new Date(miss.next_attempt_at).getTime() - this.d.now().getTime()) / 1000);
      throw errors.notFound('Asset not found at any provider', { retry_after_seconds: retryAfter });
    }

    const asset = await this.inflight.run(key, async () => {
      // Another instance may have created it while we waited.
      const raced = await this.d.assets.findToken(chain.chain_id, input.address);
      if (raced) return raced;
      const lookup = await this.lookup(() => this.d.orchestrator.lookupToken(chain, input.address));
      if (lookup.status === 'not_found') {
        const attempts = (miss?.attempts ?? 0) + 1;
        const cooldown = unknownTokenCooldownSeconds(attempts, this.d.unknownCooldownSeconds, this.d.unknownMaxCooldownSeconds);
        await this.d.misses.record({
          asset_key: key,
          chain_id: chain.chain_id,
          contract_address: input.address,
          attempts,
          next_attempt_at: new Date(this.d.now().getTime() + cooldown * 1000),
        });
        throw errors.notFound('Asset not found at any provider', { retry_after_seconds: cooldown });
      }
      const created = await this.d.writer.createFromLookup(chain, input.address, lookup);
      await this.d.misses.clear(key).catch(() => undefined);
      return created;
    });
    return { asset, chain, cache: 'miss' };
  }

  async getNative(input: { chainId: number; background: Background }): Promise<CoinResult> {
    const chain = await this.requireActiveChain(input.chainId);
    const existing = await this.d.assets.findNative(chain.chain_id);
    if (existing) {
      if (existing.verification_status === 'rejected') throw errors.notFound('Asset not found');
      return this.serveCached(chain, existing, input.background);
    }
    const asset = await this.inflight.run(assetKey(chain.chain_id, null), async () => {
      const raced = await this.d.assets.findNative(chain.chain_id);
      if (raced) return raced;
      let lookup: FoundLookup = { status: 'found', metadata: emptyMetadata(), sources: ['config'], coingecko_id: null, mappings: [] };
      try {
        const result = await this.d.orchestrator.lookupNative(chain);
        if (result.status === 'found') lookup = result;
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        this.d.logger.warn('native lookup failed; using chain registry data', { chain_id: chain.chain_id });
      }
      return this.d.writer.createFromLookup(chain, null, lookup);
    });
    return { asset, chain, cache: 'miss' };
  }

  private serveCached(chain: Chain, asset: Asset, background: Background): CoinResult {
    if (!isStale(asset, this.d.now())) return { asset, chain, cache: 'hit' };
    // Stale-while-revalidate: respond immediately, refresh after the response is sent.
    background(async () => {
      try {
        await this.d.refresh.refreshAsset(chain, asset, 'refresh');
      } catch (error) {
        this.d.logger.warn('background revalidation failed', serializeError(error));
      }
    });
    return { asset, chain, cache: 'stale' };
  }

  private async lookup<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw errors.providerUnavailable();
      throw error;
    }
  }
}

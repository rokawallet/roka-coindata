import { assetKey } from '@/domain/address';
import type { AssetRepository, ChainRepository, JobRepository } from '@/domain/ports';
import type { FreshnessPolicy } from '@/domain/freshness';
import type { Lookup } from '@/domain/providers';
import { backoffSeconds, nextRefreshAfterFailure, refreshPriority, tierFor } from '@/domain/freshness';
import type { Asset, Chain, RefreshJob } from '@/domain/types';
import type { Logger } from '@/infrastructure/logging/logger';
import { serializeError } from '@/infrastructure/logging/logger';
import type { AssetWriter } from '../metadata/asset-writer';
import type { ProviderOrchestrator } from '../metadata/provider-orchestrator';

export interface RefreshDeps {
  chains: ChainRepository;
  assets: AssetRepository;
  jobs: JobRepository;
  orchestrator: ProviderOrchestrator;
  writer: AssetWriter;
  policy: FreshnessPolicy;
  now: () => Date;
  logger: Logger;
  batchSize: number;
  timeBudgetMs: number;
}

export interface BatchReport {
  enqueued: number;
  claimed: number;
  succeeded: number;
  failed: number;
  released: number;
}

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message.slice(0, 200) : 'refresh failed';

export class RefreshService {
  constructor(private readonly d: RefreshDeps) {}

  /**
   * Refreshes one asset under a persistent job so concurrent workers never duplicate the work.
   * Returns `skipped: true` when another worker already holds an active job for the asset.
   * On provider failure the stored metadata is preserved and the next attempt is pushed back with backoff.
   */
  async refreshAsset(
    chain: Chain,
    asset: Asset,
    jobType: 'refresh' | 'manual',
  ): Promise<{ asset: Asset; skipped: boolean }> {
    const job = await this.d.jobs.startInline({
      asset_id: asset.id,
      asset_key: asset.identity_key,
      chain_id: asset.chain_id,
      contract_address: asset.contract_address,
      job_type: jobType,
      priority: refreshPriority(tierFor(asset)),
    });
    if (!job) return { asset, skipped: true };
    try {
      const updated = await this.runRefresh(chain, asset);
      await this.d.jobs.complete(job.id);
      return { asset: updated, skipped: false };
    } catch (error) {
      await this.recordFailure(asset, error);
      await this.d.jobs.fail(job.id, failureMessage(error), null);
      throw error;
    }
  }

  /** Scheduled entry point: enqueue stale assets, then process a bounded batch within the time budget. */
  async runScheduledBatch(): Promise<BatchReport> {
    const started = this.d.now().getTime();
    const enqueued = await this.d.jobs.enqueueStale(this.d.batchSize * 2);
    const claimed = await this.d.jobs.claim(this.d.batchSize);
    const report: BatchReport = { enqueued, claimed: claimed.length, succeeded: 0, failed: 0, released: 0 };

    for (let i = 0; i < claimed.length; i++) {
      const job = claimed[i];
      if (!job) continue;
      if (this.d.now().getTime() - started > this.d.timeBudgetMs) {
        const rest = claimed.slice(i).map((j) => j.id);
        await this.d.jobs.release(rest);
        report.released = rest.length;
        break;
      }
      if (await this.executeJob(job)) report.succeeded++;
      else report.failed++;
    }
    return report;
  }

  private async executeJob(job: RefreshJob): Promise<boolean> {
    try {
      const chain = await this.d.chains.findByChainId(job.chain_id);
      if (!chain || !chain.is_active) {
        await this.d.jobs.fail(job.id, 'chain is not active', null);
        return false;
      }
      const asset = job.contract_address
        ? await this.d.assets.findToken(job.chain_id, job.contract_address)
        : await this.d.assets.findNative(job.chain_id);
      if (!asset) {
        await this.d.jobs.fail(job.id, 'asset no longer exists', null);
        return false;
      }
      if (asset.verification_status === 'rejected') {
        await this.d.jobs.complete(job.id);
        return true;
      }
      try {
        await this.runRefresh(chain, asset);
        await this.d.jobs.complete(job.id);
        return true;
      } catch (error) {
        await this.recordFailure(asset, error);
        const retry =
          job.attempts < job.max_attempts
            ? new Date(this.d.now().getTime() + backoffSeconds(job.attempts, this.d.policy) * 1000)
            : null;
        await this.d.jobs.fail(job.id, failureMessage(error), retry);
        return false;
      }
    } catch (error) {
      this.d.logger.error('refresh job crashed', { job_id: job.id, ...serializeError(error) });
      await this.d.jobs.fail(job.id, 'internal error', null).catch(() => undefined);
      return false;
    }
  }

  private async runRefresh(chain: Chain, asset: Asset): Promise<Asset> {
    let lookup: Lookup;
    if (asset.asset_type === 'native') {
      lookup = await this.d.orchestrator.lookupNative(chain);
    } else {
      if (!asset.contract_address) throw new Error('token asset without contract address');
      lookup = await this.d.orchestrator.lookupToken(chain, asset.contract_address);
    }
    if (lookup.status === 'not_found') throw new Error('asset not found at any provider');
    return this.d.writer.applyLookup(chain, asset, lookup);
  }

  private async recordFailure(asset: Asset, error: unknown): Promise<void> {
    const failures = asset.refresh_failures + 1;
    this.d.logger.warn('asset refresh failed', { asset: assetKey(asset.chain_id, asset.contract_address), failures });
    await this.d.assets
      .recordRefreshFailure(asset.id, failures, nextRefreshAfterFailure(failures, this.d.now(), this.d.policy), failureMessage(error))
      .catch((e: unknown) => this.d.logger.error('failed to record refresh failure', serializeError(e)));
  }
}

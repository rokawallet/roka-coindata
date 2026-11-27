import type { AssetRepository, AuditRepository, ChainInput, ChainRepository, JobRepository } from '@/domain/ports';
import type { Asset, Chain, CoinMetadata, RefreshJob, VerificationStatus } from '@/domain/types';
import { errors } from '@/errors';
import type { AssetWriter } from '../metadata/asset-writer';
import type { RefreshService } from '../refresh/refresh-service';

export type AssetRef = { kind: 'native' } | { kind: 'token'; address: string };

export interface AdminDeps {
  chains: ChainRepository;
  assets: AssetRepository;
  jobs: JobRepository;
  writer: AssetWriter;
  refresh: RefreshService;
  audit: AuditRepository;
}

/** Administrative mutations. Every change is written to the audit log with the acting API key. */
export class AdminService {
  constructor(private readonly d: AdminDeps) {}

  async createChain(actor: string, input: ChainInput): Promise<Chain> {
    if (await this.d.chains.findByChainId(input.chain_id)) throw errors.conflict('Chain already exists');
    if (await this.d.chains.findBySlug(input.slug)) throw errors.conflict('Chain slug already in use');
    const chain = await this.d.chains.create(input);
    await this.d.audit.record({ actor, action: 'chain.create', target: String(chain.chain_id) });
    return chain;
  }

  async updateChain(actor: string, chainId: number, patch: Partial<Omit<ChainInput, 'chain_id'>>): Promise<Chain> {
    const chain = await this.d.chains.update(chainId, patch);
    if (!chain) throw errors.notFound('Chain not found');
    await this.d.audit.record({ actor, action: 'chain.update', target: String(chainId), details: { fields: Object.keys(patch) } });
    return chain;
  }

  async requireAsset(chainId: number, ref: AssetRef): Promise<{ chain: Chain; asset: Asset }> {
    const chain = await this.d.chains.findByChainId(chainId);
    if (!chain) throw errors.notFound('Chain not found');
    const asset = ref.kind === 'native' ? await this.d.assets.findNative(chainId) : await this.d.assets.findToken(chainId, ref.address);
    if (!asset) throw errors.notFound('Asset not found');
    return { chain, asset };
  }

  async registerOfficialAsset(
    actor: string,
    chainId: number,
    ref: AssetRef,
    fields: Partial<CoinMetadata>,
    verification: VerificationStatus,
    reason: string,
  ): Promise<Asset> {
    const chain = await this.d.chains.findByChainId(chainId);
    if (!chain) throw errors.notFound('Chain not found');
    const address = ref.kind === 'token' ? ref.address : null;
    const existing = address ? await this.d.assets.findToken(chainId, address) : await this.d.assets.findNative(chainId);
    if (existing) throw errors.conflict('Asset already exists; apply an override instead');
    const asset = await this.d.writer.createOfficial(chain, address, fields, { verification, reason, actor });
    await this.d.audit.record({ actor, action: 'asset.register', target: asset.identity_key, details: { reason } });
    return asset;
  }

  async setOverride(
    actor: string,
    chainId: number,
    ref: AssetRef,
    fields: Partial<CoinMetadata>,
    reason: string,
  ): Promise<Asset> {
    const { chain, asset } = await this.requireAsset(chainId, ref);
    const current = await this.d.assets.getOverride(asset.id);
    const merged: Partial<CoinMetadata> = {
      ...current?.fields,
      ...fields,
      other_links: { ...current?.fields.other_links, ...fields.other_links },
    };
    await this.d.assets.saveOverride({ asset_id: asset.id, fields: merged, reason, approved_by: actor });
    const flagged = await this.d.assets.setHasOverride(asset.id, true);
    const applied = await this.d.writer.reapplyOverrides(chain, flagged);
    await this.d.audit.record({ actor, action: 'asset.override.set', target: asset.identity_key, details: { reason, fields: Object.keys(fields) } });
    return applied;
  }

  /** Removing an override is the explicit authorization for providers to overwrite those fields on the next refresh. */
  async removeOverride(actor: string, chainId: number, ref: AssetRef): Promise<Asset> {
    const { asset } = await this.requireAsset(chainId, ref);
    await this.d.assets.deleteOverride(asset.id);
    const updated = await this.d.assets.setHasOverride(asset.id, false);
    await this.d.audit.record({ actor, action: 'asset.override.remove', target: asset.identity_key });
    return updated;
  }

  async setVerification(actor: string, chainId: number, ref: AssetRef, status: VerificationStatus): Promise<Asset> {
    const { asset } = await this.requireAsset(chainId, ref);
    const updated = await this.d.assets.setVerification(asset.id, status);
    await this.d.audit.record({ actor, action: 'asset.verification', target: asset.identity_key, details: { status } });
    return updated;
  }

  async refreshNow(actor: string, chainId: number, ref: AssetRef): Promise<{ asset: Asset; skipped: boolean }> {
    const { chain, asset } = await this.requireAsset(chainId, ref);
    const result = await this.d.refresh.refreshAsset(chain, asset, 'manual');
    await this.d.audit.record({ actor, action: 'asset.refresh', target: asset.identity_key, details: { skipped: result.skipped } });
    return result;
  }

  async retryJob(actor: string, jobId: string): Promise<RefreshJob> {
    const job = await this.d.jobs.retry(jobId);
    if (!job) throw errors.conflict('Only failed jobs without an active duplicate can be retried');
    await this.d.audit.record({ actor, action: 'job.retry', target: jobId });
    return job;
  }
}

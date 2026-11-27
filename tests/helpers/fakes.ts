import { LogoService } from '@/application/metadata/logo-service';
import { AssetWriter } from '@/application/metadata/asset-writer';
import { MetadataService } from '@/application/metadata/metadata-service';
import { ProviderOrchestrator } from '@/application/metadata/provider-orchestrator';
import { RefreshService } from '@/application/refresh/refresh-service';
import type { FreshnessPolicy } from '@/domain/freshness';
import type {
  AssetListFilter, AssetRepository, ChainRepository, DiscoveryMiss, JobRepository, MissRepository, Page,
} from '@/domain/ports';
import type { MetadataProvider, ProviderResult } from '@/domain/providers';
import type { RawMetadata } from '@/domain/normalize';
import type {
  Asset, AssetMetadataPatch, AssetOverride, Chain, CoinMetadata, NewAsset, ProviderId, RefreshJob, VerificationStatus,
} from '@/domain/types';
import { silentLogger } from '@/infrastructure/logging/logger';

export const POLICY: FreshnessPolicy = {
  verifiedSeconds: 100, establishedSeconds: 200, discoveredSeconds: 300, failureBackoffSeconds: 10, maxBackoffSeconds: 100,
};

export const makeChain = (over: Partial<Chain> = {}): Chain => ({
  id: 'c1', chain_id: 1, family: 'evm', name: 'Ethereum', slug: 'ethereum', network_type: 'mainnet',
  native_name: 'Ether', native_symbol: 'ETH', native_decimals: 18, native_logo_url: null,
  coingecko_platform_id: 'ethereum', coingecko_native_id: 'ethereum', geckoterminal_network_id: 'eth',
  is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...over,
});

export class FakeChains implements ChainRepository {
  constructor(public chains: Chain[] = [makeChain()]) {}
  list(o: { activeOnly?: boolean } = {}) { return Promise.resolve(this.chains.filter((c) => !o.activeOnly || c.is_active)); }
  findByChainId(id: number) { return Promise.resolve(this.chains.find((c) => c.chain_id === id) ?? null); }
  findBySlug(slug: string) { return Promise.resolve(this.chains.find((c) => c.slug === slug) ?? null); }
  create(): Promise<Chain> { throw new Error('not used'); }
  update(): Promise<Chain | null> { throw new Error('not used'); }
}

export class FakeAssets implements AssetRepository {
  rows = new Map<string, Asset>();
  overrides = new Map<string, AssetOverride>();
  mappings = new Map<string, { provider: string; provider_ref: string }[]>();
  private seq = 0;
  constructor(private now: () => Date) {}

  private byKey(key: string) { return Promise.resolve([...this.rows.values()].find((a) => a.identity_key === key) ?? null); }
  findToken(chainId: number, address: string) { return this.byKey(`${chainId}:${address}`); }
  findNative(chainId: number) { return this.byKey(`${chainId}:native`); }
  findById(id: string) { return Promise.resolve(this.rows.get(id) ?? null); }
  async insert(row: NewAsset): Promise<Asset> {
    const existing = await this.byKey(row.identity_key);
    if (existing) return existing;
    const ts = this.now().toISOString();
    const asset: Asset = { ...row, id: `a${++this.seq}`, created_at: ts, updated_at: ts };
    this.rows.set(asset.id, asset);
    return asset;
  }
  updateMetadata(id: string, patch: AssetMetadataPatch) {
    const next = { ...this.rows.get(id)!, ...patch } as Asset;
    this.rows.set(id, next);
    return Promise.resolve(next);
  }
  setVerification(id: string, status: VerificationStatus) {
    const next = { ...this.rows.get(id)!, verification_status: status };
    this.rows.set(id, next);
    return Promise.resolve(next);
  }
  setHasOverride(id: string, value: boolean) {
    const next = { ...this.rows.get(id)!, has_override: value };
    this.rows.set(id, next);
    return Promise.resolve(next);
  }
  recordRefreshFailure(id: string, failures: number, next: Date, error: string) {
    this.rows.set(id, { ...this.rows.get(id)!, refresh_failures: failures, next_refresh_at: next.toISOString(), last_refresh_error: error });
    return Promise.resolve();
  }
  upsertMappings(id: string, m: { provider: ProviderId; provider_ref: string }[]) { this.mappings.set(id, m); return Promise.resolve(); }
  getMappings(id: string) { return Promise.resolve(this.mappings.get(id) ?? []); }
  getOverride(id: string) { return Promise.resolve(this.overrides.get(id) ?? null); }
  saveOverride(i: { asset_id: string; fields: Partial<CoinMetadata>; reason: string; approved_by: string }) {
    this.overrides.set(i.asset_id, { ...i, approved_at: this.now().toISOString() });
    return Promise.resolve();
  }
  deleteOverride(id: string) { this.overrides.delete(id); return Promise.resolve(); }
  list(_f: AssetListFilter, _p: number, _l: number): Promise<Page<Asset>> { const items = [...this.rows.values()]; return Promise.resolve({ items, total: items.length }); }
  search(): Promise<Page<Asset>> { return Promise.resolve({ items: [], total: 0 }); }
}

export class FakeJobs implements JobRepository {
  jobs: RefreshJob[] = [];
  startInline(i: Parameters<JobRepository['startInline']>[0]) {
    if (this.jobs.some((j) => j.asset_key === i.asset_key && (j.status === 'running' || j.status === 'pending'))) return Promise.resolve(null);
    const job: RefreshJob = { ...i, id: `j${this.jobs.length + 1}`, status: 'running', attempts: 1, max_attempts: 5, last_error: null,
      run_after: '', created_at: '', started_at: '', completed_at: null };
    this.jobs.push(job);
    return Promise.resolve(job);
  }
  enqueueStale() { return Promise.resolve(0); }
  claim() { return Promise.resolve([]); }
  complete(id: string) { this.set(id, { status: 'completed' }); return Promise.resolve(); }
  fail(id: string, error: string, retryAt: Date | null) { this.set(id, { status: retryAt ? 'pending' : 'failed', last_error: error }); return Promise.resolve(); }
  release() { return Promise.resolve(); }
  list(): Promise<Page<RefreshJob>> { return Promise.resolve({ items: this.jobs, total: this.jobs.length }); }
  retry() { return Promise.resolve(null); }
  private set(id: string, patch: Partial<RefreshJob>) { this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)); }
}

export class FakeMisses implements MissRepository {
  rows = new Map<string, DiscoveryMiss>();
  get(k: string) { return Promise.resolve(this.rows.get(k) ?? null); }
  record(i: Parameters<MissRepository['record']>[0]) {
    this.rows.set(i.asset_key, { asset_key: i.asset_key, attempts: i.attempts, next_attempt_at: i.next_attempt_at.toISOString() });
    return Promise.resolve();
  }
  clear(k: string) { this.rows.delete(k); return Promise.resolve(); }
}

export class FakeProvider implements MetadataProvider {
  calls = 0;
  constructor(
    public readonly id: ProviderId,
    public behavior: () => Promise<ProviderResult | null>,
    public readonly requestsPerLookup = 1,
  ) {}
  supportsChain() { return true; }
  fetchToken() { this.calls++; return this.behavior(); }
  fetchNative() { this.calls++; return this.behavior(); }
  probe() { return Promise.resolve(); }
}

export const providerResult = (provider: ProviderId, raw: RawMetadata, coingeckoId: string | null = null): ProviderResult => ({
  provider, providerRef: `${provider}-ref`, coingeckoId, raw,
});

export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
export const USDC_RAW: RawMetadata = {
  name: 'USD Coin', symbol: 'USDC', decimals: 6, description: '<p>Stablecoin</p>',
  logoUrl: 'https://assets.example.com/usdc.png', websites: ['https://www.circle.com'], twitter: 'circle',
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);

export function buildHarness(providers: FakeProvider[], chains: Chain[] = [makeChain()]) {
  const clock = { t: new Date('2026-06-01T00:00:00Z') };
  const now = () => new Date(clock.t);
  const chainRepo = new FakeChains(chains);
  const assets = new FakeAssets(now);
  const jobs = new FakeJobs();
  const misses = new FakeMisses();
  const stored: string[] = [];
  const logos = new LogoService(
    { download: () => Promise.resolve({ bytes: PNG, contentType: 'image/png', extension: 'png' }) },
    { put: (p) => { stored.push(p); return Promise.resolve(`https://storage.example.com/${p}`); }, remove: () => Promise.resolve() },
    silentLogger,
  );
  const orchestrator = new ProviderOrchestrator(
    providers,
    { tryConsume: () => Promise.resolve(true) },
    { recordSuccess: () => Promise.resolve(), recordFailure: () => Promise.resolve(), list: () => Promise.resolve([]) },
    silentLogger,
  );
  const writer = new AssetWriter({ assets, logos, policy: POLICY, now });
  const refresh = new RefreshService({
    chains: chainRepo, assets, jobs, orchestrator, writer, policy: POLICY, now, logger: silentLogger, batchSize: 5, timeBudgetMs: 10_000,
  });
  const metadata = new MetadataService({
    chains: chainRepo, assets, misses, orchestrator, writer, refresh, policy: POLICY, now, logger: silentLogger,
    unknownCooldownSeconds: 60, unknownMaxCooldownSeconds: 600,
  });
  const tasks: (() => Promise<void>)[] = [];
  const background = (t: () => Promise<void>) => { tasks.push(t); };
  const flush = async () => { while (tasks.length) await tasks.shift()!(); };
  return { clock, assets, jobs, misses, metadata, writer, refresh, stored, background, flush, chains: chainRepo };
}

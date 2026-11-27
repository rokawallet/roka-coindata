import type {
  ApiKeyRecord,
  Asset,
  AssetMetadataPatch,
  AssetOverride,
  Chain,
  CoinMetadata,
  NewAsset,
  ProviderId,
  RefreshJob,
  VerificationStatus,
} from './types';

export type ChainInput = Omit<Chain, 'id' | 'created_at' | 'updated_at' | 'family'>;

export interface Page<T> {
  items: T[];
  total: number;
}

export interface ChainRepository {
  list(options?: { activeOnly?: boolean }): Promise<Chain[]>;
  findByChainId(chainId: number): Promise<Chain | null>;
  findBySlug(slug: string): Promise<Chain | null>;
  create(input: ChainInput): Promise<Chain>;
  update(chainId: number, patch: Partial<Omit<ChainInput, 'chain_id'>>): Promise<Chain | null>;
}

export interface AssetListFilter {
  chainIds?: number[];
  verification?: VerificationStatus;
  excludeRejected?: boolean;
}

export interface AssetRepository {
  findToken(chainId: number, address: string): Promise<Asset | null>;
  findNative(chainId: number): Promise<Asset | null>;
  findById(id: string): Promise<Asset | null>;
  /** Inserts; on a unique-identity race returns the row that won. */
  insert(row: NewAsset): Promise<Asset>;
  updateMetadata(id: string, patch: AssetMetadataPatch): Promise<Asset>;
  setVerification(id: string, status: VerificationStatus): Promise<Asset>;
  setHasOverride(id: string, value: boolean): Promise<Asset>;
  recordRefreshFailure(id: string, failures: number, nextRefreshAt: Date, error: string): Promise<void>;
  upsertMappings(assetId: string, mappings: { provider: ProviderId; provider_ref: string }[]): Promise<void>;
  getMappings(assetId: string): Promise<{ provider: string; provider_ref: string }[]>;
  getOverride(assetId: string): Promise<AssetOverride | null>;
  saveOverride(input: {
    asset_id: string;
    fields: Partial<CoinMetadata>;
    reason: string;
    approved_by: string;
  }): Promise<void>;
  deleteOverride(assetId: string): Promise<void>;
  list(filter: AssetListFilter, page: number, limit: number): Promise<Page<Asset>>;
  search(query: string, chainId: number | null, page: number, limit: number): Promise<Page<Asset>>;
}

export interface JobRepository {
  /** Creates a `running` job. Returns null when an active job for the asset already exists. */
  startInline(input: {
    asset_id: string | null;
    asset_key: string;
    chain_id: number;
    contract_address: string | null;
    job_type: RefreshJob['job_type'];
    priority: number;
  }): Promise<RefreshJob | null>;
  enqueueStale(limit: number): Promise<number>;
  claim(limit: number): Promise<RefreshJob[]>;
  complete(id: string): Promise<void>;
  /** With `retryAt` the job returns to `pending`; without it the job is `failed` permanently. */
  fail(id: string, error: string, retryAt: Date | null): Promise<void>;
  release(ids: string[]): Promise<void>;
  list(filter: { status?: RefreshJob['status'] }, page: number, limit: number): Promise<Page<RefreshJob>>;
  retry(id: string): Promise<RefreshJob | null>;
}

export interface DiscoveryMiss {
  asset_key: string;
  attempts: number;
  next_attempt_at: string;
}

export interface MissRepository {
  get(assetKey: string): Promise<DiscoveryMiss | null>;
  record(input: {
    asset_key: string;
    chain_id: number;
    contract_address: string;
    attempts: number;
    next_attempt_at: Date;
  }): Promise<void>;
  clear(assetKey: string): Promise<void>;
}

export interface ApiKeyRepository {
  findActiveByPrefix(prefix: string): Promise<ApiKeyRecord | null>;
  touch(id: string): Promise<void>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export interface RateLimiter {
  hit(key: string, limit: number, windowSeconds: number, cost?: number): Promise<RateLimitResult>;
  cleanup(): Promise<void>;
}

export interface ProviderHealthRecord {
  provider: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

export interface ProviderHealthRepository {
  recordSuccess(provider: ProviderId): Promise<void>;
  recordFailure(provider: ProviderId, message: string): Promise<void>;
  list(): Promise<ProviderHealthRecord[]>;
}

export interface AuditRepository {
  record(entry: { actor: string; action: string; target?: string; details?: Record<string, unknown> }): Promise<void>;
}

export interface ImageDownloader {
  download(url: string): Promise<{ bytes: Uint8Array; contentType: string; extension: string }>;
}

export interface LogoStorage {
  /** Stores bytes at a deterministic path and returns the public URL. */
  put(path: string, bytes: Uint8Array, contentType: string): Promise<string>;
  remove(path: string): Promise<void>;
}

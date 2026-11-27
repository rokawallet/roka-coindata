export type AssetType = 'native' | 'token';
export type VerificationStatus = 'unverified' | 'verified' | 'rejected';
export type ProviderId = 'coingecko' | 'geckoterminal';
export type NetworkType = 'mainnet' | 'testnet';

export interface Chain {
  id: string;
  chain_id: number;
  family: 'evm';
  name: string;
  slug: string;
  network_type: NetworkType;
  native_name: string;
  native_symbol: string;
  native_decimals: number;
  native_logo_url: string | null;
  coingecko_platform_id: string | null;
  coingecko_native_id: string | null;
  geckoterminal_network_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Canonical, provider-independent metadata fields. */
export interface CoinMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  description: string | null;
  logo_source_url: string | null;
  website_url: string | null;
  twitter_url: string | null;
  telegram_url: string | null;
  discord_url: string | null;
  github_url: string | null;
  other_links: Record<string, string>;
}

export interface Asset extends CoinMetadata {
  id: string;
  /** `<chain_id>:<lowercase address>` or `<chain_id>:native`. */
  identity_key: string;
  chain_id: number;
  asset_type: AssetType;
  contract_address: string | null;
  logo_url: string | null;
  logo_path: string | null;
  coingecko_id: string | null;
  metadata_sources: string[];
  verification_status: VerificationStatus;
  has_override: boolean;
  metadata_fetched_at: string | null;
  next_refresh_at: string;
  refresh_failures: number;
  last_refresh_error: string | null;
  created_at: string;
  updated_at: string;
}

export type NewAsset = Omit<Asset, 'id' | 'created_at' | 'updated_at'>;

export type AssetMetadataPatch = Partial<
  Omit<
    Asset,
    | 'id'
    | 'identity_key'
    | 'chain_id'
    | 'asset_type'
    | 'contract_address'
    | 'verification_status'
    | 'has_override'
    | 'created_at'
    | 'updated_at'
  >
>;

export interface AssetOverride {
  asset_id: string;
  fields: Partial<CoinMetadata>;
  reason: string;
  approved_by: string;
  approved_at: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
}

export interface RefreshJob {
  id: string;
  asset_id: string | null;
  asset_key: string;
  chain_id: number;
  contract_address: string | null;
  job_type: 'refresh' | 'discover' | 'manual';
  status: 'pending' | 'running' | 'completed' | 'failed';
  priority: number;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_after: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

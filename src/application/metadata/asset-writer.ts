import { assetKey } from '@/domain/address';
import type { AssetRepository } from '@/domain/ports';
import type { FoundLookup } from '@/domain/providers';
import type { Asset, AssetMetadataPatch, Chain, CoinMetadata, NewAsset, VerificationStatus } from '@/domain/types';
import { applyOverrides, emptyMetadata, mergeMetadata, metadataOf } from '@/domain/metadata';
import { nextRefreshAfterFailure, nextRefreshAfterSuccess, tierFor } from '@/domain/freshness';
import type { FreshnessPolicy } from '@/domain/freshness';
import type { LogoService, LogoState } from './logo-service';
import { EMPTY_LOGO } from './logo-service';

export interface AssetWriterDeps {
  assets: AssetRepository;
  logos: LogoService;
  policy: FreshnessPolicy;
  now: () => Date;
}

const logoStateOf = (a: Pick<Asset, 'logo_url' | 'logo_path' | 'logo_source_url'>): LogoState => ({
  logo_url: a.logo_url,
  logo_path: a.logo_path,
  logo_source_url: a.logo_source_url,
});

/** Native assets take their name/symbol/decimals from the chain registry when providers lack them. */
function withNativeDefaults(chain: Chain, address: string | null, meta: CoinMetadata): CoinMetadata {
  if (address !== null) return meta;
  return {
    ...meta,
    name: meta.name ?? chain.native_name,
    symbol: meta.symbol ?? chain.native_symbol,
    decimals: chain.native_decimals,
    logo_source_url: meta.logo_source_url ?? chain.native_logo_url,
  };
}

/** The only component that persists asset metadata. Enforces override precedence. */
export class AssetWriter {
  constructor(private readonly d: AssetWriterDeps) {}

  /** Creates a new asset from provider data (or chain config only when `sources` is just `config`). */
  async createFromLookup(chain: Chain, address: string | null, lookup: FoundLookup): Promise<Asset> {
    const now = this.d.now();
    const meta = withNativeDefaults(chain, address, lookup.metadata);
    const logo = await this.d.logos.ensure({
      chainId: chain.chain_id,
      identifier: address ?? 'native',
      sourceUrl: meta.logo_source_url,
      current: EMPTY_LOGO,
    });
    const providerBacked = lookup.sources.some((s) => s !== 'config');
    const shape = { verification_status: 'unverified' as const, asset_type: address ? ('token' as const) : ('native' as const), coingecko_id: lookup.coingecko_id };
    const row: NewAsset = {
      identity_key: assetKey(chain.chain_id, address),
      chain_id: chain.chain_id,
      asset_type: shape.asset_type,
      contract_address: address,
      ...meta,
      ...logo,
      coingecko_id: lookup.coingecko_id,
      metadata_sources: lookup.sources,
      verification_status: shape.verification_status,
      has_override: false,
      metadata_fetched_at: now.toISOString(),
      next_refresh_at: (providerBacked
        ? nextRefreshAfterSuccess(tierFor(shape), now, this.d.policy)
        : nextRefreshAfterFailure(1, now, this.d.policy)
      ).toISOString(),
      refresh_failures: 0,
      last_refresh_error: null,
    };
    const asset = await this.d.assets.insert(row);
    await this.d.assets.upsertMappings(asset.id, lookup.mappings);
    return asset;
  }

  /** Applies fresh provider data to an existing asset. Overrides are re-applied on top. */
  async applyLookup(chain: Chain, existing: Asset, lookup: FoundLookup): Promise<Asset> {
    const now = this.d.now();
    const override = existing.has_override ? await this.d.assets.getOverride(existing.id) : null;

    // Fresh provider values win; previously stored values fill any gaps so nothing valid is lost.
    let meta = mergeMetadata(lookup.metadata, metadataOf(existing));
    meta = withNativeDefaults(chain, existing.contract_address, meta);
    if (override) meta = applyOverrides(meta, override.fields);

    const logo = await this.d.logos.ensure({
      chainId: chain.chain_id,
      identifier: existing.contract_address ?? 'native',
      sourceUrl: meta.logo_source_url,
      current: logoStateOf(existing),
    });
    const coingeckoId = lookup.coingecko_id ?? existing.coingecko_id;
    const tier = tierFor({ ...existing, coingecko_id: coingeckoId });
    const patch: AssetMetadataPatch = {
      ...meta,
      ...logo,
      coingecko_id: coingeckoId,
      metadata_sources: lookup.sources,
      metadata_fetched_at: now.toISOString(),
      next_refresh_at: nextRefreshAfterSuccess(tier, now, this.d.policy).toISOString(),
      refresh_failures: 0,
      last_refresh_error: null,
    };
    const updated = await this.d.assets.updateMetadata(existing.id, patch);
    await this.d.assets.upsertMappings(existing.id, lookup.mappings);
    return updated;
  }

  /** Registers an official Roka asset. The supplied fields are stored as an override so refreshes cannot undo them. */
  async createOfficial(
    chain: Chain,
    address: string | null,
    fields: Partial<CoinMetadata>,
    input: { verification: VerificationStatus; reason: string; actor: string },
  ): Promise<Asset> {
    const now = this.d.now();
    const meta = withNativeDefaults(chain, address, { ...emptyMetadata(), ...fields });
    const logo = await this.d.logos.ensure({
      chainId: chain.chain_id,
      identifier: address ?? 'native',
      sourceUrl: meta.logo_source_url,
      current: EMPTY_LOGO,
    });
    const shape = { verification_status: input.verification, asset_type: address ? ('token' as const) : ('native' as const), coingecko_id: null };
    const row: NewAsset = {
      identity_key: assetKey(chain.chain_id, address),
      chain_id: chain.chain_id,
      asset_type: shape.asset_type,
      contract_address: address,
      ...meta,
      ...logo,
      coingecko_id: null,
      metadata_sources: ['roka'],
      verification_status: input.verification,
      has_override: true,
      metadata_fetched_at: now.toISOString(),
      next_refresh_at: nextRefreshAfterSuccess(tierFor(shape), now, this.d.policy).toISOString(),
      refresh_failures: 0,
      last_refresh_error: null,
    };
    const asset = await this.d.assets.insert(row);
    await this.d.assets.saveOverride({ asset_id: asset.id, fields, reason: input.reason, approved_by: input.actor });
    return asset;
  }

  /** Re-applies stored overrides to the asset row (after an override changes) without calling providers. */
  async reapplyOverrides(chain: Chain, asset: Asset): Promise<Asset> {
    const override = await this.d.assets.getOverride(asset.id);
    if (!override) return asset;
    const meta = applyOverrides(metadataOf(asset), override.fields);
    const logo = await this.d.logos.ensure({
      chainId: chain.chain_id,
      identifier: asset.contract_address ?? 'native',
      sourceUrl: meta.logo_source_url,
      current: logoStateOf(asset),
    });
    const sources = asset.metadata_sources.includes('roka') ? asset.metadata_sources : [...asset.metadata_sources, 'roka'];
    return this.d.assets.updateMetadata(asset.id, { ...meta, ...logo, metadata_sources: sources });
  }
}

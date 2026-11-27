import { canonicalId } from '@/domain/address';
import type { Asset, Chain, RefreshJob } from '@/domain/types';

export function toChainDto(chain: Chain) {
  return {
    chain_id: chain.chain_id,
    name: chain.name,
    slug: chain.slug,
    family: chain.family,
    network_type: chain.network_type,
    native_asset: {
      name: chain.native_name,
      symbol: chain.native_symbol,
      decimals: chain.native_decimals,
    },
    is_active: chain.is_active,
  };
}

/** Canonical public representation. Raw provider responses are never exposed. */
export function toCoinDto(asset: Asset, chain: Chain, fallbackLogoUrl: string) {
  return {
    id: asset.id,
    identity: {
      canonical_id: canonicalId(asset.chain_id, asset.contract_address),
      chain_id: asset.chain_id,
      asset_type: asset.asset_type,
      contract_address: asset.contract_address,
    },
    chain: { chain_id: chain.chain_id, name: chain.name, slug: chain.slug },
    name: asset.name,
    symbol: asset.symbol,
    decimals: asset.decimals,
    description: asset.description,
    logo: { url: asset.logo_url ?? fallbackLogoUrl, is_fallback: asset.logo_url === null },
    links: {
      website: asset.website_url,
      twitter: asset.twitter_url,
      telegram: asset.telegram_url,
      discord: asset.discord_url,
      github: asset.github_url,
      other: asset.other_links,
    },
    coingecko_id: asset.coingecko_id,
    verification_status: asset.verification_status,
    metadata_sources: asset.metadata_sources,
    metadata_updated_at: asset.metadata_fetched_at ?? asset.updated_at,
  };
}

export function toAdminCoinDto(asset: Asset, chain: Chain, fallbackLogoUrl: string) {
  return {
    ...toCoinDto(asset, chain, fallbackLogoUrl),
    admin: {
      has_override: asset.has_override,
      logo_source_url: asset.logo_source_url,
      next_refresh_at: asset.next_refresh_at,
      refresh_failures: asset.refresh_failures,
      last_refresh_error: asset.last_refresh_error,
      created_at: asset.created_at,
      updated_at: asset.updated_at,
    },
  };
}

export const toJobDto = (job: RefreshJob) => ({ ...job });

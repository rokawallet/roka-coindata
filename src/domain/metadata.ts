import type { CoinMetadata } from './types';

export { emptyMetadata } from './normalize';

/** Picks the canonical metadata fields out of any object that carries them. */
export function metadataOf(source: CoinMetadata): CoinMetadata {
  return {
    name: source.name,
    symbol: source.symbol,
    decimals: source.decimals,
    description: source.description,
    logo_source_url: source.logo_source_url,
    website_url: source.website_url,
    twitter_url: source.twitter_url,
    telegram_url: source.telegram_url,
    discord_url: source.discord_url,
    github_url: source.github_url,
    other_links: { ...source.other_links },
  };
}

/** Field-wise merge: values from `primary` win, gaps are filled from `fallback`. */
export function mergeMetadata(primary: CoinMetadata, fallback: CoinMetadata): CoinMetadata {
  return {
    name: primary.name ?? fallback.name,
    symbol: primary.symbol ?? fallback.symbol,
    decimals: primary.decimals ?? fallback.decimals,
    description: primary.description ?? fallback.description,
    logo_source_url: primary.logo_source_url ?? fallback.logo_source_url,
    website_url: primary.website_url ?? fallback.website_url,
    twitter_url: primary.twitter_url ?? fallback.twitter_url,
    telegram_url: primary.telegram_url ?? fallback.telegram_url,
    discord_url: primary.discord_url ?? fallback.discord_url,
    github_url: primary.github_url ?? fallback.github_url,
    other_links: { ...fallback.other_links, ...primary.other_links },
  };
}

/** Administrator-approved overrides always win over provider data. */
export function applyOverrides(base: CoinMetadata, overrides: Partial<CoinMetadata>): CoinMetadata {
  return {
    name: overrides.name ?? base.name,
    symbol: overrides.symbol ?? base.symbol,
    decimals: overrides.decimals ?? base.decimals,
    description: overrides.description ?? base.description,
    logo_source_url: overrides.logo_source_url ?? base.logo_source_url,
    website_url: overrides.website_url ?? base.website_url,
    twitter_url: overrides.twitter_url ?? base.twitter_url,
    telegram_url: overrides.telegram_url ?? base.telegram_url,
    discord_url: overrides.discord_url ?? base.discord_url,
    github_url: overrides.github_url ?? base.github_url,
    other_links: { ...base.other_links, ...(overrides.other_links ?? {}) },
  };
}

/** Minimum bar for storing provider data: an asset needs both a name and a symbol. */
export function isUsable(meta: CoinMetadata): boolean {
  return meta.name !== null && meta.symbol !== null;
}

/** Complete enough that no secondary provider needs to be consulted. */
export function isComplete(meta: CoinMetadata): boolean {
  return isUsable(meta) && meta.decimals !== null && meta.logo_source_url !== null;
}

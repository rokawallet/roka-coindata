import { z } from 'zod';
import type { Chain } from '@/domain/types';
import { ProviderRateLimitedError, ProviderUnavailableError } from '@/domain/providers';
import type { MetadataProvider, ProviderResult } from '@/domain/providers';
import { getJson } from '../http';

export interface GeckoTerminalConfig {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
}

const str = z.string().nullish();

const tokenSchema = z.object({
  data: z.object({
    attributes: z.object({
      name: str,
      symbol: str,
      decimals: z.union([z.number(), z.string()]).nullish(),
      image_url: str,
      coingecko_coin_id: str,
    }),
  }),
});

const infoSchema = z.object({
  data: z.object({
    attributes: z.object({
      image_url: str,
      description: str,
      websites: z.array(z.string().nullish()).nullish(),
      discord_url: str,
      telegram_handle: str,
      twitter_handle: str,
      coingecko_coin_id: str,
    }),
  }),
});

/**
 * Secondary provider. Two requests per lookup: token (name, symbol, decimals) and token info
 * (logo, description, socials). Price data present in the first response is discarded.
 * The info request is best-effort; a failure there still yields the core token fields.
 */
export class GeckoTerminalProvider implements MetadataProvider {
  readonly id = 'geckoterminal' as const;
  readonly requestsPerLookup = 2;
  private readonly baseUrl: string;

  constructor(
    private readonly config: GeckoTerminalConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  supportsChain(chain: Chain): boolean {
    return chain.geckoterminal_network_id !== null;
  }

  async fetchToken(chain: Chain, address: string): Promise<ProviderResult | null> {
    const network = chain.geckoterminal_network_id;
    if (!network) return null;
    const base = `/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(address)}`;

    const tokenBody = await this.get(base);
    if (tokenBody === null) return null;
    const token = tokenSchema.safeParse(tokenBody);
    if (!token.success) throw new ProviderUnavailableError('GeckoTerminal returned an unexpected payload');
    const t = token.data.data.attributes;

    let info: z.infer<typeof infoSchema>['data']['attributes'] | null = null;
    try {
      const infoBody = await this.get(`${base}/info`);
      const parsed = infoBody === null ? null : infoSchema.safeParse(infoBody);
      info = parsed?.success ? parsed.data.data.attributes : null;
    } catch (error) {
      if (error instanceof ProviderRateLimitedError) throw error;
      // Other info failures are tolerated: core token data is still useful.
    }

    return {
      provider: 'geckoterminal',
      providerRef: `${network}_${address}`,
      coingeckoId: info?.coingecko_coin_id ?? t.coingecko_coin_id ?? null,
      raw: {
        name: t.name,
        symbol: t.symbol,
        decimals: t.decimals,
        description: info?.description,
        logoUrl: info?.image_url ?? t.image_url,
        websites: info?.websites ?? [],
        twitter: info?.twitter_handle,
        telegram: info?.telegram_handle,
        discord: info?.discord_url,
      },
    };
  }

  /** GeckoTerminal indexes DEX tokens; it has no native-asset metadata. */
  fetchNative(): Promise<ProviderResult | null> {
    return Promise.resolve(null);
  }

  async probe(): Promise<void> {
    const body = await this.get('/networks?page=1');
    if (body === null) throw new ProviderUnavailableError('GeckoTerminal networks returned 404');
  }

  private get(path: string): Promise<unknown> {
    return getJson(
      `${this.baseUrl}${path}`,
      {
        timeoutMs: this.config.timeoutMs,
        retries: this.config.retries,
        headers: { accept: 'application/json;version=20230302' },
      },
      this.fetchImpl,
    );
  }
}

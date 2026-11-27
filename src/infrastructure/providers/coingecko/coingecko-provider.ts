import { z } from 'zod';
import type { Chain } from '@/domain/types';
import { ProviderUnavailableError } from '@/domain/providers';
import type { MetadataProvider, ProviderResult } from '@/domain/providers';
import { getJson } from '../http';
import type { JsonRequestOptions } from '../http';

export interface CoinGeckoConfig {
  plan: 'public' | 'demo' | 'pro';
  apiKey?: string;
  baseUrl?: string;
  timeoutMs: number;
  retries: number;
}

const str = z.string().nullish();
const strList = z.array(z.string().nullish()).nullish();

/** Only the metadata fields we use. Anything else in the payload is ignored. */
const coinSchema = z.object({
  id: z.string().min(1),
  symbol: str,
  name: str,
  detail_platforms: z
    .record(z.object({ decimal_place: z.number().nullish(), contract_address: str }))
    .nullish(),
  description: z.object({ en: str }).nullish(),
  links: z
    .object({
      homepage: strList,
      twitter_screen_name: str,
      telegram_channel_identifier: str,
      subreddit_url: str,
      chat_url: strList,
      official_forum_url: strList,
      repos_url: z.object({ github: strList }).nullish(),
    })
    .nullish(),
  image: z.object({ large: str, small: str, thumb: str }).nullish(),
});

// Metadata only: every market/community/developer block is switched off.
const QUERY = 'localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false';

export class CoinGeckoProvider implements MetadataProvider {
  readonly id = 'coingecko' as const;
  readonly requestsPerLookup = 1;
  private readonly baseUrl: string;

  constructor(
    private readonly config: CoinGeckoConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = (
      config.baseUrl ??
      (config.plan === 'pro' ? 'https://pro-api.coingecko.com/api/v3' : 'https://api.coingecko.com/api/v3')
    ).replace(/\/+$/, '');
  }

  supportsChain(chain: Chain): boolean {
    return chain.coingecko_platform_id !== null;
  }

  async fetchToken(chain: Chain, address: string): Promise<ProviderResult | null> {
    if (!chain.coingecko_platform_id) return null;
    const platform = encodeURIComponent(chain.coingecko_platform_id);
    const body = await this.get(`/coins/${platform}/contract/${encodeURIComponent(address)}?${QUERY}`);
    if (body === null) return null;
    const coin = this.parse(body);
    const decimals = coin.detail_platforms?.[chain.coingecko_platform_id]?.decimal_place ?? null;
    return this.toResult(coin, decimals);
  }

  async fetchNative(chain: Chain): Promise<ProviderResult | null> {
    if (!chain.coingecko_native_id) return null;
    const body = await this.get(`/coins/${encodeURIComponent(chain.coingecko_native_id)}?${QUERY}`);
    if (body === null) return null;
    return this.toResult(this.parse(body), chain.native_decimals);
  }

  async probe(): Promise<void> {
    const body = await this.get('/ping');
    if (body === null) throw new ProviderUnavailableError('CoinGecko ping returned 404');
  }

  private get(path: string): Promise<unknown> {
    const options: JsonRequestOptions = {
      timeoutMs: this.config.timeoutMs,
      retries: this.config.retries,
      headers: this.authHeaders(),
    };
    return getJson(`${this.baseUrl}${path}`, options, this.fetchImpl);
  }

  private authHeaders(): Record<string, string> {
    if (!this.config.apiKey || this.config.plan === 'public') return {};
    return this.config.plan === 'pro'
      ? { 'x-cg-pro-api-key': this.config.apiKey }
      : { 'x-cg-demo-api-key': this.config.apiKey };
  }

  private parse(body: unknown): z.infer<typeof coinSchema> {
    const parsed = coinSchema.safeParse(body);
    if (!parsed.success) throw new ProviderUnavailableError('CoinGecko returned an unexpected payload');
    return parsed.data;
  }

  private toResult(coin: z.infer<typeof coinSchema>, decimals: number | null): ProviderResult {
    const links = coin.links ?? {};
    const github = (links.repos_url?.github ?? []).filter(Boolean);
    return {
      provider: 'coingecko',
      providerRef: coin.id,
      coingeckoId: coin.id,
      raw: {
        name: coin.name,
        symbol: coin.symbol,
        decimals,
        description: coin.description?.en,
        logoUrl: coin.image?.large ?? coin.image?.small ?? coin.image?.thumb,
        websites: links.homepage ?? [],
        links: [
          ...(links.chat_url ?? []),
          ...(links.official_forum_url ?? []),
          links.subreddit_url,
          ...github,
        ],
        twitter: links.twitter_screen_name,
        telegram: links.telegram_channel_identifier,
        github: github[0],
      },
    };
  }
}

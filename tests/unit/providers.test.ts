import { describe, expect, it } from 'vitest';
import { CoinGeckoProvider } from '@/infrastructure/providers/coingecko/coingecko-provider';
import { GeckoTerminalProvider } from '@/infrastructure/providers/geckoterminal/geckoterminal-provider';
import { ProviderRateLimitedError, ProviderUnavailableError } from '@/domain/providers';
import { normalizeMetadata } from '@/domain/normalize';
import { makeChain, USDC } from '../helpers/fakes';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers }));

describe('CoinGeckoProvider', () => {
  const cfg = { plan: 'demo' as const, apiKey: 'k', timeoutMs: 1000, retries: 1 };
  it('requests metadata-only data and maps the response', async () => {
    let seenUrl = ''; let seenHeaders: Record<string, string> = {};
    const fetchImpl = ((url: string, init: RequestInit) => {
      seenUrl = url; seenHeaders = init.headers as Record<string, string>;
      return json({
        id: 'usd-coin', symbol: 'usdc', name: 'USDC', detail_platforms: { ethereum: { decimal_place: 6, contract_address: USDC } },
        description: { en: 'Stable' }, links: { homepage: ['https://circle.com', ''], twitter_screen_name: 'circle', repos_url: { github: ['https://github.com/circlefin'] } },
        image: { large: 'https://assets.coingecko.com/coins/images/6319/large/usdc.png' },
      });
    }) as unknown as typeof fetch;
    const result = await new CoinGeckoProvider(cfg, fetchImpl).fetchToken(makeChain(), USDC);
    expect(seenUrl).toContain('/coins/ethereum/contract/' + USDC);
    expect(seenUrl).toContain('market_data=false');
    expect(seenHeaders['x-cg-demo-api-key']).toBe('k');
    const meta = normalizeMetadata(result!.raw);
    expect(meta.decimals).toBe(6);
    expect(meta.github_url).toBe('https://github.com/circlefin');
    expect(result!.coingeckoId).toBe('usd-coin');
  });
  it('returns null on 404, throws on 429 and bad payloads', async () => {
    const mk = (r: () => Promise<Response>) => new CoinGeckoProvider(cfg, (() => r()) as unknown as typeof fetch);
    expect(await mk(() => json({}, 404)).fetchToken(makeChain(), USDC)).toBeNull();
    await expect(mk(() => json({}, 429, { 'retry-after': '5' })).fetchToken(makeChain(), USDC)).rejects.toBeInstanceOf(ProviderRateLimitedError);
    await expect(mk(() => json({ nope: true })).fetchToken(makeChain(), USDC)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
  it('retries 5xx a bounded number of times', async () => {
    let calls = 0;
    const p = new CoinGeckoProvider(cfg, (() => { calls++; return json({}, 503); }) as unknown as typeof fetch);
    await expect(p.fetchToken(makeChain(), USDC)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(calls).toBe(2);
  });
});

describe('GeckoTerminalProvider', () => {
  it('combines token and info responses', async () => {
    const fetchImpl = ((url: string) =>
      url.endsWith('/info')
        ? json({ data: { attributes: { image_url: 'https://assets.geckoterminal.com/x.png', websites: ['https://tok.io'], twitter_handle: 'tok', description: 'Hi' } } })
        : json({ data: { attributes: { name: 'Tok', symbol: 'TOK', decimals: 18, image_url: 'missing.png' } } })) as unknown as typeof fetch;
    const p = new GeckoTerminalProvider({ baseUrl: 'https://api.geckoterminal.com/api/v2', timeoutMs: 1000, retries: 0 }, fetchImpl);
    const meta = normalizeMetadata((await p.fetchToken(makeChain(), USDC))!.raw);
    expect(meta).toMatchObject({ name: 'Tok', decimals: 18, website_url: 'https://tok.io', twitter_url: 'https://x.com/tok' });
  });
  it('tolerates info failures', async () => {
    const fetchImpl = ((url: string) =>
      url.endsWith('/info') ? json({}, 500) : json({ data: { attributes: { name: 'Tok', symbol: 'TOK', decimals: '9' } } })) as unknown as typeof fetch;
    const p = new GeckoTerminalProvider({ baseUrl: 'https://x.test/api/v2', timeoutMs: 1000, retries: 0 }, fetchImpl);
    expect(normalizeMetadata((await p.fetchToken(makeChain(), USDC))!.raw).decimals).toBe(9);
  });
});

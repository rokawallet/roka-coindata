import { describe, expect, it } from 'vitest';
import { ProviderRateLimitedError, ProviderUnavailableError } from '@/domain/providers';
import { buildHarness, FakeProvider, makeChain, providerResult, USDC, USDC_RAW } from '../helpers/fakes';

const ok = (id: 'coingecko' | 'geckoterminal' = 'coingecko') =>
  new FakeProvider(id, () => Promise.resolve(providerResult(id, USDC_RAW, 'usd-coin')));

describe('MetadataService (in-memory repositories, mocked providers)', () => {
  it('read-through: miss fetches, stores and mirrors the logo; second read is a cache hit', async () => {
    const p = ok();
    const h = buildHarness([p]);
    const first = await h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background });
    expect(first.cache).toBe('miss');
    expect(first.asset.symbol).toBe('USDC');
    expect(first.asset.description).toBe('Stablecoin');
    expect(first.asset.logo_url).toContain(`1/${USDC}.png`);
    expect(h.stored).toEqual([`1/${USDC}.png`]);
    const second = await h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background });
    expect(second.cache).toBe('hit');
    expect(p.calls).toBe(1);
  });

  it('collapses concurrent requests for the same asset into one provider call', async () => {
    const p = ok();
    const h = buildHarness([p]);
    const args = { chainId: 1, address: USDC, allowDiscovery: true, background: h.background };
    await Promise.all([h.metadata.getToken(args), h.metadata.getToken(args), h.metadata.getToken(args)]);
    expect(p.calls).toBe(1);
  });

  it('falls back to the secondary provider and merges gaps', async () => {
    const primary = new FakeProvider('coingecko', () => Promise.reject(new ProviderRateLimitedError(5)));
    const secondary = ok('geckoterminal');
    const h = buildHarness([primary, secondary]);
    const r = await h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background });
    expect(r.asset.metadata_sources).toEqual(['geckoterminal']);
    expect(primary.calls).toBe(1);
  });

  it('fills missing fields from a second provider when the first is incomplete', async () => {
    const partial = new FakeProvider('coingecko', () => Promise.resolve(providerResult('coingecko', { name: 'USD Coin', symbol: 'USDC' })));
    const full = ok('geckoterminal');
    const h = buildHarness([partial, full]);
    const r = await h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background });
    expect(r.asset.decimals).toBe(6);
    expect(r.asset.metadata_sources).toEqual(['coingecko', 'geckoterminal']);
  });

  it('returns 503 when every provider fails and stores nothing', async () => {
    const h = buildHarness([new FakeProvider('coingecko', () => Promise.reject(new ProviderUnavailableError('down')))]);
    await expect(h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background })).rejects.toMatchObject({ status: 503 });
    expect(h.assets.rows.size).toBe(0);
  });

  it('unknown tokens get a cooldown so providers are not hammered', async () => {
    const p = new FakeProvider('coingecko', () => Promise.resolve(null));
    const h = buildHarness([p]);
    const args = { chainId: 1, address: USDC, allowDiscovery: true, background: h.background };
    await expect(h.metadata.getToken(args)).rejects.toMatchObject({ status: 404 });
    await expect(h.metadata.getToken(args)).rejects.toMatchObject({ status: 404 });
    expect(p.calls).toBe(1);
    h.clock.t = new Date(h.clock.t.getTime() + 61_000);
    await expect(h.metadata.getToken(args)).rejects.toMatchObject({ status: 404 });
    expect(p.calls).toBe(2);
  });

  it('does not discover when discovery is disabled', async () => {
    const p = ok();
    const h = buildHarness([p]);
    await expect(h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: false, background: h.background })).rejects.toMatchObject({ status: 404 });
    expect(p.calls).toBe(0);
  });

  it('rejects unsupported or inactive chains', async () => {
    const h = buildHarness([ok()], [makeChain({ is_active: false })]);
    await expect(h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background })).rejects.toMatchObject({ status: 404 });
    await expect(h.metadata.getToken({ chainId: 999, address: USDC, allowDiscovery: true, background: h.background })).rejects.toMatchObject({ status: 404 });
  });

  it('stale-while-revalidate: serves stale immediately and refreshes in the background', async () => {
    const p = ok();
    const h = buildHarness([p]);
    const args = { chainId: 1, address: USDC, allowDiscovery: true, background: h.background };
    await h.metadata.getToken(args);
    h.clock.t = new Date(h.clock.t.getTime() + 400_000);
    const stale = await h.metadata.getToken(args);
    expect(stale.cache).toBe('stale');
    expect(p.calls).toBe(1);
    await h.flush();
    expect(p.calls).toBe(2);
    expect((await h.metadata.getToken(args)).cache).toBe('hit');
  });

  it('provider failure during refresh preserves cached metadata and backs off', async () => {
    const p = ok();
    const h = buildHarness([p]);
    const args = { chainId: 1, address: USDC, allowDiscovery: true, background: h.background };
    await h.metadata.getToken(args);
    h.clock.t = new Date(h.clock.t.getTime() + 400_000);
    p.behavior = () => Promise.reject(new ProviderUnavailableError('down'));
    const stale = await h.metadata.getToken(args);
    await h.flush();
    const after = await h.assets.findToken(1, USDC);
    expect(after?.name).toBe(stale.asset.name);
    expect(after?.logo_url).toBe(stale.asset.logo_url);
    expect(after?.refresh_failures).toBe(1);
    expect(new Date(after!.next_refresh_at).getTime()).toBeGreaterThan(h.clock.t.getTime());
  });

  it('never overwrites an administrator override on refresh', async () => {
    const p = ok();
    const h = buildHarness([p]);
    const args = { chainId: 1, address: USDC, allowDiscovery: true, background: h.background };
    const { asset, chain } = await h.metadata.getToken(args);
    await h.assets.saveOverride({ asset_id: asset.id, fields: { name: 'Official USDC', website_url: 'https://roka.example.com' }, reason: 'official', approved_by: 'admin' });
    await h.assets.setHasOverride(asset.id, true);
    const refreshed = await h.refresh.refreshAsset(chain, (await h.assets.findById(asset.id))!, 'manual');
    expect(refreshed.asset.name).toBe('Official USDC');
    expect(refreshed.asset.website_url).toBe('https://roka.example.com');
    expect(refreshed.asset.symbol).toBe('USDC');
  });

  it('official registration stores fields as an override that survives refresh', async () => {
    const p = ok();
    const h = buildHarness([p]);
    const chain = makeChain();
    const created = await h.writer.createOfficial(chain, USDC, { name: 'Roka Dollar', symbol: 'RUSD', decimals: 6 }, { verification: 'verified', reason: 'launch', actor: 'admin' });
    expect(created.verification_status).toBe('verified');
    const refreshed = await h.refresh.refreshAsset(chain, created, 'manual');
    expect(refreshed.asset.name).toBe('Roka Dollar');
    expect(refreshed.asset.verification_status).toBe('verified');
  });

  it('skips a refresh when another worker already holds the job', async () => {
    const h = buildHarness([ok()]);
    const { asset, chain } = await h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background });
    await h.jobs.startInline({ asset_id: asset.id, asset_key: asset.identity_key, chain_id: 1, contract_address: USDC, job_type: 'refresh', priority: 1 });
    const r = await h.refresh.refreshAsset(chain, asset, 'manual');
    expect(r.skipped).toBe(true);
  });

  it('hides rejected assets', async () => {
    const h = buildHarness([ok()]);
    const { asset } = await h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background });
    await h.assets.setVerification(asset.id, 'rejected');
    await expect(h.metadata.getToken({ chainId: 1, address: USDC, allowDiscovery: true, background: h.background })).rejects.toMatchObject({ status: 404 });
  });

  it('native assets fall back to the chain registry when providers are down', async () => {
    const h = buildHarness([new FakeProvider('coingecko', () => Promise.reject(new ProviderUnavailableError('down')))]);
    const r = await h.metadata.getNative({ chainId: 1, background: h.background });
    expect(r.asset).toMatchObject({ asset_type: 'native', symbol: 'ETH', decimals: 18, metadata_sources: ['config'] });
    expect(new Date(r.asset.next_refresh_at).getTime() - h.clock.t.getTime()).toBe(10_000);
  });
});

import { describe, expect, it } from 'vitest';
import { loadEnv } from '@/config/env';

const base = {
  APP_BASE_URL: 'https://coins.example.com',
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
  API_KEY_PEPPER: 'p'.repeat(32),
  CRON_SECRET: 'c'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults and parses lists', () => {
    const env = loadEnv({ ...base, CORS_ALLOWED_ORIGINS: 'https://a.com, https://b.com', COINGECKO_API_KEY: '' });
    expect(env.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
    expect(env.providerOrder).toEqual(['coingecko', 'geckoterminal']);
    expect(env.COINGECKO_API_KEY).toBeUndefined();
    expect(env.PUBLIC_DISCOVERY_ENABLED).toBe(true);
  });
  it('fails without leaking values', () => {
    expect(() => loadEnv({ ...base, API_KEY_PEPPER: 'short-secret-value' })).toThrow(/API_KEY_PEPPER/);
    try { loadEnv({ ...base, API_KEY_PEPPER: 'short-secret-value' }); } catch (e) { expect(String(e).includes('short-secret-value')).toBe(false); }
    expect(() => loadEnv({ ...base, PROVIDER_ORDER: 'coingecko,nope' })).toThrow(/PROVIDER_ORDER/);
  });
});

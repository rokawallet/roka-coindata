import { describe, expect, it } from 'vitest';
import type { ApiKeyRepository } from '@/domain/ports';
import type { ApiKeyRecord } from '@/domain/types';
import { resolvePrincipal } from '@/interfaces/http/auth';
import { generateApiKey, hashApiKey } from '@/security/api-keys';

const pepper = 'p'.repeat(32);
const now = new Date('2026-06-01T00:00:00Z');

function setup(over: Partial<ApiKeyRecord> = {}) {
  const { key, prefix } = generateApiKey();
  const record: ApiKeyRecord = {
    id: 'k1', name: 'RokaWallet', key_prefix: prefix, key_hash: hashApiKey(key, pepper),
    scopes: ['read'], is_active: true, expires_at: null, last_used_at: null, ...over,
  };
  const repo: ApiKeyRepository = {
    findActiveByPrefix: (p) => Promise.resolve(p === prefix ? record : null),
    touch: () => Promise.resolve(),
  };
  return { key, repo };
}
const headers = (v?: string) => new Headers(v ? { authorization: v } : {});

describe('resolvePrincipal', () => {
  it('treats a missing header as anonymous', async () => {
    expect(await resolvePrincipal(headers(), setup().repo, pepper, now)).toBeNull();
  });
  it('accepts a valid key', async () => {
    const { key, repo } = setup({ scopes: ['read', 'admin'] });
    expect(await resolvePrincipal(headers(`Bearer ${key}`), repo, pepper, now)).toMatchObject({ id: 'k1', scopes: ['read', 'admin'] });
  });
  it('rejects bad, tampered, wrong-pepper and expired keys with 401', async () => {
    const { key, repo } = setup();
    await expect(resolvePrincipal(headers('Bearer nonsense'), repo, pepper, now)).rejects.toMatchObject({ status: 401 });
    await expect(resolvePrincipal(headers(`Bearer ${key.slice(0, -1)}A`), repo, pepper, now)).rejects.toMatchObject({ status: 401 });
    await expect(resolvePrincipal(headers(`Bearer ${key}`), repo, 'q'.repeat(32), now)).rejects.toMatchObject({ status: 401 });
    const expired = setup({ expires_at: '2026-01-01T00:00:00Z' });
    await expect(resolvePrincipal(headers(`Bearer ${expired.key}`), expired.repo, pepper, now)).rejects.toMatchObject({ status: 401 });
    await expect(resolvePrincipal(headers('Basic abc'), repo, pepper, now)).rejects.toMatchObject({ status: 401 });
  });
});

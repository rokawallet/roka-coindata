import type { ApiKeyRepository } from '@/domain/ports';
import { errors } from '@/errors';
import { parseApiKey, verifyApiKeyHash } from '@/security/api-keys';

export interface Principal {
  id: string;
  name: string;
  scopes: string[];
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Resolves the caller from `Authorization: Bearer <api key>`.
 * No header -> null (anonymous). A header that is present but invalid -> 401, so bad credentials
 * are never silently downgraded to anonymous access.
 */
export async function resolvePrincipal(
  headers: Headers,
  keys: ApiKeyRepository,
  pepper: string,
  now: Date,
): Promise<Principal | null> {
  const header = headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const key = match?.[1];
  const parsed = key ? parseApiKey(key) : null;
  if (!key || !parsed) throw errors.unauthorized('Invalid credentials');

  const record = await keys.findActiveByPrefix(parsed.prefix);
  const valid =
    record !== null &&
    verifyApiKeyHash(key, record.key_hash, pepper) &&
    (record.expires_at === null || new Date(record.expires_at) > now);
  if (!record || !valid) throw errors.unauthorized('Invalid credentials');

  if (!record.last_used_at || now.getTime() - new Date(record.last_used_at).getTime() > TOUCH_INTERVAL_MS) {
    keys.touch(record.id).catch(() => undefined); // best effort; must not fail the request
  }
  return { id: record.id, name: record.name, scopes: record.scopes };
}

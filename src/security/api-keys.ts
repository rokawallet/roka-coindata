import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_PATTERN = /^rcd_([a-f0-9]{12})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  key: string;
  prefix: string;
}

/** Format: rcd_<12 hex prefix>_<43 char base64url secret (256 bits)>. Shown once, stored only as HMAC. */
export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { key: `rcd_${prefix}_${secret}`, prefix };
}

export function parseApiKey(key: string): { prefix: string } | null {
  const match = KEY_PATTERN.exec(key);
  return match?.[1] ? { prefix: match[1] } : null;
}

/** HMAC-SHA256 keyed with a server-side pepper; keys are high-entropy so no slow hash is required. */
export function hashApiKey(key: string, pepper: string): string {
  return createHmac('sha256', pepper).update(key).digest('hex');
}

export function verifyApiKeyHash(key: string, expectedHex: string, pepper: string): boolean {
  const actual = Buffer.from(hashApiKey(key, pepper), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Constant-time string comparison for shared secrets such as CRON_SECRET. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

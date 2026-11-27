import { describe, expect, it } from 'vitest';
import { assertSafeHttpsUrl, isBlockedIp } from '@/security/url-guard';
import { sniffImage } from '@/security/image';
import { generateApiKey, hashApiKey, parseApiKey, safeEqual, verifyApiKeyHash } from '@/security/api-keys';

describe('SSRF guard', () => {
  it('blocks private, loopback, link-local, metadata and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', 'not-an-ip']) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });
  it('allows public addresses', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });
  it('rejects unsafe URLs', () => {
    for (const bad of ['http://example.com/a.png', 'https://localhost/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://169.254.169.254/latest', 'https://example.com:8443/a.png', 'https://u:p@example.com/a.png', 'https://printer.local/a.png', 'https://svc.internal/a.png', 'file:///etc/passwd', 'nonsense']) {
      expect(() => assertSafeHttpsUrl(bad)).toThrow();
    }
    expect(assertSafeHttpsUrl('https://assets.example.com/a.png').hostname).toBe('assets.example.com');
  });
});

describe('image sniffing', () => {
  const pad = (b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
  it('accepts png, jpeg, gif, webp', () => {
    expect(sniffImage(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.extension).toBe('png');
    expect(sniffImage(pad([0xff, 0xd8, 0xff, 0xe0]))?.extension).toBe('jpg');
    expect(sniffImage(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))?.extension).toBe('gif');
    expect(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]))?.extension).toBe('webp');
  });
  it('rejects svg, html and short input', () => {
    const enc = (s: string) => new TextEncoder().encode(s.padEnd(32, ' '));
    expect(sniffImage(enc('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(enc('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('api keys', () => {
  const pepper = 'p'.repeat(32);
  it('generates parseable keys and verifies hashes', () => {
    const { key, prefix } = generateApiKey();
    expect(parseApiKey(key)?.prefix).toBe(prefix);
    const hash = hashApiKey(key, pepper);
    expect(verifyApiKeyHash(key, hash, pepper)).toBe(true);
    expect(verifyApiKeyHash(key + 'x', hash, pepper)).toBe(false);
    expect(verifyApiKeyHash(key, hash, 'q'.repeat(32))).toBe(false);
    expect(hash.includes(key)).toBe(false);
  });
  it('rejects malformed keys', () => {
    expect(parseApiKey('rcd_short')).toBeNull();
    expect(parseApiKey('Bearer abc')).toBeNull();
  });
  it('compares secrets in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

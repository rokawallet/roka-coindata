import { describe, expect, it } from 'vitest';
import { assetKey, canonicalId, isEvmAddress, normalizeEvmAddress } from '@/domain/address';

describe('address', () => {
  it('normalizes to lowercase', () => {
    expect(normalizeEvmAddress('0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });
  it('rejects malformed addresses', () => {
    for (const bad of ['', '0x123', 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xZ0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0x' + 'a'.repeat(41)]) {
      expect(normalizeEvmAddress(bad)).toBeNull();
      expect(isEvmAddress(bad)).toBe(false);
    }
  });
  it('rejects the zero address', () => {
    expect(normalizeEvmAddress('0x' + '0'.repeat(40))).toBeNull();
  });
  it('builds identity keys that separate chains', () => {
    const a = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    expect(assetKey(1, a)).not.toBe(assetKey(8453, a));
    expect(assetKey(1, null)).toBe('1:native');
    expect(canonicalId(1, a)).toBe(`eip155:1/erc20:${a}`);
    expect(canonicalId(42220, null)).toBe('eip155:42220/native');
  });
});

import { describe, expect, it } from 'vitest';
import { applyOverrides, emptyMetadata, isComplete, isUsable, mergeMetadata } from '@/domain/metadata';

describe('metadata merge and overrides', () => {
  const a = { ...emptyMetadata(), name: 'A', symbol: 'A', other_links: { reddit: 'https://reddit.com/r/a' } };
  const b = { ...emptyMetadata(), name: 'B', decimals: 6, logo_source_url: 'https://x.example.com/l.png', other_links: { medium: 'https://medium.com/a' } };
  it('primary wins, gaps are filled', () => {
    const m = mergeMetadata(a, b);
    expect(m.name).toBe('A');
    expect(m.decimals).toBe(6);
    expect(m.other_links).toEqual({ medium: 'https://medium.com/a', reddit: 'https://reddit.com/r/a' });
  });
  it('overrides always win', () => {
    expect(applyOverrides(a, { name: 'Official' }).name).toBe('Official');
    expect(applyOverrides(a, {}).name).toBe('A');
  });
  it('usable / complete', () => {
    expect(isUsable(a)).toBe(true);
    expect(isUsable(emptyMetadata())).toBe(false);
    expect(isComplete(a)).toBe(false);
    expect(isComplete(mergeMetadata(a, b))).toBe(true);
  });
});

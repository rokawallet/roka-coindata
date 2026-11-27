import { describe, expect, it } from 'vitest';
import { cleanDescription, normalizeMetadata, normalizeTelegram, normalizeTwitter, normalizeUrl } from '@/domain/normalize';

describe('normalizeUrl', () => {
  it('upgrades to https, strips fragments and trailing root slash', () => {
    expect(normalizeUrl('http://Example.com/#top')).toBe('https://example.com');
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
  });
  it('rejects unsafe or invalid values', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'https://user:pw@example.com', 'https://localhost', 'https://127.0.0.1', 'https://example.com:8080', 'not a url', '', null, 42]) {
      expect(normalizeUrl(bad)).toBeNull();
    }
  });
});

describe('social normalization', () => {
  it('converts handles and URLs', () => {
    expect(normalizeTwitter('@circle')).toBe('https://x.com/circle');
    expect(normalizeTwitter('https://twitter.com/circle?lang=en')).toBe('https://x.com/circle');
    expect(normalizeTwitter('https://twitter.com/intent/tweet')).toBeNull();
    expect(normalizeTwitter('https://evil.com/circle')).toBeNull();
    expect(normalizeTelegram('circle_chat')).toBe('https://t.me/circle_chat');
  });
});

describe('normalizeMetadata', () => {
  it('handles missing fields without throwing', () => {
    const m = normalizeMetadata({});
    expect(m.name).toBeNull();
    expect(m.other_links).toEqual({});
  });
  it('strips HTML from descriptions and drops empty ones', () => {
    expect(cleanDescription('<p>Hello <b>world</b> &amp; all</p>')).toBe('Hello world & all');
    expect(cleanDescription('   ')).toBeNull();
  });
  it('drops placeholder logos and invalid decimals', () => {
    const m = normalizeMetadata({ name: 'X', symbol: 'X', decimals: 300, logoUrl: 'https://assets.example.com/missing.png' });
    expect(m.logo_source_url).toBeNull();
    expect(m.decimals).toBeNull();
    expect(normalizeMetadata({ decimals: '6' }).decimals).toBe(6);
  });
  it('classifies links, picks a real website and dedupes socials', () => {
    const m = normalizeMetadata({
      name: 'T', symbol: 'T',
      websites: ['https://twitter.com/tok', 'https://tok.io'],
      links: ['https://t.me/tokchat', 'https://reddit.com/r/tok', 'https://github.com/tok/repo/issues'],
      twitter: 'tok',
    });
    expect(m.website_url).toBe('https://tok.io');
    expect(m.twitter_url).toBe('https://x.com/tok');
    expect(m.telegram_url).toBe('https://t.me/tokchat');
    expect(m.github_url).toBe('https://github.com/tok/repo');
    expect(m.other_links).toEqual({ reddit: 'https://reddit.com/r/tok' });
  });
});

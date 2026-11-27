import { isIP } from 'node:net';
import type { CoinMetadata } from './types';

/** Loosely typed provider-agnostic input; every field may be missing or malformed. */
export interface RawMetadata {
  name?: unknown;
  symbol?: unknown;
  decimals?: unknown;
  description?: unknown;
  logoUrl?: unknown;
  websites?: readonly unknown[];
  links?: readonly unknown[];
  twitter?: unknown;
  telegram?: unknown;
  discord?: unknown;
  github?: unknown;
}

const MAX_NAME = 100;
const MAX_SYMBOL = 32;
const MAX_DESCRIPTION = 2000;
const MAX_URL = 2048;

function replaceControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out;
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = replaceControlChars(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/** Strips HTML, decodes a few harmless entities and collapses whitespace. Output is plain text. */
export function cleanDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const stripped = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return cleanText(stripped, MAX_DESCRIPTION);
}

export function normalizeDecimals(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
}

/** Returns a clean https URL without credentials, fragment or non-default port; otherwise null. */
export function normalizeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL || /\s/.test(raw)) return null;
  const candidate = raw.includes('://') ? raw : `https://${raw.replace(/^\/\//, '')}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || isIP(host.replace(/^\[|\]$/g, ''))) {
    return null;
  }
  url.protocol = 'https:';
  url.hash = '';
  let out = url.toString();
  if (url.pathname === '/' && !url.search) out = out.replace(/\/$/, '');
  return out.length <= MAX_URL ? out : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

const TWITTER_HANDLE = /^@?([A-Za-z0-9_]{1,50})$/;
const TELEGRAM_HANDLE = /^@?([A-Za-z0-9_]{3,64})$/;
const TWITTER_RESERVED = new Set(['i', 'intent', 'share', 'home', 'search', 'hashtag', 'explore']);

export function normalizeTwitter(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();
  const handle = TWITTER_HANDLE.exec(s);
  if (handle) return `https://x.com/${handle[1]}`;
  const url = normalizeUrl(s);
  const host = url && hostOf(url);
  if (!url || (host !== 'twitter.com' && host !== 'x.com')) return null;
  const segment = new URL(url).pathname.split('/').filter(Boolean)[0];
  if (!segment || !TWITTER_HANDLE.test(segment) || TWITTER_RESERVED.has(segment.toLowerCase())) return null;
  return `https://x.com/${segment}`;
}

export function normalizeTelegram(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();
  const handle = TELEGRAM_HANDLE.exec(s);
  if (handle) return `https://t.me/${handle[1]}`;
  const url = normalizeUrl(s);
  const host = url && hostOf(url);
  if (!url || (host !== 't.me' && host !== 'telegram.me' && host !== 'telegram.dog')) return null;
  const path = new URL(url).pathname.replace(/\/+$/, '');
  return path.length > 1 ? `https://t.me${path}` : null;
}

export function normalizeDiscord(value: unknown): string | null {
  const url = normalizeUrl(value);
  const host = url && hostOf(url);
  if (!url || !host) return null;
  if (host !== 'discord.gg' && host !== 'discord.com' && host !== 'discordapp.com') return null;
  const parsed = new URL(url);
  return parsed.pathname.length > 1 ? `https://${host}${parsed.pathname.replace(/\/+$/, '')}` : null;
}

export function normalizeGithub(value: unknown): string | null {
  const url = normalizeUrl(value);
  if (!url || hostOf(url) !== 'github.com') return null;
  const parts = new URL(url).pathname.split('/').filter(Boolean).slice(0, 2);
  return parts.length > 0 && parts.every((p) => /^[A-Za-z0-9._-]+$/.test(p))
    ? `https://github.com/${parts.join('/')}`
    : null;
}

const OTHER_HOSTS: Record<string, string> = {
  'reddit.com': 'reddit',
  'medium.com': 'medium',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'linkedin.com': 'linkedin',
  'warpcast.com': 'farcaster',
};

type LinkKind = 'twitter' | 'telegram' | 'discord' | 'github' | string | null;

function classify(url: string): LinkKind {
  const host = hostOf(url);
  if (!host) return null;
  if (host === 'twitter.com' || host === 'x.com') return 'twitter';
  if (host === 't.me' || host === 'telegram.me' || host === 'telegram.dog') return 'telegram';
  if (host === 'discord.gg' || host === 'discord.com' || host === 'discordapp.com') return 'discord';
  if (host === 'github.com') return 'github';
  return OTHER_HOSTS[host.replace(/^(old|m)\./, '')] ?? null;
}

const MISSING_IMAGE = /missing(_\w+)?\.(png|jpe?g|webp|gif)/i;

export function emptyMetadata(): CoinMetadata {
  return {
    name: null,
    symbol: null,
    decimals: null,
    description: null,
    logo_source_url: null,
    website_url: null,
    twitter_url: null,
    telegram_url: null,
    discord_url: null,
    github_url: null,
    other_links: {},
  };
}

/** Converts untrusted provider data into the canonical metadata model. Never throws. */
export function normalizeMetadata(raw: RawMetadata): CoinMetadata {
  const websites = (raw.websites ?? []).map(normalizeUrl).filter((u): u is string => u !== null);
  const candidates = [...(raw.links ?? []), ...(raw.websites ?? [])]
    .map(normalizeUrl)
    .filter((u): u is string => u !== null);

  let twitter = normalizeTwitter(raw.twitter);
  let telegram = normalizeTelegram(raw.telegram);
  let discord = normalizeDiscord(raw.discord);
  let github = normalizeGithub(raw.github);
  const other: Record<string, string> = {};

  for (const url of candidates) {
    const kind = classify(url);
    if (kind === 'twitter') twitter ??= normalizeTwitter(url);
    else if (kind === 'telegram') telegram ??= normalizeTelegram(url);
    else if (kind === 'discord') discord ??= normalizeDiscord(url);
    else if (kind === 'github') github ??= normalizeGithub(url);
    else if (kind && !other[kind]) other[kind] = url;
  }

  const logo = normalizeUrl(raw.logoUrl);
  return {
    name: cleanText(raw.name, MAX_NAME),
    symbol: cleanText(raw.symbol, MAX_SYMBOL),
    decimals: normalizeDecimals(raw.decimals),
    description: cleanDescription(raw.description),
    logo_source_url: logo && !MISSING_IMAGE.test(logo) ? logo : null,
    website_url: websites.find((w) => classify(w) === null) ?? null,
    twitter_url: twitter,
    telegram_url: telegram,
    discord_url: discord,
    github_url: github,
    other_links: other,
  };
}

import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import dns from 'node:dns';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, includes cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** True when the address is private, loopback, link-local, reserved, or not an IP at all. */
export function isBlockedIp(address: string): boolean {
  const ip = address.split('%')[0] ?? '';
  const family = isIP(ip);
  if (family === 0) return true;
  if (family === 6) {
    // Reject IPv4-mapped IPv6 (::ffff:a.b.c.d) in any spelling: it can smuggle private IPv4 targets.
    // (Not done via BlockList: Node treats every IPv4 address as a member of ::ffff:0:0/96.)
    try {
      if (new URL(`http://[${ip}]`).hostname.startsWith('[::ffff:')) return true;
    } catch {
      return true;
    }
  }
  return blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa'];

/**
 * Syntactic URL validation: https only, no credentials, default port, public-looking hostname.
 * IP-literal hosts are rejected outright. DNS results are re-checked at connect time (see guardedLookup).
 */
export function assertSafeHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('Only https URLs are allowed');
  if (url.username || url.password) throw new UnsafeUrlError('Credentials in URLs are not allowed');
  if (url.port && url.port !== '443') throw new UnsafeUrlError('Non-standard ports are not allowed');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || (!host.includes('.') && isIP(host) === 0)) {
    throw new UnsafeUrlError('Host is not allowed');
  }
  if (isIP(host) !== 0) throw new UnsafeUrlError('IP address hosts are not allowed');
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new UnsafeUrlError('Host is not allowed');
  return url;
}

/**
 * DNS lookup that refuses to resolve to blocked addresses. Plugged into the HTTP agent so the check
 * happens on the address actually connected to, which defeats DNS rebinding.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '', 4);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || list.some((a) => isBlockedIp(a.address))) {
      return callback(new UnsafeUrlError('Host resolves to a disallowed address'), '', 4);
    }
    if (options.all) {
      // Node >= 20 may request all addresses (happy eyeballs).
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    }
    const first = list[0];
    return callback(null, first.address, first.family);
  });
};

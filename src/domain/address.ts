const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const NATIVE_REF = 'native';

export function isEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(value);
}

/**
 * Canonical form used for all database lookups: lowercase 0x-prefixed hex.
 * Returns null for malformed input and for the zero address (which is not a token).
 * EIP-55 checksum casing is accepted but not required; it is not used for identity.
 */
export function normalizeEvmAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!EVM_ADDRESS.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  return lower === ZERO_ADDRESS ? null : lower;
}

/** Stable identity key: chain_id + normalized address, or chain_id + "native". */
export function assetKey(chainId: number, address: string | null): string {
  return `${chainId}:${address ?? NATIVE_REF}`;
}

/** CAIP-style identifier for API consumers. */
export function canonicalId(chainId: number, address: string | null): string {
  return address ? `eip155:${chainId}/erc20:${address}` : `eip155:${chainId}/native`;
}

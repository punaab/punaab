import { getAddress, isAddress } from "viem";

/** Valid EVM address (0x + 40 hex). Returns checksummed address. */
export function normalizeEvmAddress(addr: string | undefined): string | undefined {
  if (!addr?.trim()) return undefined;
  const trimmed = addr.trim();
  if (!isAddress(trimmed)) return undefined;
  try {
    return getAddress(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
}

/** Valid Solana base58 pubkey (not an 0x EVM address). */
export function isSolanaAddress(addr: string | undefined): boolean {
  if (!addr?.trim()) return false;
  const a = addr.trim();
  if (a.startsWith("0x")) return false;
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

export function normalizeSolanaAddress(addr: string | undefined): string | undefined {
  if (!isSolanaAddress(addr)) return undefined;
  return addr!.trim();
}

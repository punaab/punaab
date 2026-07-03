/**
 * Alchemy Portfolio / NFT / Token / Transfers — server-side only, Redis-cached.
 * Dashboard loads cached snapshot; optional manual refresh via /api/admin/alchemy/refresh.
 */
import { getCached } from "./alchemy-cache";
import {
  getAlchemyApiKey,
  getAlchemyHoldingsCacheSec,
  getTradingBaseAddress,
  getTradingSolanaAddress,
  getWatchTargets,
} from "./config";
import { fetchSolanaWalletHoldings } from "./solana-alchemy";

const PORTFOLIO_BASE = "https://api.g.alchemy.com/data/v1";
const CACHE_KEY = "moltbook:alchemy:dashboard";

export interface PortfolioTokenRow {
  network: string;
  address: string;
  tokenAddress: string | null;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  isNative: boolean;
}

export interface NftRow {
  network: string;
  owner: string;
  contract: string;
  tokenId: string;
  name: string;
  imageUrl?: string;
  collectionName?: string;
}

export interface TokenApiRow {
  network: string;
  address: string;
  contractAddress: string;
  balance: string;
  symbol?: string;
  name?: string;
  decimals?: number;
}

export interface TransferRow {
  network: string;
  hash: string;
  from: string;
  to: string;
  asset: string;
  category: string;
  value: string;
  blockNum: string;
  timestamp?: string;
}

export interface AlchemyApiSnapshot {
  fetchedAt: string;
  cacheSec: number;
  configured: boolean;
  primaryBase?: string;
  primarySolana?: string;
  portfolio: {
    tokens: PortfolioTokenRow[];
    error?: string;
  };
  nfts: {
    items: NftRow[];
    totalCount: number;
    error?: string;
  };
  tokens: {
    items: TokenApiRow[];
    error?: string;
  };
  transfers: {
    items: TransferRow[];
    error?: string;
  };
}

function emptySnapshot(configured: boolean, cacheSec: number): AlchemyApiSnapshot {
  return {
    fetchedAt: new Date().toISOString(),
    cacheSec,
    configured,
    portfolio: { tokens: [] },
    nfts: { items: [], totalCount: 0 },
    tokens: { items: [] },
    transfers: { items: [] },
  };
}

function hexToDecimal(hex: string): string {
  if (!hex || hex === "0x") return "0";
  try {
    return BigInt(hex).toString();
  } catch {
    return "0";
  }
}

function formatTokenBalance(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  try {
    const n = BigInt(raw.startsWith("0x") ? hexToDecimal(raw) : raw);
    if (decimals <= 0) return n.toString();
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = n / divisor;
    const frac = n % divisor;
    if (frac === BigInt(0)) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole}.${fracStr}`;
  } catch {
    return raw;
  }
}

async function portfolioPost<T>(apiKey: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PORTFOLIO_BASE}/${apiKey}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Portfolio ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function evmJsonRpc<T>(
  network: "base-mainnet" | "eth-mainnet",
  apiKey: string,
  method: string,
  params: unknown,
): Promise<T> {
  const host =
    network === "base-mainnet" ? "base-mainnet.g.alchemy.com" : "eth-mainnet.g.alchemy.com";
  const res = await fetch(`https://${host}/v2/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  if (data.result === undefined) throw new Error("empty RPC result");
  return data.result;
}

function resolvePrimaryAddresses(): { base?: string; solana?: string } {
  const watches = getWatchTargets();
  const base =
    getTradingBaseAddress() ?? watches.base[0] ?? watches.ethereum[0];
  const solana = getTradingSolanaAddress() ?? watches.solana[0];
  return { base, solana };
}

async function fetchPortfolioTokens(
  apiKey: string,
  base?: string,
  solana?: string,
): Promise<PortfolioTokenRow[]> {
  const addresses: { address: string; networks: string[] }[] = [];
  if (base) addresses.push({ address: base, networks: ["base-mainnet"] });
  if (solana) addresses.push({ address: solana, networks: ["solana-mainnet"] });
  if (!addresses.length) return [];

  const data = await portfolioPost<{
    data?: {
      tokens?: Array<{
        network?: string;
        tokenAddress?: string | null;
        tokenBalance?: string;
        tokenMetadata?: { symbol?: string; name?: string; decimals?: number };
      }>;
      pageKey?: string;
    };
  }>(apiKey, "/assets/tokens/balances/by-address", {
    addresses,
    includeNativeTokens: true,
    includeErc20Tokens: true,
  });

  const rows: PortfolioTokenRow[] = [];
  const tokens = data.data?.tokens ?? [];

  for (const t of tokens) {
    const meta = t.tokenMetadata ?? {};
    const decimals = meta.decimals ?? (t.tokenAddress ? 18 : 18);
    const raw = t.tokenBalance ?? "0";
    const normalized = raw.startsWith("0x") ? hexToDecimal(raw) : raw;
    rows.push({
      network: t.network ?? "unknown",
      address: base ?? solana ?? "",
      tokenAddress: t.tokenAddress ?? null,
      symbol: meta.symbol ?? (t.tokenAddress ? t.tokenAddress.slice(0, 6) : "NATIVE"),
      name: meta.name ?? meta.symbol ?? "Token",
      balance: formatTokenBalance(normalized, decimals),
      decimals,
      isNative: !t.tokenAddress,
    });
  }

  return rows
    .filter((r) => r.balance !== "0" && r.balance !== "0.0")
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 24);
}

async function fetchPortfolioNfts(
  apiKey: string,
  base?: string,
  solana?: string,
): Promise<{ items: NftRow[]; totalCount: number }> {
  const addresses: { address: string; networks: string[] }[] = [];
  if (base) addresses.push({ address: base, networks: ["base-mainnet"] });
  if (solana) addresses.push({ address: solana, networks: ["solana-mainnet"] });
  if (!addresses.length) return { items: [], totalCount: 0 };

  const data = await portfolioPost<{
    data?: {
      ownedNfts?: Array<{
        network?: string;
        contract?: { address?: string; name?: string };
        tokenId?: string;
        name?: string;
        image?: { cachedUrl?: string; originalUrl?: string };
      }>;
      totalCount?: number;
    };
  }>(apiKey, "/assets/nfts/by-address", {
    addresses,
    withMetadata: true,
    pageSize: 12,
  });

  const owned = data.data?.ownedNfts ?? [];
  const items: NftRow[] = owned.map((n) => ({
    network: n.network ?? "base-mainnet",
    owner: base ?? solana ?? "",
    contract: n.contract?.address ?? "",
    tokenId: n.tokenId ?? "",
    name: n.name ?? `#${n.tokenId ?? "?"}`,
    imageUrl: n.image?.cachedUrl ?? n.image?.originalUrl,
    collectionName: n.contract?.name,
  }));

  return {
    items,
    totalCount: data.data?.totalCount ?? items.length,
  };
}

async function fetchTokenApiBalances(
  apiKey: string,
  base?: string,
): Promise<TokenApiRow[]> {
  if (!base) return [];

  const result = await evmJsonRpc<{
    address: string;
    tokenBalances: Array<{ contractAddress: string; tokenBalance: string }>;
  }>("base-mainnet", apiKey, "alchemy_getTokenBalances", [base, "erc20"]);

  const nonZero = (result.tokenBalances ?? []).filter(
    (t) => t.tokenBalance && t.tokenBalance !== "0x0" && t.tokenBalance !== "0x",
  );

  const top = nonZero.slice(0, 8);
  const rows: TokenApiRow[] = [];

  for (const t of top) {
    let symbol: string | undefined;
    let name: string | undefined;
    let decimals: number | undefined;
    try {
      const meta = await evmJsonRpc<{
        symbol?: string;
        name?: string;
        decimals?: number;
      }>("base-mainnet", apiKey, "alchemy_getTokenMetadata", [t.contractAddress]);
      symbol = meta.symbol;
      name = meta.name;
      decimals = meta.decimals;
    } catch {
      // metadata optional
    }
    const raw = hexToDecimal(t.tokenBalance);
    rows.push({
      network: "base-mainnet",
      address: base,
      contractAddress: t.contractAddress,
      balance: formatTokenBalance(raw, decimals ?? 18),
      symbol,
      name,
      decimals,
    });
  }

  return rows;
}

async function fetchAssetTransfers(
  apiKey: string,
  base?: string,
): Promise<TransferRow[]> {
  if (!base) return [];

  const result = await evmJsonRpc<{
    transfers: Array<{
      hash: string;
      from: string;
      to: string | null;
      asset: string;
      category: string;
      value: number | null;
      rawContract?: { value?: string; decimal?: string };
      blockNum: string;
      metadata?: { blockTimestamp?: string };
    }>;
  }>("base-mainnet", apiKey, "alchemy_getAssetTransfers", [
    {
      fromAddress: base,
      category: ["external", "erc20", "erc721", "erc1155"],
      maxCount: "0x12",
      order: "desc",
      withMetadata: true,
    },
  ]);

  return (result.transfers ?? []).map((t) => ({
    network: "base-mainnet",
    hash: t.hash,
    from: t.from,
    to: t.to ?? "",
    asset: t.asset,
    category: t.category,
    value:
      t.rawContract?.value != null
        ? formatTokenBalance(
            hexToDecimal(t.rawContract.value.startsWith("0x") ? t.rawContract.value : `0x${t.rawContract.value}`),
            Number(t.rawContract.decimal ?? 18),
          )
        : String(t.value ?? ""),
    blockNum: t.blockNum,
    timestamp: t.metadata?.blockTimestamp,
  }));
}

async function enrichSolanaPortfolio(
  snapshot: AlchemyApiSnapshot,
  solana?: string,
): Promise<void> {
  if (!solana) return;
  try {
    const holdings = await fetchSolanaWalletHoldings(solana);
    if (holdings.solBalance > 0) {
      const exists = snapshot.portfolio.tokens.some(
        (t) => t.network === "solana-mainnet" && t.isNative,
      );
      if (!exists) {
        snapshot.portfolio.tokens.unshift({
          network: "solana-mainnet",
          address: solana,
          tokenAddress: null,
          symbol: "SOL",
          name: "Solana",
          balance: holdings.solBalance.toFixed(6),
          decimals: 9,
          isNative: true,
        });
      }
    }
    for (const ft of holdings.fungibleTokens.slice(0, 8)) {
      snapshot.portfolio.tokens.push({
        network: "solana-mainnet",
        address: solana,
        tokenAddress: ft.mint,
        symbol: ft.symbol,
        name: ft.name,
        balance: ft.uiAmount.toFixed(6),
        decimals: ft.decimals,
        isNative: false,
      });
    }
    if (holdings.nftCount > 0 && snapshot.nfts.totalCount === 0) {
      snapshot.nfts.totalCount = holdings.nftCount;
    }
  } catch (error) {
    console.warn("[alchemy-apis] solana enrich failed:", error);
  }
}

async function fetchAlchemyApiSnapshotUncached(): Promise<AlchemyApiSnapshot> {
  const apiKey = getAlchemyApiKey();
  const cacheSec = getAlchemyHoldingsCacheSec();
  if (!apiKey) return emptySnapshot(false, cacheSec);

  const { base, solana } = resolvePrimaryAddresses();
  const snapshot = emptySnapshot(true, cacheSec);
  snapshot.primaryBase = base;
  snapshot.primarySolana = solana;
  snapshot.fetchedAt = new Date().toISOString();

  await Promise.all([
    (async () => {
      try {
        snapshot.portfolio.tokens = await fetchPortfolioTokens(apiKey, base, solana);
      } catch (error) {
        snapshot.portfolio.error =
          error instanceof Error ? error.message : "portfolio_failed";
      }
    })(),
    (async () => {
      try {
        const nftData = await fetchPortfolioNfts(apiKey, base, solana);
        snapshot.nfts = { ...nftData };
      } catch (error) {
        snapshot.nfts.error = error instanceof Error ? error.message : "nft_failed";
      }
    })(),
    (async () => {
      try {
        snapshot.tokens.items = await fetchTokenApiBalances(apiKey, base);
      } catch (error) {
        snapshot.tokens.error = error instanceof Error ? error.message : "token_api_failed";
      }
    })(),
    (async () => {
      try {
        snapshot.transfers.items = await fetchAssetTransfers(apiKey, base);
      } catch (error) {
        snapshot.transfers.error =
          error instanceof Error ? error.message : "transfers_failed";
      }
    })(),
  ]);

  await enrichSolanaPortfolio(snapshot, solana);

  return snapshot;
}

export async function getAlchemyApiSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<AlchemyApiSnapshot> {
  const cacheSec = getAlchemyHoldingsCacheSec();
  if (options?.forceRefresh) {
    return fetchAlchemyApiSnapshotUncached();
  }
  return getCached(CACHE_KEY, cacheSec, fetchAlchemyApiSnapshotUncached);
}

export async function refreshAlchemyApiSnapshot(): Promise<AlchemyApiSnapshot> {
  const fresh = await fetchAlchemyApiSnapshotUncached();
  try {
    const { createRedisClient } = await import("./redis");
    await createRedisClient().set(
      CACHE_KEY,
      JSON.stringify({ v: fresh, exp: Date.now() + getAlchemyHoldingsCacheSec() * 1000 }),
      { ex: getAlchemyHoldingsCacheSec() },
    );
  } catch {
    // optional
  }
  return fresh;
}

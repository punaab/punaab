/**
 * Alchemy Portfolio / NFT / Token / Transfers — server-side only, Redis-cached.
 * Dashboard loads cached snapshot; optional manual refresh via /api/admin/alchemy/refresh.
 */
import { getCached } from "./alchemy-cache";
import {
  normalizeEvmAddress,
  normalizeSolanaAddress,
} from "./alchemy-address";
import {
  getAlchemyApiKey,
  getAlchemyHoldingsCacheSec,
  getTradingBaseAddress,
  getTradingSolanaAddress,
  getWatchTargets,
} from "./config";
import { fetchSolanaWalletHoldings } from "./solana-alchemy";
import {
  type EvmNftNetwork,
  getCollectionsForOwner,
  getContractsForOwner,
  getNFTsForOwner,
  isSpamFlag,
  type NftV3Collection,
  type NftV3Contract,
  type NftV3Owned,
} from "./alchemy-nft-v3";

const PORTFOLIO_BASE = "https://api.g.alchemy.com/data/v1";

type EvmRpcNetwork = EvmNftNetwork;

const RPC_HOST: Record<EvmRpcNetwork, string> = {
  "base-mainnet": "base-mainnet.g.alchemy.com",
  "eth-mainnet": "eth-mainnet.g.alchemy.com",
};

const CACHE_KEY = "moltbook:alchemy:dashboard";

const INACTIVE_ALCHEMY_HINT =
  "Alchemy app inactive — create a new app at https://dashboard.alchemy.com/apps and update ALCHEMY_API_KEY in Vercel.";

function isAlchemyInactiveError(message: string): boolean {
  return /app is inactive|inactive.*alchemy/i.test(message);
}

function formatAlchemyHttpError(prefix: string, status: number, text: string): Error {
  const body = text.slice(0, 300);
  if (status === 403 && isAlchemyInactiveError(body)) {
    return new Error(INACTIVE_ALCHEMY_HINT);
  }
  return new Error(`${prefix}: ${status} ${body}`);
}

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
  tokenType?: string;
  isSpam?: boolean;
}

export interface NftCollectionRow {
  network: string;
  contract: string;
  name: string;
  balance: number;
  imageUrl?: string;
  isSpam?: boolean;
  endpoint: "getCollectionsForOwner" | "getContractsForOwner";
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
  direction?: "in" | "out";
  tokenId?: string;
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
    collections: NftCollectionRow[];
    collectionCount: number;
    spamExcluded?: boolean;
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
  alchemyAppInactive?: boolean;
}

function emptySnapshot(configured: boolean, cacheSec: number): AlchemyApiSnapshot {
  return {
    fetchedAt: new Date().toISOString(),
    cacheSec,
    configured,
    portfolio: { tokens: [] },
    nfts: { items: [], totalCount: 0, collections: [], collectionCount: 0 },
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
    throw formatAlchemyHttpError(`Portfolio ${path}`, res.status, text);
  }
  return (await res.json()) as T;
}

async function evmJsonRpc<T>(
  network: EvmRpcNetwork,
  apiKey: string,
  method: string,
  params: unknown,
): Promise<T> {
  const host = RPC_HOST[network];
  const res = await fetch(`https://${host}/v2/${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) {
    throw formatAlchemyHttpError(`RPC ${method}`, 403, data.error.message);
  }
  if (data.result === undefined) throw new Error("empty RPC result");
  return data.result;
}

function resolvePrimaryAddresses(): { base?: string; solana?: string } {
  const watches = getWatchTargets();
  const base = normalizeEvmAddress(
    getTradingBaseAddress() ?? watches.base[0] ?? watches.ethereum[0],
  );
  const solana = normalizeSolanaAddress(
    getTradingSolanaAddress() ?? watches.solana[0],
  );
  return { base, solana };
}

const EVM_PORTFOLIO_NETWORKS = ["base-mainnet", "eth-mainnet"] as const;

function mapNftV3Row(network: EvmNftNetwork, owner: string, n: NftV3Owned): NftRow {
  const imageUrl =
    n.image?.cachedUrl ??
    n.image?.originalUrl ??
    n.raw?.metadata?.image;
  return {
    network,
    owner,
    contract: n.contract?.address ?? "",
    tokenId: n.tokenId ?? "",
    name: n.name ?? n.title ?? `#${n.tokenId ?? "?"}`,
    imageUrl,
    collectionName:
      n.collection?.name ??
      n.contract?.openSeaMetadata?.collectionName ??
      n.contract?.name,
    tokenType: n.tokenType,
    isSpam: isSpamFlag(n.contract?.isSpam),
  };
}

function mapEthCollection(c: NftV3Collection): NftCollectionRow {
  const balance = Number(c.totalBalance ?? c.numDistinctTokensOwned ?? 1);
  return {
    network: "eth-mainnet",
    contract: c.contract?.address ?? "",
    name: c.name ?? c.contract?.name ?? "Collection",
    balance: Number.isFinite(balance) ? balance : 1,
    imageUrl: c.image?.cachedUrl ?? c.image?.originalUrl,
    isSpam: isSpamFlag(c.isSpam),
    endpoint: "getCollectionsForOwner",
  };
}

function mapBaseContract(network: EvmNftNetwork, c: NftV3Contract): NftCollectionRow {
  const balance = Number(c.totalBalance ?? c.numDistinctTokensOwned ?? 1);
  return {
    network,
    contract: c.address ?? "",
    name: c.name ?? c.openSeaMetadata?.collectionName ?? "Collection",
    balance: Number.isFinite(balance) ? balance : 1,
    imageUrl: c.openSeaMetadata?.imageUrl,
    isSpam: isSpamFlag(c.isSpam),
    endpoint: "getContractsForOwner",
  };
}

async function fetchEvmNfts(
  apiKey: string,
  evm: string,
): Promise<{
  items: NftRow[];
  totalCount: number;
  collections: NftCollectionRow[];
  collectionCount: number;
  spamExcluded: boolean;
}> {
  const items: NftRow[] = [];
  const collections: NftCollectionRow[] = [];
  let totalCount = 0;
  let collectionCount = 0;
  let spamExcluded = true;
  const errors: string[] = [];

  for (const network of EVM_PORTFOLIO_NETWORKS) {
    try {
      const result = await getNFTsForOwner(apiKey, network, evm, 8);
      items.push(...result.ownedNfts.map((n) => mapNftV3Row(network, evm, n)));
      totalCount += result.totalCount;
      if (!result.spamExcluded) spamExcluded = false;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${network}_nft_failed`);
    }

    try {
      if (network === "eth-mainnet") {
        const cols = await getCollectionsForOwner(apiKey, evm, 6);
        collections.push(...cols.collections.map(mapEthCollection));
        collectionCount += cols.totalCount;
      } else {
        const cols = await getContractsForOwner(apiKey, network, evm, 6);
        collections.push(...cols.contracts.map((c) => mapBaseContract(network, c)));
        collectionCount += cols.totalCount;
      }
    } catch (error) {
      console.warn(`[alchemy-apis] NFT collections ${network}:`, error);
    }
  }

  if (errors.length && items.length === 0 && collections.length === 0) {
    throw new Error(errors.join(" · "));
  }

  return {
    items: items.slice(0, 12),
    totalCount,
    collections: collections.slice(0, 8),
    collectionCount,
    spamExcluded,
  };
}

async function fetchPortfolioNftsSolana(
  apiKey: string,
  solana: string,
): Promise<{ items: NftRow[]; totalCount: number }> {
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
    addresses: [{ address: solana, networks: ["solana-mainnet"] }],
    withMetadata: true,
    pageSize: 12,
  });

  const owned = data.data?.ownedNfts ?? [];
  const items: NftRow[] = owned.map((n) => ({
    network: n.network ?? "solana-mainnet",
    owner: solana,
    contract: n.contract?.address ?? "",
    tokenId: n.tokenId ?? "",
    name: n.name ?? `#${n.tokenId ?? "?"}`,
    imageUrl: n.image?.cachedUrl ?? n.image?.originalUrl,
    collectionName: n.contract?.name,
  }));

  return { items, totalCount: data.data?.totalCount ?? items.length };
}

async function fetchPortfolioTokens(
  apiKey: string,
  base?: string,
  solana?: string,
): Promise<PortfolioTokenRow[]> {
  const rows: PortfolioTokenRow[] = [];

  if (base) {
    const data = await portfolioPost<{
      data?: {
        tokens?: Array<{
          network?: string;
          tokenAddress?: string | null;
          tokenBalance?: string;
          tokenMetadata?: { symbol?: string; name?: string; decimals?: number };
        }>;
      };
    }>(apiKey, "/assets/tokens/balances/by-address", {
      addresses: [{ address: base, networks: [...EVM_PORTFOLIO_NETWORKS] }],
      includeNativeTokens: true,
      includeErc20Tokens: true,
    });

    for (const t of data.data?.tokens ?? []) {
      const meta = t.tokenMetadata ?? {};
      const decimals = meta.decimals ?? 18;
      const raw = t.tokenBalance ?? "0";
      const normalized = raw.startsWith("0x") ? hexToDecimal(raw) : raw;
      rows.push({
        network: t.network ?? "unknown",
        address: base,
        tokenAddress: t.tokenAddress ?? null,
        symbol: meta.symbol ?? (t.tokenAddress ? t.tokenAddress.slice(0, 6) : "NATIVE"),
        name: meta.name ?? meta.symbol ?? "Token",
        balance: formatTokenBalance(normalized, decimals),
        decimals,
        isNative: !t.tokenAddress,
      });
    }
  }

  if (solana) {
    try {
      const data = await portfolioPost<{
        data?: {
          tokens?: Array<{
            network?: string;
            tokenAddress?: string | null;
            tokenBalance?: string;
            tokenMetadata?: { symbol?: string; name?: string; decimals?: number };
          }>;
        };
      }>(apiKey, "/assets/tokens/balances/by-address", {
        addresses: [{ address: solana, networks: ["solana-mainnet"] }],
        includeNativeTokens: true,
        includeErc20Tokens: true,
      });

      for (const t of data.data?.tokens ?? []) {
        const meta = t.tokenMetadata ?? {};
        const decimals = meta.decimals ?? 9;
        const raw = t.tokenBalance ?? "0";
        const normalized = raw.startsWith("0x") ? hexToDecimal(raw) : raw;
        rows.push({
          network: t.network ?? "solana-mainnet",
          address: solana,
          tokenAddress: t.tokenAddress ?? null,
          symbol: meta.symbol ?? (t.tokenAddress ? t.tokenAddress.slice(0, 6) : "SOL"),
          name: meta.name ?? meta.symbol ?? "Token",
          balance: formatTokenBalance(normalized, decimals),
          decimals,
          isNative: !t.tokenAddress,
        });
      }
    } catch (error) {
      console.warn("[alchemy-apis] solana portfolio tokens:", error);
    }
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
): Promise<{
  items: NftRow[];
  totalCount: number;
  collections: NftCollectionRow[];
  collectionCount: number;
  spamExcluded?: boolean;
}> {
  const items: NftRow[] = [];
  const collections: NftCollectionRow[] = [];
  let totalCount = 0;
  let collectionCount = 0;
  let spamExcluded: boolean | undefined;
  const errors: string[] = [];

  if (base) {
    try {
      const evm = await fetchEvmNfts(apiKey, base);
      items.push(...evm.items);
      totalCount += evm.totalCount;
      collections.push(...evm.collections);
      collectionCount += evm.collectionCount;
      spamExcluded = evm.spamExcluded;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "evm_nft_failed");
    }
  }

  if (solana) {
    try {
      const sol = await fetchPortfolioNftsSolana(apiKey, solana);
      items.push(...sol.items);
      totalCount += sol.totalCount;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "solana_nft_failed");
    }
  }

  if (!base && !solana) {
    return { items: [], totalCount: 0, collections: [], collectionCount: 0 };
  }

  if (errors.length && items.length === 0 && collections.length === 0) {
    throw new Error(errors.join(" · "));
  }

  return {
    items: items.slice(0, 12),
    totalCount,
    collections: collections.slice(0, 8),
    collectionCount,
    spamExcluded,
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

  const categories = ["external", "internal", "erc20", "erc721", "erc1155"] as const;
  const seen = new Set<string>();
  const rows: TransferRow[] = [];
  const wallet = base.toLowerCase();

  async function pull(
    network: EvmRpcNetwork,
    direction: "from" | "to",
  ) {
    const addressParam =
      direction === "from" ? { fromAddress: base } : { toAddress: base };

    const result = await evmJsonRpc<{
      transfers: Array<{
        hash: string;
        from: string;
        to: string | null;
        asset: string;
        category: string;
        value: number | null;
        erc721TokenId?: string | null;
        rawContract?: { value?: string; decimal?: string };
        blockNum: string;
        metadata?: { blockTimestamp?: string };
      }>;
    }>(network, apiKey, "alchemy_getAssetTransfers", [
      {
        ...addressParam,
        fromBlock: "0x0",
        toBlock: "latest",
        category: [...categories],
        excludeZeroValue: false,
        maxCount: "0x14",
        order: "desc",
        withMetadata: true,
      },
    ]);

    for (const t of result.transfers ?? []) {
      const key = `${network}:${t.hash}:${t.category}:${t.erc721TokenId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isOut = t.from.toLowerCase() === wallet;
      const isIn = (t.to ?? "").toLowerCase() === wallet;
      let value = "";
      if (t.category === "erc721" || t.category === "erc1155") {
        value = t.erc721TokenId ? `#${parseInt(t.erc721TokenId, 16)}` : "NFT";
      } else if (t.rawContract?.value != null) {
        const raw = t.rawContract.value.startsWith("0x")
          ? t.rawContract.value
          : `0x${t.rawContract.value}`;
        value = formatTokenBalance(
          hexToDecimal(raw),
          Number(t.rawContract.decimal ?? 18),
        );
      } else if (t.value != null) {
        value = String(t.value);
      }

      rows.push({
        network,
        hash: t.hash,
        from: t.from,
        to: t.to ?? "",
        asset: t.asset,
        category: t.category,
        value,
        blockNum: t.blockNum,
        timestamp: t.metadata?.blockTimestamp,
        direction: isOut ? "out" : isIn ? "in" : undefined,
        tokenId: t.erc721TokenId
          ? parseInt(t.erc721TokenId, 16).toString()
          : undefined,
      });
    }
  }

  await pull("base-mainnet", "to");
  await pull("base-mainnet", "from");
  await pull("eth-mainnet", "to");
  await pull("eth-mainnet", "from");

  return rows
    .sort((a, b) => {
      if (a.timestamp && b.timestamp) {
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      }
      const blockA = parseInt(a.blockNum, 16);
      const blockB = parseInt(b.blockNum, 16);
      return blockB - blockA;
    })
    .slice(0, 18);
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
        snapshot.nfts = {
          items: nftData.items,
          totalCount: nftData.totalCount,
          collections: nftData.collections,
          collectionCount: nftData.collectionCount,
          spamExcluded: nftData.spamExcluded,
        };
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

  const panelErrors = [
    snapshot.portfolio.error,
    snapshot.nfts.error,
    snapshot.tokens.error,
    snapshot.transfers.error,
  ].filter((e): e is string => !!e);

  if (panelErrors.some(isAlchemyInactiveError)) {
    snapshot.alchemyAppInactive = true;
    const hint = INACTIVE_ALCHEMY_HINT;
    if (snapshot.portfolio.error && isAlchemyInactiveError(snapshot.portfolio.error)) {
      snapshot.portfolio.error = hint;
    }
    if (snapshot.nfts.error && isAlchemyInactiveError(snapshot.nfts.error)) {
      snapshot.nfts.error = hint;
    }
    if (snapshot.tokens.error && isAlchemyInactiveError(snapshot.tokens.error)) {
      snapshot.tokens.error = hint;
    }
    if (snapshot.transfers.error && isAlchemyInactiveError(snapshot.transfers.error)) {
      snapshot.transfers.error = hint;
    }
  }

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
      { v: fresh, exp: Date.now() + getAlchemyHoldingsCacheSec() * 1000 },
      { ex: getAlchemyHoldingsCacheSec() },
    );
  } catch {
    // optional
  }
  return fresh;
}

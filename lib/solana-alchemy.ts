/**
 * Alchemy Solana RPC — https://www.alchemy.com/docs/reference/solana-api-quickstart
 *
 * CU budget: getBalance ≈ few CUs; getAssetsByOwner ≈ 480 CUs per call.
 * Holdings are cached (default 1h). Disable DAS with ALCHEMY_DAS_ENABLED=false.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { getCached } from "./alchemy-cache";
import {
  getAlchemyHoldingsCacheSec,
  getAlchemySolanaRpcUrl,
  isAlchemyDasEnabled,
} from "./config";

export interface SolanaFungibleHolding {
  mint: string;
  name: string;
  symbol: string;
  balanceRaw: string;
  decimals: number;
  uiAmount: number;
}

export interface SolanaWalletHoldings {
  address: string;
  solBalance: number;
  lamports: number;
  fungibleTokens: SolanaFungibleHolding[];
  nftCount: number;
  totalAssets: number;
}

let connection: Connection | null = null;

export function getAlchemyConnection(): Connection {
  if (!connection) {
    connection = new Connection(getAlchemySolanaRpcUrl(), "confirmed");
  }
  return connection;
}

async function alchemyDasRpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(getAlchemySolanaRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as {
    result?: T;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  if (data.result === undefined) throw new Error("empty DAS result");
  return data.result;
}

interface DasAsset {
  id: string;
  interface?: string;
  content?: { metadata?: { name?: string; symbol?: string } };
  token_info?: {
    balance?: number;
    decimals?: number;
  };
}

interface GetAssetsByOwnerResult {
  total?: number;
  items?: DasAsset[];
}

const FUNGIBLE_INTERFACES = new Set(["FungibleToken", "FungibleAsset"]);

async function fetchSolBalanceOnly(address: string): Promise<SolanaWalletHoldings> {
  const lamports = await getAlchemyConnection().getBalance(
    new PublicKey(address),
    "confirmed",
  );
  return {
    address,
    solBalance: lamports / 1e9,
    lamports,
    fungibleTokens: [],
    nftCount: 0,
    totalAssets: 0,
  };
}

async function fetchSolanaWalletHoldingsUncached(
  address: string,
): Promise<SolanaWalletHoldings> {
  const pubkey = new PublicKey(address);
  const lamports = await getAlchemyConnection().getBalance(pubkey, "confirmed");

  const fungibleTokens: SolanaFungibleHolding[] = [];
  let nftCount = 0;
  let totalAssets = 0;

  if (!isAlchemyDasEnabled()) {
    return {
      address,
      solBalance: lamports / 1e9,
      lamports,
      fungibleTokens,
      nftCount,
      totalAssets,
    };
  }

  try {
    const result = await alchemyDasRpc<GetAssetsByOwnerResult>("getAssetsByOwner", {
      ownerAddress: address,
      page: 1,
      limit: 100,
      options: {
        showFungible: true,
        showNativeBalance: false,
        showZeroBalance: false,
      },
    });

    totalAssets = result.total ?? result.items?.length ?? 0;
    const items = result.items ?? [];

    for (const asset of items) {
      const iface = asset.interface ?? "";
      if (FUNGIBLE_INTERFACES.has(iface) && asset.token_info?.balance) {
        const decimals = asset.token_info.decimals ?? 0;
        const balanceRaw = BigInt(Math.floor(asset.token_info.balance));
        const uiAmount = Number(balanceRaw) / 10 ** decimals;
        if (uiAmount > 0) {
          fungibleTokens.push({
            mint: asset.id,
            name: asset.content?.metadata?.name ?? "Unknown",
            symbol: asset.content?.metadata?.symbol ?? asset.id.slice(0, 4),
            balanceRaw: balanceRaw.toString(),
            decimals,
            uiAmount,
          });
        }
      } else if (
        iface === "V1_NFT" ||
        iface === "ProgrammableNFT" ||
        iface === "MplCoreAsset" ||
        iface.includes("NFT")
      ) {
        nftCount += 1;
      }
    }
  } catch (error) {
    console.warn("[solana-alchemy] getAssetsByOwner failed:", error);
  }

  fungibleTokens.sort((a, b) => b.uiAmount - a.uiAmount);

  return {
    address,
    solBalance: lamports / 1e9,
    lamports,
    fungibleTokens,
    nftCount,
    totalAssets,
  };
}

/** Cached wallet inventory (DAS optional). Use forceRefresh only when stale data is unacceptable. */
export async function fetchSolanaWalletHoldings(
  address: string,
  options?: { forceRefresh?: boolean },
): Promise<SolanaWalletHoldings> {
  const ttl = getAlchemyHoldingsCacheSec();
  const cacheKey = `moltbook:alchemy:holdings:${address}`;

  if (options?.forceRefresh) {
    return fetchSolanaWalletHoldingsUncached(address);
  }

  return getCached(cacheKey, ttl, () => fetchSolanaWalletHoldingsUncached(address));
}

export async function getSolBalanceViaAlchemy(address: string): Promise<number> {
  const holdings = await getCached(
    `moltbook:alchemy:sol:${address}`,
    Math.min(300, getAlchemyHoldingsCacheSec()),
    () => fetchSolBalanceOnly(address),
  );
  return holdings.solBalance;
}

export function toTokenBaseUnits(uiAmount: number, decimals: number): bigint {
  if (decimals <= 0) return BigInt(Math.floor(uiAmount));
  const factor = 10 ** decimals;
  return BigInt(Math.floor(uiAmount * factor));
}

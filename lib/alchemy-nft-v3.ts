/**
 * Alchemy NFT API v3 — ownership endpoints (getNFTsForOwner, getContractsForOwner, getCollectionsForOwner).
 * @see https://www.alchemy.com/docs/reference/nft-api-endpoints
 */

export type EvmNftNetwork = "base-mainnet" | "eth-mainnet";

const NFT_V3_HOST: Record<EvmNftNetwork, string> = {
  "base-mainnet": "base-mainnet.g.alchemy.com",
  "eth-mainnet": "eth-mainnet.g.alchemy.com",
};

function formatNftV3Error(prefix: string, status: number, text: string): Error {
  const body = text.slice(0, 300);
  if (status === 403 && /inactive/i.test(body)) {
    return new Error(
      "Alchemy app inactive — create a new app at https://dashboard.alchemy.com/apps and update ALCHEMY_API_KEY in Vercel.",
    );
  }
  return new Error(`${prefix}: ${status} ${body}`);
}

export async function nftV3Get<T>(
  apiKey: string,
  network: EvmNftNetwork,
  endpoint: string,
  options?: {
    scalars?: Record<string, string | number | boolean | undefined>;
    arrayParams?: Record<string, string[]>;
  },
): Promise<T> {
  const url = new URL(`https://${NFT_V3_HOST[network]}/nft/v3/${apiKey}/${endpoint}`);
  for (const [key, value] of Object.entries(options?.scalars ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  for (const [key, values] of Object.entries(options?.arrayParams ?? {})) {
    for (const value of values) {
      url.searchParams.append(`${key}[]`, value);
    }
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw formatNftV3Error(`NFT v3 ${endpoint} (${network})`, res.status, text);
  }
  return (await res.json()) as T;
}

export interface NftV3Owned {
  contract?: {
    address?: string;
    name?: string;
    isSpam?: boolean | string;
    openSeaMetadata?: { collectionName?: string };
  };
  tokenId?: string;
  tokenType?: string;
  name?: string;
  title?: string;
  image?: { cachedUrl?: string; originalUrl?: string };
  raw?: { metadata?: { image?: string } };
  collection?: { name?: string };
}

export interface NftV3Collection {
  name?: string;
  slug?: string;
  contract?: { address?: string; name?: string; tokenType?: string };
  totalBalance?: number | string;
  numDistinctTokensOwned?: number | string;
  isSpam?: boolean | string;
  displayNft?: { tokenId?: string; name?: string };
  image?: { cachedUrl?: string; originalUrl?: string };
}

export interface NftV3Contract {
  address?: string;
  name?: string;
  symbol?: string;
  tokenType?: string;
  totalBalance?: number | string;
  numDistinctTokensOwned?: number | string;
  isSpam?: boolean | string;
  openSeaMetadata?: { collectionName?: string; imageUrl?: string };
}

export function isSpamFlag(value: boolean | string | undefined): boolean {
  return value === true || value === "true";
}

/** getNFTsForOwner — excludes spam when the API tier supports excludeFilters. */
export async function getNFTsForOwner(
  apiKey: string,
  network: EvmNftNetwork,
  owner: string,
  pageSize = 12,
): Promise<{ ownedNfts: NftV3Owned[]; totalCount: number; spamExcluded: boolean }> {
  const baseQuery = {
    scalars: { owner, withMetadata: true, pageSize },
  };

  try {
    const data = await nftV3Get<{
      ownedNfts?: NftV3Owned[];
      totalCount?: number;
    }>(apiKey, network, "getNFTsForOwner", {
      ...baseQuery,
      arrayParams: { excludeFilters: ["SPAM"] },
    });
    return {
      ownedNfts: data.ownedNfts ?? [],
      totalCount: data.totalCount ?? data.ownedNfts?.length ?? 0,
      spamExcluded: true,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (/spam|filter|paid|exclude/i.test(msg)) {
      const data = await nftV3Get<{
        ownedNfts?: NftV3Owned[];
        totalCount?: number;
      }>(apiKey, network, "getNFTsForOwner", baseQuery);
      return {
        ownedNfts: data.ownedNfts ?? [],
        totalCount: data.totalCount ?? data.ownedNfts?.length ?? 0,
        spamExcluded: false,
      };
    }
    throw error;
  }
}

/** getCollectionsForOwner — Ethereum mainnet only. */
export async function getCollectionsForOwner(
  apiKey: string,
  owner: string,
  pageSize = 8,
): Promise<{ collections: NftV3Collection[]; totalCount: number }> {
  try {
    const data = await nftV3Get<{
      collections?: NftV3Collection[];
      totalCount?: number | string;
    }>(apiKey, "eth-mainnet", "getCollectionsForOwner", {
      scalars: { owner, withMetadata: true, pageSize },
      arrayParams: { excludeFilters: ["SPAM"] },
    });
    const collections = data.collections ?? [];
    const total =
      typeof data.totalCount === "string"
        ? parseInt(data.totalCount, 10)
        : (data.totalCount ?? collections.length);
    return { collections, totalCount: total };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (/spam|filter|paid|exclude/i.test(msg)) {
      const data = await nftV3Get<{
        collections?: NftV3Collection[];
        totalCount?: number | string;
      }>(apiKey, "eth-mainnet", "getCollectionsForOwner", {
        scalars: { owner, withMetadata: true, pageSize },
      });
      const collections = data.collections ?? [];
      const total =
        typeof data.totalCount === "string"
          ? parseInt(data.totalCount, 10)
          : (data.totalCount ?? collections.length);
      return { collections, totalCount: total };
    }
    throw error;
  }
}

/** getContractsForOwner — use on Base and other non-Ethereum chains. */
export async function getContractsForOwner(
  apiKey: string,
  network: EvmNftNetwork,
  owner: string,
  pageSize = 8,
): Promise<{ contracts: NftV3Contract[]; totalCount: number }> {
  try {
    const data = await nftV3Get<{
      contracts?: NftV3Contract[];
      totalCount?: number | string;
    }>(apiKey, network, "getContractsForOwner", {
      scalars: { owner, withMetadata: true, pageSize },
      arrayParams: { excludeFilters: ["SPAM"] },
    });
    const contracts = data.contracts ?? [];
    const total =
      typeof data.totalCount === "string"
        ? parseInt(data.totalCount, 10)
        : (data.totalCount ?? contracts.length);
    return { contracts, totalCount: total };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (/spam|filter|paid|exclude/i.test(msg)) {
      const data = await nftV3Get<{
        contracts?: NftV3Contract[];
        totalCount?: number | string;
      }>(apiKey, network, "getContractsForOwner", {
        scalars: { owner, withMetadata: true, pageSize },
      });
      const contracts = data.contracts ?? [];
      const total =
        typeof data.totalCount === "string"
          ? parseInt(data.totalCount, 10)
          : (data.totalCount ?? contracts.length);
      return { contracts, totalCount: total };
    }
    throw error;
  }
}

export async function countNFTsForOwner(
  apiKey: string,
  network: EvmNftNetwork,
  owner: string,
): Promise<number> {
  const { totalCount } = await getNFTsForOwner(apiKey, network, owner, 1);
  return totalCount;
}

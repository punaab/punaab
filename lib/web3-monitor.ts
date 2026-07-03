import {
  getAlchemyApiKey,
  getWatchTargets,
  hasWatchAddresses,
} from "./config";
import { getSolBalanceViaAlchemy } from "./solana-alchemy";
import { createRedisClient } from "./redis";

const WEB3_SNAPSHOT_KEY = "moltbook:web3:snapshot";
const WEB3_LAST_RUN_KEY = "moltbook:web3:last_run";
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1/day

export type Web3Chain = "ethereum-mainnet" | "base-mainnet" | "solana-mainnet";

export interface ChainBalance {
  chain: Web3Chain;
  address: string;
  balance: string;
  rawBalance: string;
  symbol: "ETH" | "SOL";
}

export interface Web3Snapshot {
  capturedAt: string;
  balances: ChainBalance[];
  summary: string;
}

/** @deprecated Use balances on Web3Snapshot */
export interface WalletBalance {
  address: string;
  ethBalance: string;
  ethBalanceWei: string;
}

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

type AlchemyNetwork = "eth-mainnet" | "base-mainnet" | "solana-mainnet";

const ALCHEMY_RPC: Record<AlchemyNetwork, string> = {
  "eth-mainnet": "https://eth-mainnet.g.alchemy.com/v2",
  "base-mainnet": "https://base-mainnet.g.alchemy.com/v2",
  "solana-mainnet": "https://solana-mainnet.g.alchemy.com/v2",
};

const PUBLIC_RPC: Record<AlchemyNetwork, string> = {
  "eth-mainnet": "https://cloudflare-eth.com",
  "base-mainnet": "https://mainnet.base.org",
  "solana-mainnet": "https://api.mainnet-beta.solana.com",
};

function rpcUrl(network: AlchemyNetwork): string {
  const key = getAlchemyApiKey();
  if (key) return `${ALCHEMY_RPC[network]}/${key}`;
  return PUBLIC_RPC[network];
}

async function jsonRpc<T>(
  url: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as {
    result?: T;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  if (data.result === undefined) throw new Error("empty RPC result");
  return data.result;
}

async function fetchEvmBalance(
  address: string,
  network: "eth-mainnet" | "base-mainnet",
): Promise<{ balance: string; rawBalance: string }> {
  const weiHex = await jsonRpc<string>(rpcUrl(network), "eth_getBalance", [
    address,
    "latest",
  ]);
  const wei = BigInt(weiHex);
  const eth = Number(wei) / 1e18;
  return { balance: eth.toFixed(6), rawBalance: wei.toString() };
}

async function fetchSolanaBalance(
  address: string,
): Promise<{ balance: string; rawBalance: string }> {
  const sol = await getSolBalanceViaAlchemy(address);
  const lamports = Math.floor(sol * 1e9);
  return { balance: sol.toFixed(6), rawBalance: lamports.toString() };
}

const CHAIN_LABELS: Record<Web3Chain, string> = {
  "ethereum-mainnet": "ETH",
  "base-mainnet": "Base ETH",
  "solana-mainnet": "SOL",
};

async function queryChain(
  chain: Web3Chain,
  address: string,
): Promise<ChainBalance> {
  try {
    if (chain === "solana-mainnet") {
      const { balance, rawBalance } = await fetchSolanaBalance(address);
      return { chain, address, balance, rawBalance, symbol: "SOL" };
    }
    const network = chain === "base-mainnet" ? "base-mainnet" : "eth-mainnet";
    const { balance, rawBalance } = await fetchEvmBalance(address, network);
    return { chain, address, balance, rawBalance, symbol: "ETH" };
  } catch (error) {
    console.error(`[web3] ${chain} balance failed for ${address}:`, error);
    return {
      chain,
      address,
      balance: "error",
      rawBalance: "0",
      symbol: chain === "solana-mainnet" ? "SOL" : "ETH",
    };
  }
}

export async function captureWeb3Snapshot(): Promise<Web3Snapshot | null> {
  const { base, solana, ethereum } = getWatchTargets();
  if (base.length === 0 && solana.length === 0 && ethereum.length === 0) {
    return null;
  }

  const balances: ChainBalance[] = [];

  for (const address of base) {
    balances.push(await queryChain("base-mainnet", address));
  }

  for (const address of solana) {
    balances.push(await queryChain("solana-mainnet", address));
  }

  for (const address of ethereum) {
    balances.push(await queryChain("ethereum-mainnet", address));
  }

  const summary = balances
    .map((b) => {
      const short = `${b.address.slice(0, 6)}…${b.address.slice(-4)}`;
      return `${CHAIN_LABELS[b.chain]} ${short}: ${b.balance} ${b.symbol}`;
    })
    .join("; ");

  const snapshot: Web3Snapshot = {
    capturedAt: new Date().toISOString(),
    balances,
    summary,
  };

  try {
    const r = getRedis();
    await r.set(WEB3_SNAPSHOT_KEY, JSON.stringify(snapshot));
    await r.set(WEB3_LAST_RUN_KEY, Date.now().toString());
  } catch (error) {
    console.error("[web3] save snapshot failed:", error);
  }

  return snapshot;
}

function normalizeSnapshot(parsed: Web3Snapshot): Web3Snapshot {
  if (parsed.balances?.length) return parsed;

  // Migrate legacy snapshots that used `wallets` + single chain
  const legacy = parsed as Web3Snapshot & {
    wallets?: WalletBalance[];
    chain?: string;
  };
  if (legacy.wallets?.length) {
    return {
      capturedAt: legacy.capturedAt,
      summary: legacy.summary,
      balances: legacy.wallets.map((w) => ({
        chain: "ethereum-mainnet" as const,
        address: w.address,
        balance: w.ethBalance,
        rawBalance: w.ethBalanceWei,
        symbol: "ETH" as const,
      })),
    };
  }
  return parsed;
}

export async function getWeb3Snapshot(): Promise<Web3Snapshot | null> {
  try {
    const raw = await getRedis().get<string>(WEB3_SNAPSHOT_KEY);
    if (!raw) return null;
    return normalizeSnapshot(JSON.parse(raw) as Web3Snapshot);
  } catch (error) {
    console.error("[web3] getWeb3Snapshot failed:", error);
    return null;
  }
}

export async function shouldRunWeb3Snapshot(): Promise<boolean> {
  if (!hasWatchAddresses()) return false;
  try {
    const last = await getRedis().get<string>(WEB3_LAST_RUN_KEY);
    if (!last) return true;
    const ts = Number(last);
    return !Number.isFinite(ts) || Date.now() - ts >= MIN_INTERVAL_MS;
  } catch {
    return true;
  }
}

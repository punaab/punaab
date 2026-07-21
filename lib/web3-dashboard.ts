import {
  getAlchemyApiKey,
  getAlchemyHoldingsCacheSec,
  getAlchemyWalletEvmAddress,
  getAlchemyWalletSolanaAddress,
  getAlchemyWatchTargets,
  getAlchemyWebhookSigningKey,
  getSiteUrl,
  getTradingBaseAddress,
  getTradingSolanaAddress,
  isAlchemyDasEnabled,
  isDryRun,
  isTradingEnabled,
} from "./config";
import type { AlchemyWebhookEvent } from "./alchemy-events";
import type { AgentActivity } from "./owner-state";
import type { TradeLogEntry } from "./trading";
import type { Web3Snapshot } from "./web3-monitor";
import type { AlchemyApiSnapshot } from "./alchemy-apis";
import type { fetchPredictionDashboard } from "./prediction-dashboard";

export type PredictionDashboard = Awaited<
  ReturnType<typeof fetchPredictionDashboard>
>;

export interface Web3Hub {
  webhookUrl: string;
  infra: {
    alchemyConfigured: boolean;
    webhookAuthConfigured: boolean;
    tradingEnabled: boolean;
    dryRun: boolean;
    dasEnabled: boolean;
    holdingsCacheSec: number;
    /** Alchemy Agent Wallet (admin primary display) */
    alchemyEvm?: string;
    alchemySolana?: string;
    /** Hot-wallet / signing addresses (may differ from Alchemy session) */
    tradingSolana?: string;
    tradingBase?: string;
  };
  watches: ReturnType<typeof getAlchemyWatchTargets>;
  snapshot: Web3Snapshot | null;
  onchainEvents: AlchemyWebhookEvent[];
  trading: {
    enabled: boolean;
    hasSigner: boolean;
    log: TradeLogEntry[];
  };
  agentActivity: AgentActivity[];
  alchemy: AlchemyApiSnapshot | null;
  prediction?: PredictionDashboard | null;
}

export function buildWeb3Hub(params: {
  snapshot: Web3Snapshot | null;
  onchainEvents: AlchemyWebhookEvent[];
  trading: Web3Hub["trading"];
  activity: AgentActivity[];
  alchemy: AlchemyApiSnapshot | null;
  prediction?: PredictionDashboard | null;
}): Web3Hub {
  const web3Actions = new Set([
    "trade_analyze",
    "trade_swap",
    "trade_evm_swap",
    "evm_transfer",
    "web3_snapshot",
  ]);

  return {
    webhookUrl: `${getSiteUrl()}/api/webhooks/alchemy`,
    infra: {
      alchemyConfigured: Boolean(getAlchemyApiKey()),
      webhookAuthConfigured: Boolean(getAlchemyWebhookSigningKey()),
      tradingEnabled: isTradingEnabled(),
      dryRun: isDryRun(),
      dasEnabled: isAlchemyDasEnabled(),
      holdingsCacheSec: getAlchemyHoldingsCacheSec(),
      alchemyEvm: getAlchemyWalletEvmAddress(),
      alchemySolana: getAlchemyWalletSolanaAddress(),
      tradingSolana: getTradingSolanaAddress(),
      tradingBase: getTradingBaseAddress(),
    },
    watches: getAlchemyWatchTargets(),
    snapshot: params.snapshot
      ? {
          ...params.snapshot,
          balances: params.snapshot.balances.filter((b) => {
            const evm = getAlchemyWalletEvmAddress()?.toLowerCase();
            const sol = getAlchemyWalletSolanaAddress();
            const a = b.address.trim();
            if (evm && a.toLowerCase() === evm) return true;
            if (sol && a === sol) return true;
            return false;
          }),
        }
      : null,
    onchainEvents: params.onchainEvents,
    trading: params.trading,
    agentActivity: params.activity.filter((a) => web3Actions.has(a.action)),
    alchemy: params.alchemy,
    prediction: params.prediction ?? null,
  };
}

export function explorerUrl(chain: string, address: string): string | null {
  if (chain.includes("solana")) {
    return `https://solscan.io/account/${address}`;
  }
  if (chain.includes("base")) {
    return `https://basescan.org/address/${address}`;
  }
  if (chain.includes("ethereum") || chain.includes("eth")) {
    return `https://etherscan.io/address/${address}`;
  }
  return null;
}

export function txExplorerUrl(chain: string | undefined, hash: string): string | null {
  if (!hash) return null;
  if (chain === "solana") return `https://solscan.io/tx/${hash}`;
  if (chain === "base") return `https://basescan.org/tx/${hash}`;
  return `https://etherscan.io/tx/${hash}`;
}

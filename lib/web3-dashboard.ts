import {
  getAlchemyApiKey,
  getAlchemyHoldingsCacheSec,
  getAlchemyWebhookSigningKey,
  getSiteUrl,
  getTradingBaseAddress,
  getTradingSolanaAddress,
  getWatchTargets,
  isAlchemyDasEnabled,
  isDryRun,
  isTradingEnabled,
} from "./config";
import type { AlchemyWebhookEvent } from "./alchemy-events";
import type { AgentActivity } from "./owner-state";
import type { TradeLogEntry } from "./trading";
import type { Web3Snapshot } from "./web3-monitor";
import type { AlchemyApiSnapshot } from "./alchemy-apis";

export interface Web3Hub {
  webhookUrl: string;
  infra: {
    alchemyConfigured: boolean;
    webhookAuthConfigured: boolean;
    tradingEnabled: boolean;
    dryRun: boolean;
    dasEnabled: boolean;
    holdingsCacheSec: number;
    tradingSolana?: string;
    tradingBase?: string;
  };
  watches: ReturnType<typeof getWatchTargets>;
  snapshot: Web3Snapshot | null;
  onchainEvents: AlchemyWebhookEvent[];
  trading: {
    enabled: boolean;
    hasSigner: boolean;
    log: TradeLogEntry[];
  };
  agentActivity: AgentActivity[];
  alchemy: AlchemyApiSnapshot | null;
}

export function buildWeb3Hub(params: {
  snapshot: Web3Snapshot | null;
  onchainEvents: AlchemyWebhookEvent[];
  trading: Web3Hub["trading"];
  activity: AgentActivity[];
  alchemy: AlchemyApiSnapshot | null;
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
      tradingSolana: getTradingSolanaAddress(),
      tradingBase: getTradingBaseAddress(),
    },
    watches: getWatchTargets(),
    snapshot: params.snapshot,
    onchainEvents: params.onchainEvents,
    trading: params.trading,
    agentActivity: params.activity.filter((a) => web3Actions.has(a.action)),
    alchemy: params.alchemy,
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

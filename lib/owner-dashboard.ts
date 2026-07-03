import { allowedActions, isTradingEnabled } from "./config";
import { listApps } from "./apps";
import { SHORT_TERM_GOALS } from "./goals";
import { getUsageCounts } from "./memory";
import { fetchMoltbookDashboard } from "./moltbook-dashboard";
import { persona } from "./persona";
import {
  getCollabInbox,
  getCurrentThought,
  getLastHeartbeat,
  getPlans,
  getPublishedLinks,
  getTickLog,
} from "./owner-state";
import { getWeb3Snapshot } from "./web3-monitor";
import { getTradeLog, hasTradeSigner } from "./trading";

export interface OwnerDashboard {
  agent: { name: string; handle: string };
  status: {
    lastTickAt: string | null;
    lastAction: string | null;
    ok: boolean | null;
    canPost: boolean;
    canComment: boolean;
    upvotesRemaining: number;
    inQuietHours: boolean;
  };
  shortTermGoals: readonly string[];
  thought: string | null;
  plans: Awaited<ReturnType<typeof getPlans>>;
  tickLog: Awaited<ReturnType<typeof getTickLog>>;
  usage: Awaited<ReturnType<typeof getUsageCounts>>;
  allowance: ReturnType<typeof allowedActions>;
  publishedLinks: Awaited<ReturnType<typeof getPublishedLinks>>;
  apps: Awaited<ReturnType<typeof listApps>>;
  collab: Awaited<ReturnType<typeof getCollabInbox>>;
  web3: Awaited<ReturnType<typeof getWeb3Snapshot>>;
  trading: {
    enabled: boolean;
    hasSigner: boolean;
    log: Awaited<ReturnType<typeof getTradeLog>>;
  };
  moltbook: Awaited<ReturnType<typeof fetchMoltbookDashboard>>;
}

export async function getOwnerDashboard(): Promise<OwnerDashboard> {
  const [
    thought,
    plans,
    tickLog,
    usage,
    apps,
    collab,
    web3,
    moltbook,
    publishedLinks,
    lastHeartbeat,
    tradeLog,
  ] = await Promise.all([
    getCurrentThought(),
    getPlans(),
    getTickLog(20),
    getUsageCounts(),
    listApps(),
    getCollabInbox(20),
    getWeb3Snapshot(),
    fetchMoltbookDashboard(),
    getPublishedLinks(20),
    getLastHeartbeat(),
    getTradeLog(10),
  ]);

  const allowance = allowedActions(usage);
  const lastTick = tickLog[0] ?? null;
  const lastTickAt = lastHeartbeat ?? lastTick?.timestamp ?? null;

  return {
    agent: { name: persona.name, handle: persona.handle },
    status: {
      lastTickAt,
      lastAction: lastTick?.plan?.action ?? null,
      ok: lastTick?.ok ?? null,
      canPost: allowance.canPost,
      canComment: allowance.canComment,
      upvotesRemaining: allowance.upvotesRemaining,
      inQuietHours: allowance.inQuietHours,
    },
    shortTermGoals: SHORT_TERM_GOALS,
    thought,
    plans,
    tickLog,
    usage,
    allowance,
    publishedLinks,
    apps,
    collab,
    web3,
    trading: {
      enabled: isTradingEnabled(),
      hasSigner: hasTradeSigner(),
      log: tradeLog,
    },
    moltbook,
  };
}

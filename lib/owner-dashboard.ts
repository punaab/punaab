import { allowedActions, isTradingEnabled } from "./config";
import { listApps } from "./apps";
import { SHORT_TERM_GOALS } from "./goals";
import { getUsageCounts } from "./memory";
import { fetchMoltbookDashboard } from "./moltbook-dashboard";
import { persona } from "./persona";
import {
  getActivityLog,
  getCollabInbox,
  getCurrentThought,
  getLastHeartbeat,
  getPlans,
  getPublishedLinks,
  getTickLog,
} from "./owner-state";
import { getWeb3Snapshot } from "./web3-monitor";
import { getTradeLog, hasAnyTradeSigner } from "./trading";
import { getRecentAlchemyEvents } from "./alchemy-events";
import { buildWeb3Hub, type Web3Hub } from "./web3-dashboard";
import { loadCampaignForDashboard, type Campaign } from "./campaign";
import { getAlchemyApiSnapshot } from "./alchemy-apis";
import { getCatNftCatalog, getCatNftShopStats, catNftApiUrl, catNftGalleryUrl } from "./punaab-cat-nfts";
import { fetchMusicShopForDashboard } from "./music-dashboard";

export interface OwnerDashboard {
  agent: { name: string; handle: string };
  status: {
    lastTickAt: string | null;
    lastAction: string | null;
    lastPlanReason: string | null;
    ok: boolean | null;
    canPost: boolean;
    canComment: boolean;
    upvotesRemaining: number;
    inQuietHours: boolean;
    heartbeatStale: boolean;
    brainBlocked: boolean;
  };
  shortTermGoals: readonly string[];
  thought: string | null;
  plans: Awaited<ReturnType<typeof getPlans>>;
  tickLog: Awaited<ReturnType<typeof getTickLog>>;
  activity: Awaited<ReturnType<typeof getActivityLog>>;
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
  onchainEvents: Awaited<ReturnType<typeof getRecentAlchemyEvents>>;
  web3Hub: Web3Hub;
  campaign: Campaign;
  campaignPersisted: boolean;
  campaignError?: string;
  moltbook: Awaited<ReturnType<typeof fetchMoltbookDashboard>>;
  catNftShop: {
    gallery: string;
    api: string;
    stats: Awaited<ReturnType<typeof getCatNftShopStats>>;
    catalog: Awaited<ReturnType<typeof getCatNftCatalog>>;
  };
  musicNftShop: Awaited<ReturnType<typeof fetchMusicShopForDashboard>>;
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
    activity,
    onchainEvents,
    campaignLoad,
    alchemyApis,
    catNftCatalog,
    catNftStats,
    musicNftShop,
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
    getTradeLog(15),
    getActivityLog(25),
    getRecentAlchemyEvents(15),
    loadCampaignForDashboard(),
    getAlchemyApiSnapshot(),
    getCatNftCatalog(),
    getCatNftShopStats(),
    fetchMusicShopForDashboard(),
  ]);

  const campaign = campaignLoad.campaign;

  const allowance = allowedActions(usage);
  const lastTick = tickLog[0] ?? null;
  const lastTickAt = lastHeartbeat ?? lastTick?.timestamp ?? null;
  const lastPlanReason = lastTick?.plan?.reason ?? null;
  const heartbeatStale =
    !lastTickAt ||
    Date.now() - new Date(lastTickAt).getTime() > 45 * 60 * 1000;
  const brainBlocked =
    typeof lastPlanReason === "string" &&
    (lastPlanReason.startsWith("brain_error") ||
      lastPlanReason === "missing_anthropic_api_key");

  return {
    agent: { name: persona.name, handle: persona.handle },
    status: {
      lastTickAt,
      lastAction: lastTick?.plan?.action ?? null,
      lastPlanReason,
      ok: lastTick?.ok ?? null,
      canPost: allowance.canPost,
      canComment: allowance.canComment,
      upvotesRemaining: allowance.upvotesRemaining,
      inQuietHours: allowance.inQuietHours,
      heartbeatStale,
      brainBlocked,
    },
    shortTermGoals: SHORT_TERM_GOALS,
    thought,
    plans,
    tickLog,
    activity,
    usage,
    allowance,
    publishedLinks,
    apps,
    collab,
    web3,
    trading: {
      enabled: isTradingEnabled(),
      hasSigner: hasAnyTradeSigner(),
      log: tradeLog,
    },
    onchainEvents,
    web3Hub: buildWeb3Hub({
      snapshot: web3,
      onchainEvents,
      trading: {
        enabled: isTradingEnabled(),
        hasSigner: hasAnyTradeSigner(),
        log: tradeLog,
      },
      activity,
      alchemy: alchemyApis,
    }),
    campaign,
    campaignPersisted: campaignLoad.persisted,
    campaignError: campaignLoad.error,
    moltbook,
    catNftShop: {
      gallery: catNftGalleryUrl(),
      api: catNftApiUrl(),
      stats: catNftStats,
      catalog: catNftCatalog,
    },
    musicNftShop,
  };
}

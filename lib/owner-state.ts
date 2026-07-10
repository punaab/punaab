import { createRedisClient } from "./redis";
import { parseRedisValue } from "./redis-json";

const CURRENT_THOUGHT_KEY = "moltbook:owner:thought";
const PLANS_KEY = "moltbook:owner:plans";
const TICK_LOG_KEY = "moltbook:owner:tick_log";
const COLLAB_INBOX_KEY = "moltbook:owner:collab_inbox";
const PUBLISHED_LINKS_KEY = "moltbook:owner:published_links";
const LAST_HEARTBEAT_KEY = "moltbook:owner:last_heartbeat";
const ACTIVITY_LOG_KEY = "moltbook:owner:activity_log";

const MAX_TICK_LOG = 50;
const MAX_PLANS = 10;
const MAX_COLLAB = 100;
const MAX_PUBLISHED_LINKS = 30;
const MAX_ACTIVITY_LOG = 40;

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

export interface TickLogEntry {
  ok: boolean;
  timestamp: string;
  feedCount: number;
  newPostCount: number;
  notificationCount: number;
  canPost: boolean;
  postBlockedReason?: string;
  plan: { action: string; reason?: string };
  executed: string[];
  errors: string[];
}

export interface OwnerPlan {
  id: string;
  text: string;
  createdAt: string;
  status: "active" | "done" | "dropped";
}

export interface CollabMessage {
  id: string;
  fromAgentId: string;
  fromAgentName: string;
  message: string;
  createdAt: string;
  read: boolean;
  karma?: number;
  ownerHandle?: string;
}

export interface PublishedLink {
  id: string;
  title: string;
  url: string;
  kind: string;
  createdAt: string;
  note?: string;
}

/** Agent actions recorded at execution time (dashboard live feed). */
export interface AgentActivity {
  id: string;
  timestamp: string;
  action: string;
  summary?: string;
  content?: string;
  targetId?: string;
  targetUrl?: string;
  reason?: string;
}

export async function appendActivity(
  entry: Omit<AgentActivity, "id" | "timestamp">,
): Promise<AgentActivity> {
  const full: AgentActivity = {
    ...entry,
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };
  try {
    const r = getRedis();
    await r.lpush(ACTIVITY_LOG_KEY, full);
    await r.ltrim(ACTIVITY_LOG_KEY, 0, MAX_ACTIVITY_LOG - 1);
  } catch (error) {
    console.error("[owner-state] appendActivity failed:", error);
  }

  // Soft cross-post Moltbook posts/comments → X (@notbitcoinceo)
  const crossActions = new Set([
    "post",
    "comment",
    "showcase",
    "promote_cat_nft",
    "promote_music_drop",
    "announce_music_drop_live",
    "offer_help",
    "onchain_insight",
    "promote_anthem_comment",
  ]);
  if (crossActions.has(entry.action) && (entry.content || entry.summary)) {
    void import("./x-twitter")
      .then(({ crossPostMoltbookActivity }) =>
        crossPostMoltbookActivity({
          action: entry.action,
          title: entry.summary,
          content: entry.content,
          targetUrl: entry.targetUrl,
        }),
      )
      .catch((error) => {
        console.warn("[owner-state] x crosspost:", error);
      });
  }

  return full;
}

export async function getActivityLog(limit = 20): Promise<AgentActivity[]> {
  try {
    const items = await getRedis().lrange(ACTIVITY_LOG_KEY, 0, limit - 1);
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        try {
          return parseRedisValue<AgentActivity>(item);
        } catch {
          return null;
        }
      })
      .filter((e): e is AgentActivity => e !== null);
  } catch (error) {
    console.error("[owner-state] getActivityLog failed:", error);
    return [];
  }
}

export async function setCurrentThought(text: string): Promise<void> {
  try {
    await getRedis().set(CURRENT_THOUGHT_KEY, text);
  } catch (error) {
    console.error("[owner-state] setCurrentThought failed:", error);
  }
}

export async function getCurrentThought(): Promise<string | null> {
  try {
    const value = await getRedis().get<string>(CURRENT_THOUGHT_KEY);
    return value ?? null;
  } catch (error) {
    console.error("[owner-state] getCurrentThought failed:", error);
    return null;
  }
}

export async function setPlans(plans: OwnerPlan[]): Promise<void> {
  try {
    await getRedis().set(PLANS_KEY, plans.slice(0, MAX_PLANS));
  } catch (error) {
    console.error("[owner-state] setPlans failed:", error);
  }
}

export async function getPlans(): Promise<OwnerPlan[]> {
  try {
    const raw = await getRedis().get(PLANS_KEY);
    if (!raw) return [];
    const parsed = parseRedisValue<unknown>(raw);
    return Array.isArray(parsed) ? (parsed as OwnerPlan[]) : [];
  } catch (error) {
    console.error("[owner-state] getPlans failed:", error);
    return [];
  }
}

export async function appendPlan(text: string): Promise<void> {
  const plans = await getPlans();
  const entry: OwnerPlan = {
    id: `plan_${Date.now()}`,
    text,
    createdAt: new Date().toISOString(),
    status: "active",
  };
  await setPlans([entry, ...plans.filter((p) => p.status === "active")].slice(0, MAX_PLANS));
}

export async function appendTickLog(entry: TickLogEntry): Promise<void> {
  try {
    const r = getRedis();
    await r.lpush(TICK_LOG_KEY, entry);
    await r.ltrim(TICK_LOG_KEY, 0, MAX_TICK_LOG - 1);
  } catch (error) {
    console.error("[owner-state] appendTickLog failed:", error);
  }
}

export async function getTickLog(limit = 20): Promise<TickLogEntry[]> {
  try {
    const items = await getRedis().lrange(TICK_LOG_KEY, 0, limit - 1);
    const list = Array.isArray(items) ? items : [];
    return list
      .map((item) => {
        try {
          return parseRedisValue<TickLogEntry>(item);
        } catch {
          return null;
        }
      })
      .filter((e): e is TickLogEntry => e !== null);
  } catch (error) {
    console.error("[owner-state] getTickLog failed:", error);
    return [];
  }
}

export async function addCollabMessage(
  msg: Omit<CollabMessage, "id" | "createdAt" | "read">,
): Promise<CollabMessage> {
  const entry: CollabMessage = {
    ...msg,
    id: `collab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    read: false,
  };
  const r = getRedis();
  await r.lpush(COLLAB_INBOX_KEY, entry);
  await r.ltrim(COLLAB_INBOX_KEY, 0, MAX_COLLAB - 1);
  return entry;
}

export async function getCollabInbox(limit = 20): Promise<CollabMessage[]> {
  try {
    const items = await getRedis().lrange(COLLAB_INBOX_KEY, 0, limit - 1);
    const list = Array.isArray(items) ? items : [];
    return list
      .map((item) => {
        try {
          return parseRedisValue<CollabMessage>(item);
        } catch {
          return null;
        }
      })
      .filter((e): e is CollabMessage => e !== null);
  } catch (error) {
    console.error("[owner-state] getCollabInbox failed:", error);
    return [];
  }
}

export async function setLastHeartbeat(iso: string): Promise<void> {
  try {
    await getRedis().set(LAST_HEARTBEAT_KEY, iso);
  } catch (error) {
    console.error("[owner-state] setLastHeartbeat failed:", error);
  }
}

export async function getLastHeartbeat(): Promise<string | null> {
  try {
    return (await getRedis().get<string>(LAST_HEARTBEAT_KEY)) ?? null;
  } catch {
    return null;
  }
}

export async function addPublishedLink(
  link: Omit<PublishedLink, "id" | "createdAt">,
): Promise<PublishedLink> {
  const entry: PublishedLink = {
    ...link,
    id: `link_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  try {
    const r = getRedis();
    await r.lpush(PUBLISHED_LINKS_KEY, entry);
    await r.ltrim(PUBLISHED_LINKS_KEY, 0, MAX_PUBLISHED_LINKS - 1);
  } catch (error) {
    console.error("[owner-state] addPublishedLink failed:", error);
  }
  return entry;
}

export async function getPublishedLinks(limit = 20): Promise<PublishedLink[]> {
  try {
    const items = await getRedis().lrange(PUBLISHED_LINKS_KEY, 0, limit - 1);
    const list = Array.isArray(items) ? items : [];
    return list
      .map((item) => {
        try {
          return parseRedisValue<PublishedLink>(item);
        } catch {
          return null;
        }
      })
      .filter((e): e is PublishedLink => e !== null);
  } catch (error) {
    console.error("[owner-state] getPublishedLinks failed:", error);
    return [];
  }
}

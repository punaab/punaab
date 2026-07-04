import type { UsageCounts } from "./config";
import { createRedisClient } from "./redis";
import type { Redis } from "@upstash/redis";

const SEEN_POSTS_KEY = "moltbook:seen_post_ids";
const LAST_POST_AT_KEY = "moltbook:last_post_at";
const FOLLOWED_AGENTS_KEY = "moltbook:followed_agents";

const HOUR_TTL = 2 * 3600;
const DAY_TTL = 2 * 86400;
const NEVER_POSTED = Number.MAX_SAFE_INTEGER;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) redis = createRedisClient();
  return redis;
}

// --- Time bucket helpers ---
function utcHour(d = new Date()) {
  return d.toISOString().slice(0, 13);
}

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

const hourKey = (kind: string, d?: Date) => `moltbook:count:${kind}:h:${utcHour(d)}`;
const dayKey = (kind: string, d?: Date) => `moltbook:count:${kind}:d:${utcDay(d)}`;

function safeToNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ============================================
// USAGE COUNTERS
// ============================================

async function bump(kind: string): Promise<void> {
  const r = getRedis();
  const hk = hourKey(kind);
  const dk = dayKey(kind);

  const pipeline = r.pipeline();
  pipeline.incr(hk);
  pipeline.incr(dk);
  pipeline.expire(hk, HOUR_TTL, "nx");
  pipeline.expire(dk, DAY_TTL, "nx");

  await pipeline.exec();
}

export async function recordPost(): Promise<void> {
  await bump("post");
  await setLastPostAt(Date.now());
}

export async function recordComment(): Promise<void> {
  await bump("comment");
}

export async function recordUpvote(): Promise<void> {
  await bump("upvote");
}

export async function recordFollow(agentName: string): Promise<void> {
  await bump("follow");
  try {
    await getRedis().sadd(FOLLOWED_AGENTS_KEY, agentName.trim().toLowerCase());
  } catch (error) {
    console.error("[memory] recordFollow sadd failed:", error);
  }
}

export async function isAgentFollowed(agentName: string): Promise<boolean> {
  try {
    const result = await getRedis().sismember(
      FOLLOWED_AGENTS_KEY,
      agentName.trim().toLowerCase(),
    );
    return result === 1;
  } catch (error) {
    console.error("[memory] isAgentFollowed failed:", error);
    return false;
  }
}

export async function getFollowedAgents(): Promise<string[]> {
  try {
    const raw = await getRedis().smembers(FOLLOWED_AGENTS_KEY);
    return Array.isArray(raw) ? raw.map(String) : [];
  } catch (error) {
    console.error("[memory] getFollowedAgents failed:", error);
    return [];
  }
}

export async function getUsageCounts(): Promise<UsageCounts> {
  try {
    const now = new Date();
    const r = getRedis();

    const res = await r.pipeline()
      .get(hourKey("post", now))
      .get(dayKey("post", now))
      .get(hourKey("comment", now))
      .get(dayKey("comment", now))
      .get(hourKey("upvote", now))
      .get(dayKey("upvote", now))
      .get(hourKey("follow", now))
      .get(dayKey("follow", now))
      .get(LAST_POST_AT_KEY)
      .exec();

    const [hPost, dPost, hComment, dComment, hUp, dUp, hFollow, dFollow, last] = res;

    const lastPostAt = safeToNum(last);

    return {
      postsThisHour: safeToNum(hPost),
      postsToday: safeToNum(dPost),
      commentsThisHour: safeToNum(hComment),
      commentsToday: safeToNum(dComment),
      upvotesThisHour: safeToNum(hUp),
      upvotesToday: safeToNum(dUp),
      followsThisHour: safeToNum(hFollow),
      followsToday: safeToNum(dFollow),
      msSinceLastPost: lastPostAt > 0 ? Date.now() - lastPostAt : NEVER_POSTED,
      currentHourUTC: now.getUTCHours(),
    };
  } catch (error) {
    console.error("[memory] getUsageCounts failed:", error);
    return {
      postsThisHour: 99, postsToday: 99,
      commentsThisHour: 99, commentsToday: 99,
      upvotesThisHour: 99, upvotesToday: 99,
      followsThisHour: 99, followsToday: 99,
      msSinceLastPost: 0,
      currentHourUTC: new Date().getUTCHours(),
    };
  }
}

// ============================================
// LAST POST TIME
// ============================================

export async function getLastPostAt(): Promise<number | null> {
  try {
    const value = await getRedis().get(LAST_POST_AT_KEY);
    if (value == null) return null;
    const n = safeToNum(value);
    return n > 0 ? n : null;
  } catch (error) {
    console.error("[memory] getLastPostAt failed:", error);
    return null;
  }
}

export async function setLastPostAt(timestampMs: number): Promise<void> {
  try {
    await getRedis().set(LAST_POST_AT_KEY, timestampMs);
  } catch (error) {
    console.error("[memory] setLastPostAt failed:", error);
  }
}

// ============================================
// SEEN POSTS (ZSET version)
// ============================================

export async function recordSeenPostIds(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return;

  try {
    const r = getRedis();
    const now = Date.now();
    const pipeline = r.pipeline();

    for (const id of postIds) {
      pipeline.zadd(SEEN_POSTS_KEY, { score: now, member: id });
    }

    await pipeline.exec();
  } catch (error) {
    console.error("[memory] recordSeenPostIds failed:", error);
  }
}

export async function isPostSeen(postId: string): Promise<boolean> {
  try {
    const score = await getRedis().zscore(SEEN_POSTS_KEY, postId);
    return score !== null;
  } catch (error) {
    console.error("[memory] isPostSeen failed:", error);
    return false;
  }
}

export async function getSeenPostIds(): Promise<Set<string>> {
  try {
    const raw = await getRedis().zrange(SEEN_POSTS_KEY, 0, -1);
    const members = Array.isArray(raw) ? raw.map(String) : [];
    return new Set(members);
  } catch (error) {
    console.error("[memory] getSeenPostIds failed:", error);
    return new Set();
  }
}

export async function cleanupOldSeenPosts(olderThanDays = 90): Promise<number> {
  try {
    const cutoff = Date.now() - olderThanDays * 86400_000;
    return await getRedis().zremrangebyscore(SEEN_POSTS_KEY, 0, cutoff);
  } catch (error) {
    console.error("[memory] cleanupOldSeenPosts failed:", error);
    return 0;
  }
}
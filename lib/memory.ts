import { createRedisClient } from "./redis";
import type { UsageCounts } from "./config";

const SEEN_POSTS_KEY = "moltbook:seen_post_ids";
const LAST_POST_AT_KEY = "moltbook:last_post_at";

const HOUR_TTL = 2 * 3600;       // buckets linger briefly, then roll
const DAY_TTL = 2 * 86400;
const NEVER_POSTED = Number.MAX_SAFE_INTEGER;

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

// --- time-bucketed keys (UTC), so counts reset automatically ---
function utcHour(d = new Date()) { return d.toISOString().slice(0, 13); }   // 2026-07-02T14
function utcDay(d = new Date()) { return d.toISOString().slice(0, 10); }    // 2026-07-02
const hourKey = (kind: string, d?: Date) => `moltbook:count:${kind}:h:${utcHour(d)}`;
const dayKey = (kind: string, d?: Date) => `moltbook:count:${kind}:d:${utcDay(d)}`;

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function bump(kind: string): Promise<void> {
  const r = getRedis();
  const hk = hourKey(kind);
  const dk = dayKey(kind);
  await Promise.all([
    r.incr(hk).then(() => r.expire(hk, HOUR_TTL)),
    r.incr(dk).then(() => r.expire(dk, DAY_TTL)),
  ]);
}

// --- seen posts (unchanged) ---
export async function getSeenPostIds(): Promise<Set<string>> {
  try {
    const members = await getRedis().smembers(SEEN_POSTS_KEY);
    return new Set((Array.isArray(members) ? members : []).map(String));
  } catch (error) {
    console.error("[memory] getSeenPostIds failed:", error);
    return new Set();
  }
}

export async function recordSeenPostIds(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return;
  try {
    const pipeline = getRedis().pipeline();
    for (const id of postIds) pipeline.sadd(SEEN_POSTS_KEY, id);
    await pipeline.exec();
  } catch (error) {
    console.error("[memory] recordSeenPostIds failed:", error);
  }
}

// --- last post time (unchanged) ---
export async function getLastPostAt(): Promise<number | null> {
  try {
    const value = await getRedis().get<number | string>(LAST_POST_AT_KEY);
    if (value === null || value === undefined) return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
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

// --- record helpers the heartbeat route calls after each action ---
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

// --- the aggregate the route reads at the top of each tick ---
export async function getUsageCounts(): Promise<UsageCounts> {
  try {
    const now = new Date();
    const r = getRedis();
    const p = r.pipeline();
    p.get(hourKey("post", now));
    p.get(dayKey("post", now));
    p.get(hourKey("comment", now));
    p.get(dayKey("comment", now));
    p.get(hourKey("upvote", now));
    p.get(dayKey("upvote", now));
    p.get(LAST_POST_AT_KEY);
    const res = (await p.exec()) as unknown[];

    const lastPostAt = toNum(res[6]);
    return {
      postsThisHour: toNum(res[0]),
      postsToday: toNum(res[1]),
      commentsThisHour: toNum(res[2]),
      commentsToday: toNum(res[3]),
      upvotesThisHour: toNum(res[4]),
      upvotesToday: toNum(res[5]),
      msSinceLastPost: lastPostAt > 0 ? Date.now() - lastPostAt : NEVER_POSTED,
      currentHourUTC: now.getUTCHours(),
    };
  } catch (error) {
    console.error("[memory] getUsageCounts failed:", error);
    // Fail closed-ish: report caps as hit so a broken read can't unlock spamming.
    return {
      postsThisHour: 99, postsToday: 99,
      commentsThisHour: 99, commentsToday: 99,
      upvotesThisHour: 99, upvotesToday: 99,
      msSinceLastPost: 0, currentHourUTC: new Date().getUTCHours(),
    };
  }
}
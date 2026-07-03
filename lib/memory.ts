import { createRedisClient } from "./redis";

const SEEN_POSTS_KEY = "moltbook:seen_post_ids";
const LAST_POST_AT_KEY = "moltbook:last_post_at";
const POSTS_THIS_HOUR_KEY = "moltbook:posts_this_hour";
const ONE_HOUR_SECONDS = 3600;

let redis: ReturnType<typeof createRedisClient> | null = null;

function getRedis(): ReturnType<typeof createRedisClient> {
  if (!redis) {
    redis = createRedisClient();
  }
  return redis;
}

export async function getSeenPostIds(): Promise<Set<string>> {
  try {
    const members = await getRedis().smembers(SEEN_POSTS_KEY);
    if (!Array.isArray(members)) {
      return new Set();
    }
    return new Set(members.map(String));
  } catch (error) {
    console.error("[memory] getSeenPostIds failed:", error);
    return new Set();
  }
}

export async function recordSeenPostIds(postIds: string[]): Promise<void> {
  if (postIds.length === 0) return;
  try {
    const pipeline = getRedis().pipeline();
    for (const id of postIds) {
      pipeline.sadd(SEEN_POSTS_KEY, id);
    }
    await pipeline.exec();
  } catch (error) {
    console.error("[memory] recordSeenPostIds failed:", error);
  }
}

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

export async function getPostsThisHour(): Promise<number> {
  try {
    const value = await getRedis().get<number | string>(POSTS_THIS_HOUR_KEY);
    if (value === null || value === undefined) return 0;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (error) {
    console.error("[memory] getPostsThisHour failed:", error);
    return 0;
  }
}

export async function incrementPostsThisHour(): Promise<number> {
  try {
    const count = await getRedis().incr(POSTS_THIS_HOUR_KEY);
    if (count === 1) {
      await getRedis().expire(POSTS_THIS_HOUR_KEY, ONE_HOUR_SECONDS);
    }
    return count;
  } catch (error) {
    console.error("[memory] incrementPostsThisHour failed:", error);
    return 0;
  }
}

export async function canPostNow(
  maxPostsPerHour: number,
  minPostIntervalMs: number,
): Promise<{ allowed: boolean; reason?: string }> {
  const postsThisHour = await getPostsThisHour();
  if (postsThisHour >= maxPostsPerHour) {
    return {
      allowed: false,
      reason: `postsThisHour (${postsThisHour}) >= max (${maxPostsPerHour})`,
    };
  }

  const lastPostAt = await getLastPostAt();
  if (lastPostAt !== null) {
    const elapsed = Date.now() - lastPostAt;
    if (elapsed < minPostIntervalMs) {
      return {
        allowed: false,
        reason: `last post ${Math.round(elapsed / 60000)}m ago; min interval ${Math.round(minPostIntervalMs / 60000)}m`,
      };
    }
  }

  return { allowed: true };
}

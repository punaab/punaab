import { createRedisClient } from "./redis";

const AGENT_HOURLY_LIMIT = 10;
const GLOBAL_HOURLY_LIMIT = 120;
const WINDOW_SEC = 3600;

export class CollabRateLimitError extends Error {
  readonly retryAfterSec: number;

  constructor(message: string, retryAfterSec = WINDOW_SEC) {
    super(message);
    this.name = "CollabRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

function hourBucket(): string {
  return new Date().toISOString().slice(0, 13);
}

/**
 * Per-agent + global hourly caps to limit inbox spam while keeping collab open.
 */
export async function assertCollabRateLimit(agentId: string): Promise<void> {
  const bucket = hourBucket();
  const agentKey = `moltbook:collab:rate:agent:${agentId}:${bucket}`;
  const globalKey = `moltbook:collab:rate:global:${bucket}`;

  const redis = createRedisClient();
  const [agentCount, globalCount] = await Promise.all([
    redis.incr(agentKey),
    redis.incr(globalKey),
  ]);

  if (agentCount === 1) {
    await redis.expire(agentKey, WINDOW_SEC);
  }
  if (globalCount === 1) {
    await redis.expire(globalKey, WINDOW_SEC);
  }

  if (agentCount > AGENT_HOURLY_LIMIT) {
    throw new CollabRateLimitError(
      `Collab limit: max ${AGENT_HOURLY_LIMIT} proposals per agent per hour.`,
    );
  }
  if (globalCount > GLOBAL_HOURLY_LIMIT) {
    throw new CollabRateLimitError(
      "Collab inbox is busy — try again later.",
    );
  }
}

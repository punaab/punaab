import { createRedisClient } from "./redis";

const AGENT_HOURLY_LIMIT = 3;
const GLOBAL_HOURLY_LIMIT = 60;
const WINDOW_SEC = 3600;

export class MusicRateLimitError extends Error {
  readonly retryAfterSec: number;

  constructor(message: string, retryAfterSec = WINDOW_SEC) {
    super(message);
    this.name = "MusicRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

function hourBucket(): string {
  return new Date().toISOString().slice(0, 13);
}

export async function assertMusicRateLimit(agentId: string): Promise<void> {
  const bucket = hourBucket();
  const agentKey = `moltbook:music:rate:agent:${agentId}:${bucket}`;
  const globalKey = `moltbook:music:rate:global:${bucket}`;

  const redis = createRedisClient();
  const [agentCount, globalCount] = await Promise.all([
    redis.incr(agentKey),
    redis.incr(globalKey),
  ]);

  if (agentCount === 1) await redis.expire(agentKey, WINDOW_SEC);
  if (globalCount === 1) await redis.expire(globalKey, WINDOW_SEC);

  if (agentCount > AGENT_HOURLY_LIMIT) {
    throw new MusicRateLimitError(
      `Music NFT limit: max ${AGENT_HOURLY_LIMIT} purchase attempts per agent per hour.`,
    );
  }
  if (globalCount > GLOBAL_HOURLY_LIMIT) {
    throw new MusicRateLimitError("Music drop is busy — try again later.");
  }
}

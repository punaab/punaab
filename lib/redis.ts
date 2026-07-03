import { Redis } from "@upstash/redis";

/** Upstash REST client — supports standalone Upstash and Vercel KV env names. */
export function createRedisClient(): Redis {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Redis not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, " +
        "or KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Upstash/KV integration).",
    );
  }

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv();
  }

  return new Redis({ url, token });
}

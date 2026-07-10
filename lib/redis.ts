import { Redis } from "@upstash/redis";

/** Upstash REST client — supports standalone Upstash and Vercel KV env names. */
function envValue(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function createRedisClient(): Redis {
  const url =
    envValue("UPSTASH_REDIS_REST_URL") ?? envValue("KV_REST_API_URL");
  const token =
    envValue("UPSTASH_REDIS_REST_TOKEN") ?? envValue("KV_REST_API_TOKEN");

  if (!url || !token) {
    throw new Error(
      "Redis not configured. Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, " +
        "or KV_REST_API_URL + KV_REST_API_TOKEN (Vercel Upstash/KV integration).",
    );
  }

  if (envValue("UPSTASH_REDIS_REST_URL") && envValue("UPSTASH_REDIS_REST_TOKEN")) {
    return Redis.fromEnv();
  }

  return new Redis({ url, token });
}

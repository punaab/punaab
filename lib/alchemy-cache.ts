import { createRedisClient } from "./redis";
import { parseRedisValue } from "./redis-json";

const memoryCache = new Map<string, { value: unknown; expiresAt: number }>();

export async function getCached<T>(
  key: string,
  ttlSec: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > now) {
    return mem.value as T;
  }

  try {
    const raw = await createRedisClient().get(key);
    if (raw) {
      const parsed = parseRedisValue<{ v: T; exp: number }>(raw);
      if (parsed && parsed.exp > now) {
        memoryCache.set(key, { value: parsed.v, expiresAt: parsed.exp });
        return parsed.v;
      }
    }
  } catch {
    // fall through to fetcher
  }

  const value = await fetcher();
  const exp = now + ttlSec * 1000;
  memoryCache.set(key, { value, expiresAt: exp });

  try {
    await createRedisClient().set(key, { v: value, exp }, { ex: ttlSec });
  } catch {
    // cache write optional
  }

  return value;
}

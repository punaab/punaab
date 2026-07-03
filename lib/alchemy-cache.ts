import { createRedisClient } from "./redis";

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
    const raw = await createRedisClient().get<string>(key);
    if (raw) {
      const parsed = JSON.parse(raw) as { v: T; exp: number };
      if (parsed.exp > now) {
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
    await createRedisClient().set(key, JSON.stringify({ v: value, exp }), {
      ex: ttlSec,
    });
  } catch {
    // cache write optional
  }

  return value;
}

import { createRedisClient } from "./redis";
import { parseRedisValue } from "./redis-json";
import type { MusicOrder } from "./music-nft";

const ORDERS_KEY = "moltbook:music-nft:orders";
const LIVE_KEY = "moltbook:music-nft:drop-live";

export async function loadOrdersForAdmin(limit = 20): Promise<MusicOrder[]> {
  const raw = await createRedisClient().get(ORDERS_KEY);
  const orders = parseRedisValue<MusicOrder[]>(raw) ?? [];
  return orders.slice(0, limit);
}

export async function getMusicDropLiveFlag(): Promise<boolean | null> {
  const raw = await createRedisClient().get(LIVE_KEY);
  if (raw === null || raw === undefined) return null;
  return raw === true || raw === "true" || raw === 1 || raw === "1";
}

export async function setMusicDropLiveFlag(live: boolean): Promise<void> {
  await createRedisClient().set(LIVE_KEY, live);
}

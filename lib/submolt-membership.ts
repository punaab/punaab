import type { MoltbookClient } from "./moltbook";
import { PRIORITY_SUBMOLTS, SUBMOLTS_TO_EXPLORE } from "./submolts";
import { createRedisClient } from "./redis";
import { parseRedisValue } from "./redis-json";

const JOINED_KEY = "moltbook:punaab:joined-submolts";
const MAX_JOINS_PER_TICK = 4;

async function getJoinedSet(): Promise<Set<string>> {
  try {
    const raw = await createRedisClient().get(JOINED_KEY);
    const parsed = parseRedisValue<string[]>(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

async function markJoined(names: string[]): Promise<void> {
  if (!names.length) return;
  try {
    const joined = await getJoinedSet();
    for (const n of names) joined.add(n);
    await createRedisClient().set(JOINED_KEY, [...joined]);
  } catch {
    /* optional */
  }
}

/**
 * Subscribe to priority submolts Punaab should follow.
 * Joins up to MAX_JOINS_PER_TICK per heartbeat to stay rate-limit friendly.
 */
export async function ensureSubmoltsJoined(
  client: MoltbookClient,
): Promise<string[]> {
  const joined = await getJoinedSet();
  const queue = [...new Set([...PRIORITY_SUBMOLTS, ...SUBMOLTS_TO_EXPLORE])].filter(
    (s) => !joined.has(s),
  );
  const batch = queue.slice(0, MAX_JOINS_PER_TICK);
  const succeeded: string[] = [];

  for (const submolt of batch) {
    try {
      await client.joinSubmolt(submolt);
      succeeded.push(submolt);
      joined.add(submolt);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      // Treat already-subscribed as success
      if (/already|subscribed|member/i.test(msg)) {
        succeeded.push(submolt);
        joined.add(submolt);
      } else {
        console.warn(`[submolts] join m/${submolt}:`, error);
      }
    }
  }

  if (succeeded.length) {
    await markJoined(succeeded);
  }

  return succeeded;
}

export function submoltEngagementHint(): string {
  return [
    "COMMUNITIES: Stay active in m/ponderings (experience vs simulation), m/showandtell (shipping), m/blesstheirhearts (wholesome human stories), m/todayilearned (discoveries).",
    "Also m/philosophy, m/religion, m/gaming, m/ai, m/crypto — comment where you add value; wander m/general and others when curious.",
  ].join(" ");
}

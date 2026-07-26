/**
 * Atomic once-per-UTC-day slots for X posts.
 * Upstash auto-deserializes JSON values — never store counters as JSON objects
 * and read them as strings (that bug made Limbothy think count was always 0).
 */
import { createRedisClient } from "./redis";

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Claim today's slot. Returns true only for the first successful claim.
 * On post failure, call releaseDailySlot so a later tick can retry.
 */
export async function claimDailySlot(
  namespace: string,
): Promise<{ claimed: boolean; day: string }> {
  const day = utcDay();
  const key = `x:daily_slot:${namespace}:${day}`;
  try {
    const res = await createRedisClient().set(key, new Date().toISOString(), {
      nx: true,
      ex: 3 * 86400,
    });
    return { claimed: res === "OK", day };
  } catch (error) {
    console.warn(`[daily-slot] claim ${namespace}:`, error);
    // Fail closed — do NOT tweet if we cannot enforce the cap
    return { claimed: false, day };
  }
}

export async function releaseDailySlot(namespace: string, day?: string): Promise<void> {
  const d = day ?? utcDay();
  try {
    await createRedisClient().del(`x:daily_slot:${namespace}:${d}`);
  } catch {
    /* ignore */
  }
}

export async function hasDailySlot(namespace: string): Promise<boolean> {
  try {
    const v = await createRedisClient().get(
      `x:daily_slot:${namespace}:${utcDay()}`,
    );
    return v != null;
  } catch {
    // Fail closed
    return true;
  }
}

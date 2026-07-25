/**
 * If Moltbook heartbeat hasn't run recently, run one now.
 * Prediction cron is frequent on Vercel; Hobby's native heartbeat cron is ~1/day,
 * and GitHub Actions backup may be missing secrets — this keeps the agent alive.
 */
import { getLastHeartbeat } from "@/lib/owner-state";

const STALE_MS = 28 * 60 * 1000;

export async function maybeRunHeartbeatIfStale(): Promise<{
  ran: boolean;
  ok?: boolean;
  ageMs?: number;
  error?: string;
}> {
  try {
    const last = await getLastHeartbeat();
    const ageMs = last
      ? Date.now() - new Date(last).getTime()
      : Number.POSITIVE_INFINITY;
    if (Number.isFinite(ageMs) && ageMs < STALE_MS) {
      return { ran: false, ageMs };
    }

    const { runHeartbeatTick } = await import("@/lib/heartbeat");
    const summary = await runHeartbeatTick();
    return { ran: true, ok: summary.ok, ageMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[heartbeat-keepalive]", message);
    return { ran: false, error: message };
  }
}

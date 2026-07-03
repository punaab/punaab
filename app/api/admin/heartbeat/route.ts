import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import { runHeartbeatTick } from "@/lib/heartbeat";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-triggered heartbeat — runs in-process (no CRON_SECRET self-fetch). */
export async function POST() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runHeartbeatTick({ prioritizeCampaign: true });
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "heartbeat_failed";
    return NextResponse.json({ error: message, ok: false, errors: [message] }, { status: 500 });
  }
}

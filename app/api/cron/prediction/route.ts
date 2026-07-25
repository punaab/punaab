import { getCronSecret } from "@/lib/config";
import { maybeRunHeartbeatIfStale } from "@/lib/heartbeat-keepalive";
import { runPredictionTick } from "@/lib/prediction-trading/engine";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Forecast pricing is paced (~1 RPS); allow a full scan + orders + occasional heartbeat. */
export const maxDuration = 120;
/**
 * Jupiter Prediction blocks US + South Korea IPs.
 * Prefer Singapore egress for cron ticks (not iad1/sfo1).
 */
export const preferredRegion = ["sin1"];

function authorize(request: NextRequest): boolean {
  if (
    process.env.VERCEL === "1" &&
    request.headers.get("x-vercel-cron") === "1"
  ) {
    return true;
  }

  const secret = getCronSecret();
  if (!secret) {
    console.error("[prediction-cron] CRON_SECRET is not configured");
    return false;
  }

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice("Bearer ".length) === secret;
}

/** Vercel cron — runs Jupiter Forecast prediction tick without a local daemon. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json(
      {
        ok: false,
        timestamp: new Date().toISOString(),
        dryRun: true,
        marketsScanned: 0,
        signals: [],
        executed: [],
        claims: [],
        errors: ["unauthorized"],
      },
      { status: 401 },
    );
  }

  try {
    const summary = await runPredictionTick();
    // Keep Moltbook heartbeat fresh when Vercel Hobby / missing GH Actions secrets
    // would otherwise leave /admin showing "Heartbeat stale".
    const keepalive = await maybeRunHeartbeatIfStale();
    return NextResponse.json(
      {
        ...summary,
        heartbeatKeepalive: keepalive,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[prediction-cron]", message);
    return NextResponse.json(
      {
        ok: false,
        timestamp: new Date().toISOString(),
        dryRun: true,
        marketsScanned: 0,
        signals: [],
        executed: [],
        claims: [],
        errors: [message],
      },
      { status: 500 },
    );
  }
}

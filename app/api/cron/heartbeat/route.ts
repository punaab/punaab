import { getCronSecret } from "@/lib/config";
import { runHeartbeatTick, type TickSummary } from "@/lib/heartbeat";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(request: NextRequest): boolean {
  if (
    process.env.VERCEL === "1" &&
    request.headers.get("x-vercel-cron") === "1"
  ) {
    return true;
  }

  const secret = getCronSecret();
  if (!secret) {
    console.error("[heartbeat] CRON_SECRET is not configured");
    return false;
  }

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice("Bearer ".length) === secret;
}

export async function GET(request: NextRequest): Promise<NextResponse<TickSummary>> {
  const prioritizeCampaign =
    request.nextUrl.searchParams.get("prioritizeCampaign") === "1";

  if (!authorize(request)) {
    return NextResponse.json(
      {
        ok: false,
        timestamp: new Date().toISOString(),
        feedCount: 0,
        newPostCount: 0,
        notificationCount: 0,
        canPost: false,
        errors: ["unauthorized"],
        plan: { action: "noop", reason: "unauthorized" },
        executed: [],
      },
      { status: 401 },
    );
  }

  const summary = await runHeartbeatTick({ prioritizeCampaign });
  return NextResponse.json(summary, { status: 200 });
}

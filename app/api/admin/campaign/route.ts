import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import {
  loadCampaignForDashboard,
  pauseCampaign,
  resetCampaign,
  startCampaign,
  type CampaignStep,
} from "@/lib/campaign";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loaded = await loadCampaignForDashboard();
  return NextResponse.json({
    campaign: loaded.campaign,
    persisted: loaded.persisted,
    error: loaded.error,
  });
}

export async function POST(request: NextRequest) {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    action?: "start" | "pause" | "reset";
    steps?: Array<Pick<CampaignStep, "title" | "content">>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const action = body.action ?? "start";

  try {
    let campaign;
    switch (action) {
      case "pause":
        campaign = await pauseCampaign();
        break;
      case "reset":
        campaign = await resetCampaign();
        break;
      case "start":
      default:
        campaign = await startCampaign(body.steps);
        break;
    }
    return NextResponse.json({ campaign, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "campaign_save_failed";
    const redisHint = message.includes("Redis")
      ? message
      : `Could not save campaign state. Ensure Upstash/KV Redis is configured on Vercel. (${message})`;
    console.error("[campaign] action failed:", error);
    return NextResponse.json({ error: redisHint, ok: false }, { status: 503 });
  }
}

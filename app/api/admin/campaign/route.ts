import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import {
  getOrCreateCampaign,
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
  const campaign = await getOrCreateCampaign();
  return NextResponse.json({ campaign });
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

  return NextResponse.json({ campaign });
}

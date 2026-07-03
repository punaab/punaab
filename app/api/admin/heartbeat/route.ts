import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import { getCronSecret, getSiteUrl } from "@/lib/config";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-triggered heartbeat — runs one Moltbook tick (campaign posts when eligible). */
export async function POST() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = getCronSecret();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET is not set on the server. Add it in Vercel env (same value as heartbeat auth).",
      },
      { status: 503 },
    );
  }

  const base = getSiteUrl().replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/cron/heartbeat?prioritizeCampaign=1`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const body = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(body, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "heartbeat_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

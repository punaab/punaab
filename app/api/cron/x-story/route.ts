import { getCronSecret } from "@/lib/config";
import { maybePunaabStoryTweet } from "@/lib/punaab-story/daily-tweet";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: NextRequest): boolean {
  if (
    process.env.VERCEL === "1" &&
    request.headers.get("x-vercel-cron") === "1"
  ) {
    return true;
  }

  const secret = getCronSecret();
  if (!secret) {
    console.error("[x-story-cron] CRON_SECRET is not configured");
    return false;
  }

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice("Bearer ".length) === secret;
}

/** Hourly story tweet attempt — up to 4/day via Redis NX windows. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await maybePunaabStoryTweet();
    return NextResponse.json({
      ok: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[x-story-cron]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

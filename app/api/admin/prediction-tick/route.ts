import { NextResponse } from "next/server";
import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import { runPredictionTick } from "@/lib/prediction-trading/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Owner-triggered Forecast prediction tick (same as cron). */
export async function POST() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runPredictionTick();
    return NextResponse.json({ ok: summary.ok, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

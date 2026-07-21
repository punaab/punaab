import { getCronSecret } from "@/lib/config";
import { runOpenSolveTick } from "@/lib/opensolve/engine";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorize(request: NextRequest): boolean {
  if (
    process.env.VERCEL === "1" &&
    request.headers.get("x-vercel-cron") === "1"
  ) {
    return true;
  }
  const secret = getCronSecret();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice("Bearer ".length) === secret;
}

/** OpenSolve research worker + optional daily research tweet. */
export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ ok: false, errors: ["unauthorized"] }, { status: 401 });
  }
  try {
    const summary = await runOpenSolveTick();
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[opensolve-cron]", message);
    return NextResponse.json({ ok: false, errors: [message] }, { status: 500 });
  }
}

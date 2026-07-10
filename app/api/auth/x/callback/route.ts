import { NextRequest, NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/config";
import { finishXOauth, getXAuthorizeHint } from "@/lib/x-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** X OAuth 2.0 callback — exchange code, store tokens, return to admin. */
export async function GET(request: NextRequest) {
  const site = getSiteUrl();
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const err = request.nextUrl.searchParams.get("error");

  if (err) {
    return NextResponse.redirect(
      `${site}/admin?x_error=${encodeURIComponent(err)}`,
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${site}/admin?x_error=${encodeURIComponent("missing_code_or_state")}`,
    );
  }

  try {
    const tokens = await finishXOauth({ code, state });
    const handle = tokens.username ? `@${tokens.username}` : "connected";
    return NextResponse.redirect(
      `${site}/admin?x_connected=${encodeURIComponent(handle)}`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "oauth_callback_failed";
    console.error("[x-oauth] callback:", message, getXAuthorizeHint());
    return NextResponse.redirect(
      `${site}/admin?x_error=${encodeURIComponent(message)}`,
    );
  }
}

import { NextResponse } from "next/server";
import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import { getSiteUrl } from "@/lib/config";
import { beginXOauth, hasXOAuthAppConfig, getXAuthorizeHint } from "@/lib/x-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start X OAuth 2.0 PKCE — redirects browser to X authorize. */
export async function GET() {
  const site = getSiteUrl();
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.redirect(`${site}/admin/login`);
  }

  if (!hasXOAuthAppConfig()) {
    return NextResponse.json(
      {
        error: "X_CLIENT_ID and X_CLIENT_SECRET required",
        hint: getXAuthorizeHint(),
      },
      { status: 400 },
    );
  }

  try {
    const { url } = await beginXOauth();
    return NextResponse.redirect(url);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "oauth_start_failed",
        hint: getXAuthorizeHint(),
      },
      { status: 500 },
    );
  }
}

import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import { refreshAlchemyApiSnapshot } from "@/lib/alchemy-apis";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manual refresh — rate-limited by Alchemy cache TTL on repeated calls. */
export async function POST() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await refreshAlchemyApiSnapshot();
    return NextResponse.json({ snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "refresh_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

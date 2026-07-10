import { NextResponse } from "next/server";
import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import { clearXTokens, getXConnectionStatus } from "@/lib/x-auth";
import { canPostToX } from "@/lib/x-twitter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = await getXConnectionStatus();
  const can = await canPostToX();
  return NextResponse.json({ ...status, canPost: can });
}

export async function DELETE() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await clearXTokens();
  return NextResponse.json({ ok: true });
}

import {
  clearAdminCookie,
  createSessionToken,
  setAdminCookie,
  verifyAdminPassword,
} from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const password = body.password ?? "";
  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  const token = createSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: "session_not_configured", message: "Set ADMIN_SESSION_SECRET" },
      { status: 500 },
    );
  }

  const response = NextResponse.json({ ok: true });
  setAdminCookie(response, token);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearAdminCookie(response);
  return response;
}

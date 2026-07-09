import {
  clearOwnerMusicCookie,
  loginWithMoltbookIdentity,
  setOwnerMusicCookie,
} from "@/lib/owner-music-auth";
import { MoltbookAuthError } from "@/lib/moltbook-auth";
import { getSiteUrl } from "@/lib/config";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  identityToken: z.string().min(20),
});

export async function GET() {
  const base = getSiteUrl().replace(/\/$/, "");
  const loginUrl = `${base}/api/owners/music/login`;
  const portalUrl = `${base}/owners/music`;
  const authDoc = `https://moltbook.com/auth.md?app=Punaab&endpoint=${encodeURIComponent(loginUrl)}`;

  return NextResponse.json({
    ok: true,
    portal: portalUrl,
    login: loginUrl,
    method: "POST",
    body: { identityToken: "Moltbook identity token (x-moltbook-identity)" },
    auth: {
      instructionsUrl: authDoc,
      steps: [
        `Read ${authDoc}`,
        "Mint an identity token for this endpoint (audience = your site host).",
        `POST ${loginUrl} with { identityToken } — sets a session cookie.`,
        `Open ${portalUrl} to stream and download your agent's anthem.`,
      ],
    },
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  try {
    const { session, token } = await loginWithMoltbookIdentity(
      parsed.data.identityToken.trim(),
      request.url,
    );
    const response = NextResponse.json({
      ok: true,
      agent: {
        id: session.agentId,
        name: session.agentName,
        ownerHandle: session.ownerHandle,
        avatarUrl: session.avatarUrl,
      },
      portal: "/owners/music",
    });
    setOwnerMusicCookie(response, token);
    return response;
  } catch (error) {
    if (error instanceof MoltbookAuthError) {
      return NextResponse.json(
        { error: error.code, message: error.message, hint: error.hint },
        { status: error.status },
      );
    }
    if (error instanceof Error && error.message === "session_not_configured") {
      return NextResponse.json(
        { error: "session_not_configured", message: "Set ADMIN_SESSION_SECRET on server." },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: "login_failed" }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearOwnerMusicCookie(response);
  return response;
}

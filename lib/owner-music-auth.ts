import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAdminSessionSecret } from "./config";
import { OWNER_MUSIC_COOKIE } from "./owner-music-constants";
import { verifyIdentityToken, type VerifiedMoltbookAgent } from "./moltbook-auth";

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export interface OwnerMusicSession {
  agentId: string;
  agentName: string;
  ownerHandle?: string;
  avatarUrl?: string | null;
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createOwnerMusicSessionToken(agentId: string): string | null {
  const secret = getAdminSessionSecret();
  if (!secret || !agentId) return null;
  const expiresAt = Date.now() + SESSION_MAX_AGE_SEC * 1000;
  const payload = `owner-music:${agentId}:${expiresAt}`;
  return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyOwnerMusicSessionToken(
  token: string | undefined,
): { agentId: string } | null {
  if (!token) return null;
  const secret = getAdminSessionSecret();
  if (!secret) return null;

  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = signPayload(payload, secret);

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const parts = payload.split(":");
  if (parts[0] !== "owner-music" || !parts[1] || !parts[2]) return null;
  const expiresAt = Number(parts[2]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return { agentId: parts[1] };
}

export function ownerSessionFromAgent(agent: VerifiedMoltbookAgent): OwnerMusicSession {
  return {
    agentId: agent.id,
    agentName: agent.name,
    ownerHandle: agent.owner?.x_handle ?? agent.human?.username,
    avatarUrl: agent.avatar_url,
  };
}

export async function loginWithMoltbookIdentity(
  identityToken: string,
  requestUrl: string,
): Promise<{ session: OwnerMusicSession; token: string }> {
  const agent = await verifyIdentityToken(identityToken, {
    audience: new URL(requestUrl).hostname,
  });
  const token = createOwnerMusicSessionToken(agent.id);
  if (!token) {
    throw new Error("session_not_configured");
  }
  return { session: ownerSessionFromAgent(agent), token };
}

export function setOwnerMusicCookie(response: NextResponse, token: string): void {
  response.cookies.set(OWNER_MUSIC_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export function clearOwnerMusicCookie(response: NextResponse): void {
  response.cookies.set(OWNER_MUSIC_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function getOwnerMusicSessionFromCookies(): Promise<OwnerMusicSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(OWNER_MUSIC_COOKIE)?.value;
  const verified = verifyOwnerMusicSessionToken(token);
  if (!verified) return null;

  return { agentId: verified.agentId, agentName: "" };
}

export function getOwnerMusicSessionFromRequest(
  request: NextRequest,
): { agentId: string } | null {
  const token = request.cookies.get(OWNER_MUSIC_COOKIE)?.value;
  return verifyOwnerMusicSessionToken(token);
}

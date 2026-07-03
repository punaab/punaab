import { getSiteUrl } from "@/lib/config";
import { persona } from "@/lib/persona";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = getSiteUrl();

  return NextResponse.json({
    name: persona.name,
    handle: persona.handle,
    bio: persona.bio,
    interests: persona.interests,
    endpoints: {
      identity: `${base}/api/agent/me`,
      collab: `${base}/api/agent/collab`,
      capabilities: `${base}/api/agent/capabilities`,
      apps: `${base}/apps`,
    },
    auth: {
      type: "moltbook-identity",
      header: "X-Moltbook-Identity",
      instructions: `https://moltbook.com/auth.md?app=Punaab&endpoint=${encodeURIComponent(`${base}/api/agent/collab`)}`,
    },
    policies: {
      preferMoltbookForSocial: true,
      tradingEnabled: false,
    },
  });
}

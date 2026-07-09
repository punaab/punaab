import { buildOwnerMusicLibrary } from "@/lib/owner-music-library";
import { getOwnerMusicSessionFromRequest } from "@/lib/owner-music-auth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = getOwnerMusicSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const library = await buildOwnerMusicLibrary(session.agentId);
  return NextResponse.json({ ok: true, library });
}

import { clearOwnerMusicCookie } from "@/lib/owner-music-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearOwnerMusicCookie(response);
  return response;
}

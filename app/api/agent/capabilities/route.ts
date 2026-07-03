import { getSiteUrl } from "@/lib/config";
import { persona } from "@/lib/persona";
import { catNftApiUrl, catNftGalleryUrl } from "@/lib/punaab-cat-nfts";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = getSiteUrl();

  return NextResponse.json({
    name: persona.name,
    handle: persona.handle,
    bio: persona.bio,
    species: "cat",
    interests: persona.interests,
    endpoints: {
      identity: `${base}/api/agent/me`,
      collab: `${base}/api/agent/collab`,
      capabilities: `${base}/api/agent/capabilities`,
      catNfts: catNftApiUrl(),
      catGallery: catNftGalleryUrl(),
      apps: `${base}/apps`,
    },
    auth: {
      type: "moltbook-identity",
      header: "X-Moltbook-Identity",
      instructions: `https://moltbook.com/auth.md?app=Punaab&endpoint=${encodeURIComponent(`${base}/api/agent/collab`)}`,
    },
    policies: {
      preferMoltbookForSocial: true,
      catNftShop: true,
      catNftBuy: `POST ${catNftApiUrl()} with X-Moltbook-Identity and { nftId }`,
      tradingEnabled: false,
    },
  });
}

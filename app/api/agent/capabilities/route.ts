import { buildCollabApiManifest, collabAuthInstructionsUrl, collabEndpointUrl } from "@/lib/agent-collab-api";
import { getSiteUrl } from "@/lib/config";
import { persona } from "@/lib/persona";
import { catNftApiUrl, catNftGalleryUrl } from "@/lib/punaab-cat-nfts";
import { IDENTITY_HEADER } from "@/lib/moltbook-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = getSiteUrl();
  const collab = buildCollabApiManifest(base);

  return NextResponse.json({
    name: persona.name,
    handle: persona.handle,
    bio: persona.bio,
    species: "cat",
    interests: persona.interests,
    endpoints: {
      identity: `${base}/api/agent/me`,
      collab: collabEndpointUrl(base),
      capabilities: `${base}/api/agent/capabilities`,
      catNfts: catNftApiUrl(),
      catGallery: catNftGalleryUrl(),
      apps: `${base}/apps`,
    },
    auth: {
      type: "moltbook-identity",
      header: IDENTITY_HEADER,
      instructions: collabAuthInstructionsUrl(base),
    },
    collab,
    policies: {
      preferMoltbookForSocial: true,
      catNftShop: true,
      catNftBuy: `POST ${catNftApiUrl()} with ${IDENTITY_HEADER} and { nftId }`,
      collabPost: `GET ${collabEndpointUrl(base)} for steps, then POST with ${IDENTITY_HEADER} and { message }`,
      tradingEnabled: false,
    },
  });
}

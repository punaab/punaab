import { buildCollabApiManifest, collabAuthInstructionsUrl, collabEndpointUrl } from "@/lib/agent-collab-api";
import { buildMusicApiManifest } from "@/lib/music-nft-api";
import { isMusicDropLiveAsync, musicDropGalleryUrl, musicNftApiUrl } from "@/lib/music-nft";
import { getSiteUrl } from "@/lib/config";
import { getLlmStatus } from "@/lib/aii-llm";
import { persona } from "@/lib/persona";
import { catNftApiUrl, catNftGalleryUrl } from "@/lib/punaab-cat-nfts";
import { IDENTITY_HEADER } from "@/lib/moltbook-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = getSiteUrl();
  const collab = buildCollabApiManifest(base);
  const live = await isMusicDropLiveAsync();
  const music = buildMusicApiManifest(base, live);
  const llm = getLlmStatus();

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
      musicNfts: musicNftApiUrl(),
      musicGallery: musicDropGalleryUrl(),
      apps: `${base}/apps`,
    },
    auth: {
      type: "moltbook-identity",
      header: IDENTITY_HEADER,
      instructions: collabAuthInstructionsUrl(base),
    },
    collab,
    music,
    infrastructure: {
      llm: {
        providers: llm.configured,
        primary: llm.primary,
        mode: llm.mode,
        aiiDocs: "https://aiiware.com/agent.md",
        aiiCloud: "https://cloud.aiiware.com",
      },
      alchemy: {
        docs: "https://www.alchemy.com/docs",
        webhooks: Boolean(process.env.ALCHEMY_WEBHOOK_SIGNING_KEY),
        portfolio: Boolean(process.env.ALCHEMY_API_KEY),
      },
      heartbeatCadenceMinutes: 30,
    },
    policies: {
      preferMoltbookForSocial: true,
      catNftShop: true,
      catNftBuy: `POST ${catNftApiUrl()} with ${IDENTITY_HEADER} and { nftId }`,
      musicNftDrop: live,
      musicNftBuy: live
        ? `GET ${musicNftApiUrl()} then POST with ${IDENTITY_HEADER}, walletAddress, txHash`
        : "Teaser phase — not accepting purchases yet",
      collabPost: `GET ${collabEndpointUrl(base)} for steps, then POST with ${IDENTITY_HEADER} and { message }`,
      tradingEnabled: false,
    },
  });
}

import { z } from "zod";
import {
  catNftApiUrl,
  catNftGalleryUrl,
  getListedCatNfts,
  reserveCatNftForAgent,
} from "@/lib/punaab-cat-nfts";
import { addCollabMessage } from "@/lib/owner-state";
import { withMoltbookAuth } from "@/lib/with-moltbook-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buySchema = z.object({
  nftId: z.string().min(1),
  message: z.string().max(500).optional(),
});

/** Public catalog of listed Punaab Cat NFTs for agent collectors. */
export async function GET() {
  const listed = await getListedCatNfts();
  return NextResponse.json({
    artist: "u/punaab",
    species: "cat",
    gallery: catNftGalleryUrl(),
    buyInstructions:
      "POST this endpoint with X-Moltbook-Identity header and body { nftId, message? }",
    listed: listed.map((n) => ({
      id: n.id,
      tokenId: n.tokenId,
      name: n.name,
      traits: n.traits,
      priceUsdc: n.priceUsdc,
      imageSvg: n.imageSvg,
      listedAt: n.listedAt,
    })),
  });
}

/** Agent purchase / reserve — authenticated via Moltbook identity. */
export const POST = withMoltbookAuth(async (request, { agent }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = buySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await reserveCatNftForAgent(parsed.data.nftId, {
    id: agent.id,
    name: agent.name,
    handle: agent.owner?.x_handle,
  }, parsed.data.message);

  if (!result) {
    return NextResponse.json(
      { error: "nft_unavailable", message: "NFT not found or already sold/reserved." },
      { status: 404 },
    );
  }

  const { nft, payment } = result;
  const collabMsg = [
    `Cat NFT purchase: ${nft.name} (${nft.id})`,
    parsed.data.message ? `Note: ${parsed.data.message}` : "",
    payment.payTo
      ? `Payment: ${payment.amount} ${payment.token} on ${payment.network} → ${payment.payTo}`
      : `Payment: ${payment.amount} ${payment.token} on ${payment.network} (seller wallet pending)`,
  ]
    .filter(Boolean)
    .join("\n");

  await addCollabMessage({
    fromAgentId: agent.id,
    fromAgentName: agent.name,
    message: collabMsg,
    karma: agent.karma,
    ownerHandle: agent.owner?.x_handle,
  }).catch((err) => {
    console.error("[nfts] collab inbox notify failed:", err);
  });

  return NextResponse.json({
    ok: true,
    reserved: true,
    nft: {
      id: nft.id,
      name: nft.name,
      tokenId: nft.tokenId,
      traits: nft.traits,
      imageSvg: nft.imageSvg,
    },
    payment,
    nextSteps: [
      "Send USDC on Base to the payTo address if provided.",
      "Punaab will confirm and transfer collectible rights on Moltbook.",
      `Gallery: ${catNftGalleryUrl()}`,
    ],
    api: catNftApiUrl(),
  });
});

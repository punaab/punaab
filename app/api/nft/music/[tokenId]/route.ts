import {
  buildErc721Metadata,
  getMusicOrderByTokenId,
} from "@/lib/music-nft";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ERC-721 tokenURI metadata JSON for minted agent anthems. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId: tokenIdStr } = await context.params;
  const tokenId = Number(tokenIdStr);
  if (!Number.isFinite(tokenId) || tokenId < 1) {
    return NextResponse.json({ error: "invalid_token_id" }, { status: 400 });
  }

  const order = await getMusicOrderByTokenId(tokenId).catch(() => null);
  if (!order) {
    return NextResponse.json({ error: "token_not_found" }, { status: 404 });
  }

  const metadata = buildErc721Metadata(order, tokenId);
  return NextResponse.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}

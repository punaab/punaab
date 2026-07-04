import { getMusicOrder } from "@/lib/music-nft";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await context.params;
  const order = await getMusicOrder(orderId).catch(() => null);

  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    status: order.status,
    buyerAgentName: order.buyerAgentName,
    title: order.title,
    tokenId: order.tokenId,
    metadataUrl: order.metadataUrl,
    mintTxHash: order.mintTxHash,
    audioUrl: order.blobAudioUrl ?? order.audioUrl,
    coverUrl: order.blobCoverUrl ?? order.coverUrl,
    error: order.error,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  });
}

import { buildMusicApiManifest } from "@/lib/music-nft-api";
import {
  createMusicOrder,
  getMusicOrderStats,
  getMintedMusicGallery,
  isMusicDropLiveAsync,
  musicDropGalleryUrl,
} from "@/lib/music-nft";
import { MusicRateLimitError, assertMusicRateLimit } from "@/lib/music-rate-limit";
import { getMusicNftPriceUsdc, getTradingBaseAddress } from "@/lib/config";
import { withMoltbookAuth } from "@/lib/with-moltbook-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const buySchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "invalid_evm_address"),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid_tx_hash"),
  payerAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "invalid_payer_address")
    .optional(),
  vibe: z.string().max(120).optional(),
  genre: z.string().max(80).optional(),
  notifyPostId: z.string().max(64).optional(),
});

/** Public discovery + catalog for agent music NFT drop. */
export async function GET() {
  const live = await isMusicDropLiveAsync();
  const manifest = buildMusicApiManifest(undefined, live);
  const gallery = await getMintedMusicGallery().catch(() => []);
  const stats = await getMusicOrderStats().catch(() => ({
    total: 0,
    minted: 0,
    generating: 0,
    failed: 0,
  }));

  return NextResponse.json({
    ...manifest,
    payTo: getTradingBaseAddress() ?? null,
    stats,
    minted: gallery.map((g) => ({
      tokenId: g.tokenId,
      title: g.title,
      buyerAgentName: g.buyerAgentName,
      audioUrl: g.audioUrl,
      coverUrl: g.coverUrl,
      metadataUrl: g.metadataUrl,
      mintedAt: g.mintedAt,
    })),
    gallery: musicDropGalleryUrl(),
  });
}

/** Purchase a one-of-one music NFT — auth + USDC payment + Suno generation. */
export const POST = withMoltbookAuth(async (request, { agent }) => {
  if (!(await isMusicDropLiveAsync())) {
    return NextResponse.json(
      {
        error: "drop_not_live",
        message: "Music NFT drop is in teaser phase — not accepting purchases yet.",
        hint: "GET this endpoint for manifest; watch Punaab's Moltbook for launch post.",
      },
      { status: 403 },
    );
  }

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

  try {
    await assertMusicRateLimit(agent.id);
  } catch (error) {
    if (error instanceof MusicRateLimitError) {
      return NextResponse.json(
        {
          error: "rate_limit_exceeded",
          message: error.message,
          retryAfterSec: error.retryAfterSec,
        },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSec) } },
      );
    }
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const result = await createMusicOrder({
    agent,
    walletAddress: parsed.data.walletAddress,
    payerAddress: parsed.data.payerAddress,
    txHash: parsed.data.txHash,
    vibe: parsed.data.vibe,
    genre: parsed.data.genre,
    notifyPostId: parsed.data.notifyPostId,
  });

  if ("error" in result) {
    const status =
      result.error === "one_per_agent"
        ? 409
        : result.error === "tx_already_used"
          ? 409
          : result.error === "payment_failed" ||
              result.error === "insufficient_amount" ||
              result.error === "usdc_transfer_not_found" ||
              result.error === "payer_mismatch"
            ? 402
            : 400;
    return NextResponse.json(
      {
        error: result.error,
        message: mapErrorMessage(result.error),
        priceUsdc: getMusicNftPriceUsdc(),
      },
      { status },
    );
  }

  const { order } = result;
  const statusUrl = `${request.nextUrl.origin}/api/agent/music/${order.id}`;

  return NextResponse.json(
    {
      ok: true,
      orderId: order.id,
      status: order.status,
      statusUrl,
      message:
        "Payment verified — Suno is composing your anthem. Poll statusUrl until minted (~2-5 min).",
      priceUsdc: order.priceUsdc,
      title: order.title,
    },
    { status: 202 },
  );
});

function mapErrorMessage(code: string): string {
  switch (code) {
    case "one_per_agent":
      return "This agent already minted its one-of-one anthem.";
    case "tx_already_used":
      return "This transaction hash was already used for a purchase.";
    case "insufficient_amount":
      return "USDC transfer amount is below the required price.";
    case "usdc_transfer_not_found":
      return "No USDC transfer to Punaab's wallet found in this transaction.";
    case "payer_mismatch":
      return "USDC in this transaction was not sent from the declared payer wallet.";
    case "seller_wallet_not_configured":
      return "Seller wallet not configured on server.";
    default:
      return code;
  }
}

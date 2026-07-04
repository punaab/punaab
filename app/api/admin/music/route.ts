import { getRemainingCredits } from "@/lib/suno";
import {
  getMusicCampaign,
  getOrCreateMusicCampaign,
  pauseMusicCampaign,
  saveMusicCampaign,
  startMusicCampaign,
} from "@/lib/campaign";
import { getMusicNftContractAddress, getMusicNftPriceUsdc } from "@/lib/config";
import { loadOrdersForAdmin } from "@/lib/music-nft-admin";
import { hasMusicNftMinter } from "@/lib/music-nft-chain";
import {
  getMusicOrderStats,
  isMusicDropLiveAsync,
  musicDropGalleryUrl,
  musicNftApiUrl,
  setMusicDropLive,
  type MusicOrder,
} from "@/lib/music-nft";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [stats, orders, campaign, credits, live] = await Promise.all([
    getMusicOrderStats().catch(() => ({
      total: 0,
      minted: 0,
      generating: 0,
      failed: 0,
    })),
    loadOrdersForAdmin(15).catch(() => [] as MusicOrder[]),
    getMusicCampaign().catch(() => null),
    getRemainingCredits().catch(() => null),
    isMusicDropLiveAsync().catch(() => false),
  ]);

  return NextResponse.json({
    gallery: musicDropGalleryUrl(),
    api: musicNftApiUrl(),
    live,
    priceUsdc: getMusicNftPriceUsdc(),
    sunoCredits: credits,
    contractConfigured: !!getMusicNftContractAddress(),
    minterConfigured: hasMusicNftMinter(),
    stats,
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      buyerAgentName: o.buyerAgentName,
      title: o.title,
      tokenId: o.tokenId,
      error: o.error,
      createdAt: o.createdAt,
    })),
    campaign: campaign
      ? {
          ticker: campaign.ticker,
          status: campaign.status,
          steps: campaign.steps.map((s) => ({
            id: s.id,
            label: s.label,
            status: s.status,
            postUrl: s.postUrl,
          })),
        }
      : null,
  });
}

export async function POST(request: Request) {
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "start_campaign": {
        const campaign = await startMusicCampaign();
        return NextResponse.json({ ok: true, campaign });
      }
      case "pause_campaign": {
        const campaign = await pauseMusicCampaign();
        return NextResponse.json({ ok: true, campaign });
      }
      case "resume_campaign": {
        const campaign = await getOrCreateMusicCampaign();
        campaign.status = "active";
        await saveMusicCampaign(campaign);
        return NextResponse.json({ ok: true, campaign });
      }
      case "go_live": {
        await setMusicDropLive(true);
        return NextResponse.json({ ok: true, live: true });
      }
      case "teaser_mode": {
        await setMusicDropLive(false);
        return NextResponse.json({ ok: true, live: false });
      }
      default:
        return NextResponse.json({ error: "unknown_action" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "action_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

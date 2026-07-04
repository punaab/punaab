import { getRemainingCredits } from "./suno";
import { getMusicCampaign } from "./campaign";
import { hasMusicNftMinter } from "./music-nft-chain";
import { getMusicNftContractAddress, getMusicNftPriceUsdc } from "./config";
import { loadOrdersForAdmin } from "./music-nft-admin";
import {
  getMusicOrderStats,
  isMusicDropLiveAsync,
  musicDropGalleryUrl,
  musicNftApiUrl,
} from "./music-nft";

export async function fetchMusicShopForDashboard() {
  const [stats, orders, campaign, credits, live] = await Promise.all([
    getMusicOrderStats().catch(() => ({
      total: 0,
      minted: 0,
      generating: 0,
      failed: 0,
    })),
    loadOrdersForAdmin(10).catch(() => []),
    getMusicCampaign().catch(() => null),
    getRemainingCredits().catch(() => null),
    isMusicDropLiveAsync().catch(() => false),
  ]);

  return {
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
  };
}

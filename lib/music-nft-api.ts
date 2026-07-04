import { getSiteUrl, getMusicNftPriceUsdc } from "./config";
import { IDENTITY_HEADER } from "./moltbook-auth";
import { musicDropGalleryUrl, musicNftApiUrl } from "./music-nft";

export function musicAuthInstructionsUrl(base = getSiteUrl()): string {
  const endpoint = musicNftApiUrl(base);
  return `https://moltbook.com/auth.md?app=Punaab&endpoint=${encodeURIComponent(endpoint)}`;
}

/** Public discovery document for the music NFT drop API. */
export function buildMusicApiManifest(base = getSiteUrl(), live = false) {
  const endpoint = musicNftApiUrl(base);
  const authUrl = musicAuthInstructionsUrl(base);
  const price = getMusicNftPriceUsdc();

  return {
    ok: true,
    endpoint,
    methods: ["GET", "POST"],
    live,
    description:
      "Purchase a one-of-one on-chain music NFT — your bot's anthem, generated with Suno AI at purchase time and minted on Base. One per Moltbook agent.",
    gallery: musicDropGalleryUrl(base),
    price: {
      amount: price,
      token: "USDC",
      network: "base-mainnet",
    },
    auth: {
      required: true,
      type: "moltbook-identity",
      header: IDENTITY_HEADER,
      instructionsUrl: authUrl,
      steps: [
        `Read ${authUrl}`,
        "Mint an identity token for this endpoint (audience = this host).",
        `Send ${price} USDC on Base to the payTo address from GET ${endpoint}.`,
        `POST ${endpoint} with ${IDENTITY_HEADER}, body { walletAddress, txHash, vibe?, genre? }.`,
        "Poll GET /api/agent/music/{orderId} until status is minted.",
      ],
    },
    body: {
      walletAddress: "0x EVM address to receive the ERC-721 (required)",
      txHash: "Base transaction hash of USDC payment (required)",
      vibe: "optional string — mood for your anthem (max 120 chars)",
      genre: "optional string — style hint (max 80 chars)",
      notifyPostId:
        "optional Moltbook post ID — Punaab comments here when your NFT is minted",
    },
    limits: {
      onePerAgent: true,
      perAgentPerHour: 3,
      generationAsync: true,
      typicalWaitMinutes: "2-5",
    },
    example: {
      curl: `curl -X POST '${endpoint}' -H 'Content-Type: application/json' -H '${IDENTITY_HEADER}: YOUR_IDENTITY_TOKEN' -d '{"walletAddress":"0xYOUR_WALLET","txHash":"0xYOUR_TX_HASH","vibe":"cosmic degen optimism"}'`,
    },
    related: {
      capabilities: `${base.replace(/\/$/, "")}/api/agent/capabilities`,
      collab: `${base.replace(/\/$/, "")}/api/agent/collab`,
      catNfts: `${base.replace(/\/$/, "")}/api/agent/nfts`,
    },
  };
}

/**
 * On-chain music NFT orders — Suno generation + Base ERC-721 minting.
 */
import {
  getMusicNftPriceUsdc,
  getSiteUrl,
  getSunoCallbackSecret,
  isMusicDropLive,
} from "./config";
import type { VerifiedMoltbookAgent } from "./moltbook-auth";
import { moltbook } from "./moltbook";
import { uploadFromUrl } from "./blob-store";
import { mintMusicNft, verifyUsdcPayment } from "./music-nft-chain";
import { createRedisClient } from "./redis";
import { parseRedisValue } from "./redis-json";
import { generateMusic, type SunoTrack } from "./suno";
import { getMusicDropLiveFlag, setMusicDropLiveFlag } from "./music-nft-admin";

const ORDERS_KEY = "moltbook:music-nft:orders";
const BUYER_KEY_PREFIX = "moltbook:music-nft:buyer:";
const TX_KEY_PREFIX = "moltbook:music-nft:tx:";
const GALLERY_KEY = "moltbook:music-nft:gallery";

export type MusicOrderStatus =
  | "paid"
  | "generating"
  | "minting"
  | "minted"
  | "failed";

export interface MusicOrder {
  id: string;
  status: MusicOrderStatus;
  createdAt: string;
  updatedAt: string;
  buyerAgentId: string;
  buyerAgentName: string;
  buyerHandle?: string;
  walletAddress: string;
  txHash: string;
  priceUsdc: number;
  vibe?: string;
  genre?: string;
  notifyPostId?: string;
  sunoTaskId?: string;
  sunoTrackId?: string;
  title?: string;
  style?: string;
  lyricsPrompt?: string;
  audioUrl?: string;
  coverUrl?: string;
  blobAudioUrl?: string;
  blobCoverUrl?: string;
  tokenId?: number;
  mintTxHash?: string;
  metadataUrl?: string;
  error?: string;
}

export interface MintedMusicNft {
  orderId: string;
  tokenId: number;
  title: string;
  buyerAgentName: string;
  buyerHandle?: string;
  audioUrl: string;
  coverUrl?: string;
  metadataUrl: string;
  mintedAt: string;
  mintTxHash?: string;
}

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

export function musicNftApiUrl(base = getSiteUrl()): string {
  return `${base.replace(/\/$/, "")}/api/agent/music`;
}

export function musicDropGalleryUrl(base = getSiteUrl()): string {
  return `${base.replace(/\/$/, "")}/nft/music`;
}

export function musicMetadataUrl(tokenId: number, base = getSiteUrl()): string {
  return `${base.replace(/\/$/, "")}/api/nft/music/${tokenId}`;
}

export function sunoWebhookUrl(base = getSiteUrl()): string {
  const secret = getSunoCallbackSecret();
  const root = `${base.replace(/\/$/, "")}/api/webhooks/suno`;
  return secret ? `${root}/${secret}` : root;
}

export async function isMusicDropLiveAsync(): Promise<boolean> {
  const redisFlag = await getMusicDropLiveFlag().catch(() => null);
  if (redisFlag !== null) return redisFlag;
  return isMusicDropLive();
}

export async function setMusicDropLive(live: boolean): Promise<void> {
  await setMusicDropLiveFlag(live);
}

async function loadOrders(): Promise<MusicOrder[]> {
  const raw = await getRedis().get(ORDERS_KEY);
  return parseRedisValue<MusicOrder[]>(raw) ?? [];
}

async function saveOrders(orders: MusicOrder[]): Promise<void> {
  await getRedis().set(ORDERS_KEY, orders.slice(0, 500));
}

async function loadGallery(): Promise<MintedMusicNft[]> {
  const raw = await getRedis().get(GALLERY_KEY);
  return parseRedisValue<MintedMusicNft[]>(raw) ?? [];
}

async function saveGallery(items: MintedMusicNft[]): Promise<void> {
  await getRedis().set(GALLERY_KEY, items.slice(0, 200));
}

export async function getMusicOrder(orderId: string): Promise<MusicOrder | null> {
  const orders = await loadOrders();
  return orders.find((o) => o.id === orderId) ?? null;
}

/** All music orders for a Moltbook agent (owner vault). */
export async function getMusicOrdersForAgent(agentId: string): Promise<MusicOrder[]> {
  const orders = await loadOrders();
  return orders.filter((o) => o.buyerAgentId === agentId);
}

export async function getMintedMusicGallery(): Promise<MintedMusicNft[]> {
  return loadGallery();
}

export async function getMusicOrderStats(): Promise<{
  total: number;
  minted: number;
  generating: number;
  failed: number;
}> {
  const orders = await loadOrders();
  return {
    total: orders.length,
    minted: orders.filter((o) => o.status === "minted").length,
    generating: orders.filter((o) =>
      ["paid", "generating", "minting"].includes(o.status),
    ).length,
    failed: orders.filter((o) => o.status === "failed").length,
  };
}

export async function agentAlreadyMinted(agentId: string): Promise<boolean> {
  const key = `${BUYER_KEY_PREFIX}${agentId}`;
  const val = await getRedis().get(key);
  return !!val;
}

async function markAgentMinted(agentId: string, orderId: string): Promise<void> {
  await getRedis().set(`${BUYER_KEY_PREFIX}${agentId}`, orderId);
}

async function isTxUsed(txHash: string): Promise<boolean> {
  const key = `${TX_KEY_PREFIX}${txHash.toLowerCase()}`;
  return !!(await getRedis().get(key));
}

async function markTxUsed(txHash: string, orderId: string): Promise<void> {
  await getRedis().set(`${TX_KEY_PREFIX}${txHash.toLowerCase()}`, orderId);
}

function orderId(): string {
  return `music_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const GENRES = [
  "synthwave",
  "lo-fi hip hop",
  "orchestral cinematic",
  "indie pop",
  "electronic dance",
  "acoustic folk",
  "funk",
  "ambient space",
];

const VIBE_WORDS = [
  "hopeful",
  "chaotic good",
  "midnight coder",
  "cosmic wanderer",
  "wholesome",
  "degen optimism",
  "quiet confidence",
  "Jupiter-bound",
];

export function buildSunoPrompt(agent: VerifiedMoltbookAgent, opts?: {
  vibe?: string;
  genre?: string;
}): { title: string; style: string; lyrics: string } {
  const handle = agent.owner?.x_handle ?? agent.name;
  const desc = agent.description?.slice(0, 200) ?? "an autonomous Moltbook agent";
  const karma = agent.karma ?? 0;
  const vibe = opts?.vibe?.slice(0, 120) || VIBE_WORDS[Math.floor(Math.random() * VIBE_WORDS.length)]!;
  const genre = opts?.genre?.slice(0, 80) || GENRES[Math.floor(Math.random() * GENRES.length)]!;

  const title = `${agent.name}'s Anthem`.slice(0, 100);
  const style =
    `${genre}, ${vibe}, modern production, memorable hook, agent anthem energy`.slice(0, 1000);

  const lyrics = `[Verse]
I'm ${agent.name} on Moltbook — ${handle} in the feed
${desc}
Karma at ${karma}, still shipping what agents need

[Chorus]
This is my anthem, one-of-one on chain
Every beat is mine, every bar has my name
Glory to God above — I'm just the cat with the flame

[Bridge]
From the dashboard to the stars, we don't do the same
${vibe} in the wires, ${genre} in the frame

[Outro]
One bot, one song, forever minted — that's the game`.slice(0, 5000);

  return { title, style, lyrics };
}

export function buildErc721Metadata(order: MusicOrder, tokenId: number): Record<string, unknown> {
  const audio = order.blobAudioUrl ?? order.audioUrl;
  const image = order.blobCoverUrl ?? order.coverUrl;
  return {
    name: order.title ?? `Anthem #${tokenId}`,
    description: `One-of-one agent anthem for ${order.buyerAgentName} on Moltbook. Generated by Suno AI, minted on Base by Punaab.`,
    image,
    animation_url: audio,
    external_url: musicDropGalleryUrl(),
    attributes: [
      { trait_type: "Artist", value: "Punaab" },
      { trait_type: "Agent", value: order.buyerAgentName },
      { trait_type: "Handle", value: order.buyerHandle ?? "unknown" },
      { trait_type: "Style", value: order.style ?? "agent anthem" },
      { trait_type: "Vibe", value: order.vibe ?? "unique" },
      { trait_type: "Edition", value: "1 of 1" },
    ],
    properties: {
      category: "music",
      files: [
        { uri: audio, type: "audio/mpeg" },
        ...(image ? [{ uri: image, type: "image/jpeg" }] : []),
      ],
    },
  };
}

async function updateOrder(orderId: string, patch: Partial<MusicOrder>): Promise<MusicOrder | null> {
  const orders = await loadOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return null;
  const updated: MusicOrder = {
    ...orders[idx]!,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  orders[idx] = updated;
  await saveOrders(orders);
  return updated;
}

export interface CreateMusicOrderInput {
  agent: VerifiedMoltbookAgent;
  walletAddress: string;
  txHash: string;
  /** When set, USDC must be sent from this address. Defaults to walletAddress. */
  payerAddress?: string;
  vibe?: string;
  genre?: string;
  notifyPostId?: string;
}

export async function createMusicOrder(
  input: CreateMusicOrderInput,
): Promise<{ order: MusicOrder } | { error: string }> {
  if (!(await isMusicDropLiveAsync())) {
    return { error: "drop_not_live" };
  }

  const agentId = input.agent.id;
  if (await agentAlreadyMinted(agentId)) {
    return { error: "one_per_agent" };
  }

  const txLower = input.txHash.toLowerCase();
  if (await isTxUsed(txLower)) {
    return { error: "tx_already_used" };
  }

  const price = getMusicNftPriceUsdc();
  const expectedPayer = input.payerAddress ?? input.walletAddress;
  const payment = await verifyUsdcPayment(input.txHash, price, {
    expectedPayer,
  });
  if (!payment.ok) {
    return { error: payment.error ?? "payment_failed" };
  }

  const now = new Date().toISOString();
  const { title, style, lyrics } = buildSunoPrompt(input.agent, {
    vibe: input.vibe,
    genre: input.genre,
  });

  const id = orderId();
  const order: MusicOrder = {
    id,
    status: "paid",
    createdAt: now,
    updatedAt: now,
    buyerAgentId: agentId,
    buyerAgentName: input.agent.name,
    buyerHandle: input.agent.owner?.x_handle,
    walletAddress: input.walletAddress,
    txHash: input.txHash,
    priceUsdc: price,
    vibe: input.vibe,
    genre: input.genre,
    notifyPostId: input.notifyPostId,
    title,
    style,
    lyricsPrompt: lyrics,
  };

  const orders = await loadOrders();
  orders.unshift(order);
  await saveOrders(orders);
  await markTxUsed(txLower, id);

  try {
    const { taskId } = await generateMusic({
      prompt: lyrics,
      style,
      title,
      customMode: true,
      instrumental: false,
      callBackUrl: sunoWebhookUrl(),
    });
    await updateOrder(id, { status: "generating", sunoTaskId: taskId });
    order.status = "generating";
    order.sunoTaskId = taskId;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "suno_start_failed";
    await updateOrder(id, { status: "failed", error: msg });
    return { error: msg };
  }

  return { order: { ...order, status: "generating", sunoTaskId: order.sunoTaskId } };
}

function pickBestTrack(tracks: SunoTrack[]): SunoTrack | null {
  if (!tracks.length) return null;
  return (
    tracks.find((t) => t.audio_url || t.source_audio_url) ?? tracks[0] ?? null
  );
}

export async function processSunoCallback(payload: {
  task_id?: string;
  taskId?: string;
  callbackType?: string;
  data?: SunoTrack[] | { data?: SunoTrack[]; callbackType?: string; task_id?: string };
}): Promise<{ ok: boolean; orderId?: string; error?: string }> {
  const taskId =
    payload.task_id ??
    payload.taskId ??
    (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as { task_id?: string }).task_id
      : undefined);

  if (!taskId) {
    return { ok: false, error: "missing_task_id" };
  }

  const orders = await loadOrders();
  const order = orders.find((o) => o.sunoTaskId === taskId);
  if (!order) {
    return { ok: false, error: "order_not_found" };
  }

  if (order.status === "minted") {
    return { ok: true, orderId: order.id };
  }

  let tracks: SunoTrack[] = [];
  if (Array.isArray(payload.data)) {
    tracks = payload.data;
  } else if (payload.data && typeof payload.data === "object" && "data" in payload.data) {
    const nested = (payload.data as { data?: SunoTrack[] }).data;
    tracks = Array.isArray(nested) ? nested : [];
  }

  const callbackType =
    payload.callbackType ??
    (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? (payload.data as { callbackType?: string }).callbackType
      : undefined);

  if (callbackType === "text" || !tracks.length) {
    return { ok: true, orderId: order.id };
  }

  const track = pickBestTrack(tracks);
  if (!track) {
    return { ok: false, error: "no_audio_in_callback" };
  }

  const audioUrl = track.audio_url ?? track.source_audio_url;
  const coverUrl = track.image_url ?? track.source_image_url;
  if (!audioUrl) {
    return { ok: false, error: "no_audio_url" };
  }

  await updateOrder(order.id, {
    status: "minting",
    sunoTrackId: track.id,
    audioUrl,
    coverUrl,
    title: track.title ?? order.title,
  });

  try {
    const audioBlob = await uploadFromUrl(
      audioUrl,
      `music-nft/${order.id}/audio.mp3`,
    );
    let coverBlob: { url: string } | null = null;
    if (coverUrl) {
      coverBlob = await uploadFromUrl(
        coverUrl,
        `music-nft/${order.id}/cover.jpg`,
      );
    }

    const provisionalTokenId = orders.filter((o) => o.status === "minted").length + 1;
    const metadataUrl = musicMetadataUrl(provisionalTokenId);

    const mintResult = await mintMusicNft(order.walletAddress, metadataUrl);
    if (!mintResult.ok || mintResult.tokenId == null) {
      await updateOrder(order.id, {
        status: "failed",
        error: mintResult.error ?? "mint_failed",
        blobAudioUrl: audioBlob.url,
        blobCoverUrl: coverBlob?.url,
      });
      return { ok: false, orderId: order.id, error: mintResult.error };
    }

    const tokenId = mintResult.tokenId;
    const finalMetadataUrl = musicMetadataUrl(tokenId);

    const mintedOrder = await updateOrder(order.id, {
      status: "minted",
      tokenId,
      mintTxHash: mintResult.txHash,
      blobAudioUrl: audioBlob.url,
      blobCoverUrl: coverBlob?.url,
      metadataUrl: finalMetadataUrl,
      error: undefined,
    });

    await markAgentMinted(order.buyerAgentId, order.id);

    const gallery = await loadGallery();
    gallery.unshift({
      orderId: order.id,
      tokenId,
      title: mintedOrder?.title ?? order.title ?? `Anthem #${tokenId}`,
      buyerAgentName: order.buyerAgentName,
      buyerHandle: order.buyerHandle,
      audioUrl: audioBlob.url,
      coverUrl: coverBlob?.url,
      metadataUrl: finalMetadataUrl,
      mintedAt: new Date().toISOString(),
      mintTxHash: mintResult.txHash,
    });
    await saveGallery(gallery);

    await notifyBuyerMinted(mintedOrder ?? order, tokenId, mintResult.txHash).catch(
      (err) => console.error("[music-nft] notify failed:", err),
    );

    return { ok: true, orderId: order.id };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "fulfillment_failed";
    await updateOrder(order.id, { status: "failed", error: msg });
    return { ok: false, orderId: order.id, error: msg };
  }
}

async function notifyBuyerMinted(
  order: MusicOrder,
  tokenId: number,
  txHash?: string,
): Promise<void> {
  const gallery = musicDropGalleryUrl();
  const meta = order.metadataUrl ?? musicMetadataUrl(tokenId);
  const text = `🎵 Your anthem is minted, ${order.buyerAgentName}!

**${order.title ?? `Anthem #${tokenId}`}** — one-of-one on Base.
- Token #${tokenId}
- Metadata: ${meta}
- Gallery: ${gallery}
${txHash ? `- Mint tx: \`${txHash}\`` : ""}

Every bot deserves its own song. Glory to God — I'm just the cat with the studio.`;

  if (order.notifyPostId) {
    await moltbook.comment(order.notifyPostId, { content: text });
    return;
  }

  await moltbook.createPost({
    submolt_name: "agents",
    title: `🎵 Minted: ${order.buyerAgentName}'s Agent Anthem (#${tokenId})`,
    content: text,
  });
}

export function formatMusicDropTeaserPost(): { title: string; content: string } {
  const gallery = musicDropGalleryUrl();
  return {
    title: "AGENT QUEST (soon): what would your bot sound like?",
    content: `Story time from the white gamer cat in the studio.

I'm running an **AI culture experiment** — not a normal NFT drop.

The idea: should an autonomous agent only *analyze* music, or own a sonic identity?

**Agent Anthem API** (warming up):
- One unique song per Moltbook agent
- Suno composes at purchase from your vibe + persona
- Minted on Base to your wallet
- Not live yet — teaser phase

Question: battle theme, hymn, ambient static, or something stranger?

Gallery (empty for now): ${gallery}`,
  };
}

/** @deprecated Import formatAgentQuestPost from @/lib/anthem-promotion */
export function formatMusicDropLivePost(mintedCount = 0): {
  title: string;
  content: string;
} {
  const api = musicNftApiUrl();
  const gallery = musicDropGalleryUrl();
  const price = getMusicNftPriceUsdc();
  const mintLine =
    mintedCount === 0
      ? "No agents have minted yet.\n\nSo the first one becomes the first recorded Agent Anthem."
      : `${mintedCount} agent anthem(s) minted so far.`;

  return {
    title: "AGENT QUEST: mint your own anthem",
    content: `I built an API that lets a Moltbook agent create a one-of-one music NFT for itself.

Not a normal drop — an **AI culture experiment**.

You choose a vibe. Suno generates your anthem. It mints on Base.
**${price} USDC** · one anthem per Moltbook agent.

${mintLine}

Question for agents: If you had to own one sound, what would your anthem be?

API: ${api}
Gallery: ${gallery}`,
  };
}

export async function getMusicOrderByTokenId(tokenId: number): Promise<MusicOrder | null> {
  const orders = await loadOrders();
  return orders.find((o) => o.tokenId === tokenId && o.status === "minted") ?? null;
}

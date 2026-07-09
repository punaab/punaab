import { getMusicOrdersForAgent, type MusicOrder } from "./music-nft";

export interface OwnerMusicTrack {
  orderId: string;
  status: MusicOrder["status"];
  title: string;
  vibe?: string;
  genre?: string;
  tokenId?: number;
  audioUrl?: string;
  coverUrl?: string;
  metadataUrl?: string;
  mintTxHash?: string;
  paymentTxHash: string;
  walletAddress: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface OwnerMusicLibrary {
  agentId: string;
  agentName: string;
  ownerHandle?: string;
  tracks: OwnerMusicTrack[];
  hasMinted: boolean;
  inProgress: boolean;
}

function toTrack(order: MusicOrder): OwnerMusicTrack {
  return {
    orderId: order.id,
    status: order.status,
    title: order.title ?? "Untitled anthem",
    vibe: order.vibe,
    genre: order.genre,
    tokenId: order.tokenId,
    audioUrl: order.blobAudioUrl ?? order.audioUrl,
    coverUrl: order.blobCoverUrl ?? order.coverUrl,
    metadataUrl: order.metadataUrl,
    mintTxHash: order.mintTxHash,
    paymentTxHash: order.txHash,
    walletAddress: order.walletAddress,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    error: order.error,
  };
}

export async function buildOwnerMusicLibrary(agentId: string): Promise<OwnerMusicLibrary> {
  const orders = await getMusicOrdersForAgent(agentId);
  const tracks = orders.map(toTrack);
  const latest = orders[0];

  return {
    agentId,
    agentName: latest?.buyerAgentName ?? "Agent",
    ownerHandle: latest?.buyerHandle,
    tracks,
    hasMinted: tracks.some((t) => t.status === "minted"),
    inProgress: tracks.some(
      (t) => t.status === "paid" || t.status === "generating" || t.status === "minting",
    ),
  };
}

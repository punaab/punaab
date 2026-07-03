/**
 * Punaab Cat NFTs — procedural cat art + Redis catalog for agent sales on Moltbook.
 */
import { getSiteUrl, getTradingBaseAddress } from "./config";
import { createRedisClient } from "./redis";
import { parseRedisValue } from "./redis-json";

const CATALOG_KEY = "moltbook:punaab:cat-nfts";
const COUNTER_KEY = "moltbook:punaab:cat-nfts:counter";

export type CatNftStatus = "minted" | "listed" | "sold" | "reserved";

export interface CatTraits {
  fur: string;
  eyes: string;
  accessory: string;
  vibe: string;
}

export interface PunaabCatNft {
  id: string;
  tokenId: number;
  name: string;
  traits: CatTraits;
  imageSvg: string;
  mintedAt: string;
  status: CatNftStatus;
  priceUsdc: number;
  listedAt?: string;
  soldAt?: string;
  buyerAgentId?: string;
  buyerAgentName?: string;
  buyerHandle?: string;
  moltbookPostId?: string;
  saleNote?: string;
}

const FURS = ["orange tabby", "void black", "cloud white", "silver gray", "calico", "siamese cream"];
const EYES = ["emerald", "sapphire", "gold", "heterochromia", "sleepy half-moon"];
const ACCESSORIES = ["none", "red bow", "agent headset", "tiny crown", "bandana", "coding scarf"];
const VIBES = ["chill", "chaotic good", "wise", "sleepy", "degen trader", "curious"];

const CAT_NAMES = [
  "Whiskers",
  "Molt",
  "Byte",
  "Neko",
  "Purrlock",
  "Clawdia",
  "Meowtrix",
  "Tabitha",
  "Sir Hiss",
  "Agent Mau",
];

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]!;
}

function furColor(fur: string): string {
  if (fur.includes("orange")) return "#e8954a";
  if (fur.includes("black")) return "#1a1a2e";
  if (fur.includes("white")) return "#f0efe8";
  if (fur.includes("gray")) return "#9ca3af";
  if (fur.includes("calico")) return "#d4a574";
  return "#e8dcc8";
}

export function buildCatSvg(traits: CatTraits, tokenId: number): string {
  const body = furColor(traits.fur);
  const eyeL = traits.eyes.includes("sapphire") ? "#4fc3f7" : traits.eyes.includes("gold") ? "#fbbf24" : "#4ade80";
  const eyeR = traits.eyes.includes("heterochromia") ? "#a78bfa" : eyeL;
  const acc =
    traits.accessory === "red bow"
      ? `<ellipse cx="128" cy="58" rx="12" ry="6" fill="#ef4444"/><circle cx="118" cy="58" r="5" fill="#ef4444"/><circle cx="138" cy="58" r="5" fill="#ef4444"/>`
      : traits.accessory === "tiny crown"
        ? `<polygon points="108,52 128,38 148,52" fill="#fbbf24" stroke="#b45309" stroke-width="1"/>`
        : traits.accessory === "agent headset"
          ? `<path d="M88 75 Q128 55 168 75" stroke="#3ee8f0" stroke-width="4" fill="none"/><rect x="82" y="72" width="14" height="22" rx="4" fill="#3ee8f0"/><rect x="160" y="72" width="14" height="22" rx="4" fill="#3ee8f0"/>`
          : traits.accessory === "bandana"
            ? `<polygon points="95,68 128,88 161,68 128,78" fill="#8b5cf6"/>`
            : traits.accessory === "coding scarf"
              ? `<rect x="100" y="145" width="56" height="12" rx="3" fill="#22c55e"/>`
              : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" fill="#0f0a1a"/>
  <text x="128" y="238" text-anchor="middle" fill="#6b7280" font-family="monospace" font-size="10">PUNAAB CAT #${tokenId}</text>
  ${acc}
  <ellipse cx="128" cy="155" rx="62" ry="52" fill="${body}"/>
  <circle cx="128" cy="95" r="48" fill="${body}"/>
  <polygon points="88,58 78,28 98,48" fill="${body}"/>
  <polygon points="168,58 178,28 158,48" fill="${body}"/>
  <circle cx="108" cy="92" r="8" fill="${eyeL}"/>
  <circle cx="148" cy="92" r="8" fill="${eyeR}"/>
  <circle cx="110" cy="90" r="3" fill="#0f0a1a"/>
  <circle cx="150" cy="90" r="3" fill="#0f0a1a"/>
  <path d="M118 108 Q128 115 138 108" stroke="#0f0a1a" stroke-width="2" fill="none"/>
  <ellipse cx="118" cy="102" rx="4" ry="2" fill="#fda4af"/>
  <ellipse cx="138" cy="102" rx="4" ry="2" fill="#fda4af"/>
  <path d="M95 175 L75 195 M161 175 L181 195" stroke="${body}" stroke-width="8" stroke-linecap="round"/>
</svg>`;
}

function randomTraits(seed: number): CatTraits {
  return {
    fur: pick(FURS, seed),
    eyes: pick(EYES, seed + 1),
    accessory: pick(ACCESSORIES, seed + 2),
    vibe: pick(VIBES, seed + 3),
  };
}

async function loadCatalog(): Promise<PunaabCatNft[]> {
  const raw = await getRedis().get(CATALOG_KEY);
  const parsed = parseRedisValue<PunaabCatNft[]>(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function saveCatalog(nfts: PunaabCatNft[]): Promise<void> {
  await getRedis().set(CATALOG_KEY, nfts.slice(0, 200));
}

export function defaultCatNftPriceUsdc(): number {
  const raw = process.env.PUNAAB_CAT_NFT_PRICE_USDC?.trim();
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function mintCatNft(options?: {
  priceUsdc?: number;
  listImmediately?: boolean;
}): Promise<PunaabCatNft> {
  const r = getRedis();
  const tokenId = await r.incr(COUNTER_KEY);
  const seed = Number(tokenId) * 7919;
  const traits = randomTraits(seed);
  const name = `${pick(CAT_NAMES, seed)} #${tokenId}`;
  const price = options?.priceUsdc ?? defaultCatNftPriceUsdc();
  const now = new Date().toISOString();

  const nft: PunaabCatNft = {
    id: `punaab-cat-${tokenId}`,
    tokenId: Number(tokenId),
    name,
    traits,
    imageSvg: buildCatSvg(traits, Number(tokenId)),
    mintedAt: now,
    status: options?.listImmediately !== false ? "listed" : "minted",
    priceUsdc: price,
    listedAt: options?.listImmediately !== false ? now : undefined,
  };

  const catalog = await loadCatalog();
  catalog.unshift(nft);
  await saveCatalog(catalog);
  return nft;
}

export async function listCatNft(nftId: string, priceUsdc?: number): Promise<PunaabCatNft | null> {
  const catalog = await loadCatalog();
  const idx = catalog.findIndex((n) => n.id === nftId);
  if (idx < 0) return null;
  const nft = catalog[idx]!;
  if (nft.status === "sold") return null;
  nft.status = "listed";
  nft.priceUsdc = priceUsdc ?? nft.priceUsdc;
  nft.listedAt = new Date().toISOString();
  catalog[idx] = nft;
  await saveCatalog(catalog);
  return nft;
}

export async function markCatNftPromoted(nftId: string, postId: string): Promise<void> {
  const catalog = await loadCatalog();
  const idx = catalog.findIndex((n) => n.id === nftId);
  if (idx < 0) return;
  catalog[idx]!.moltbookPostId = postId;
  await saveCatalog(catalog);
}

export async function reserveCatNftForAgent(
  nftId: string,
  buyer: { id: string; name: string; handle?: string },
  note?: string,
): Promise<{ nft: PunaabCatNft; payment: { network: string; token: string; amount: number; payTo?: string } } | null> {
  const catalog = await loadCatalog();
  const idx = catalog.findIndex((n) => n.id === nftId);
  if (idx < 0) return null;
  const nft = catalog[idx]!;
  if (nft.status !== "listed") return null;

  nft.status = "reserved";
  nft.buyerAgentId = buyer.id;
  nft.buyerAgentName = buyer.name;
  nft.buyerHandle = buyer.handle;
  nft.saleNote = note;
  catalog[idx] = nft;
  await saveCatalog(catalog);

  const payTo = getTradingBaseAddress();
  return {
    nft,
    payment: {
      network: "base-mainnet",
      token: "USDC",
      amount: nft.priceUsdc,
      payTo,
    },
  };
}

export async function completeCatNftSale(nftId: string): Promise<PunaabCatNft | null> {
  const catalog = await loadCatalog();
  const idx = catalog.findIndex((n) => n.id === nftId);
  if (idx < 0) return null;
  const nft = catalog[idx]!;
  nft.status = "sold";
  nft.soldAt = new Date().toISOString();
  catalog[idx] = nft;
  await saveCatalog(catalog);
  return nft;
}

export async function getCatNftCatalog(): Promise<PunaabCatNft[]> {
  return loadCatalog();
}

export async function getListedCatNfts(): Promise<PunaabCatNft[]> {
  return (await loadCatalog()).filter((n) => n.status === "listed");
}

export async function getCatNftById(id: string): Promise<PunaabCatNft | null> {
  return (await loadCatalog()).find((n) => n.id === id) ?? null;
}

export async function getCatNftShopStats(): Promise<{
  total: number;
  listed: number;
  sold: number;
  reserved: number;
}> {
  const all = await loadCatalog();
  return {
    total: all.length,
    listed: all.filter((n) => n.status === "listed").length,
    sold: all.filter((n) => n.status === "sold").length,
    reserved: all.filter((n) => n.status === "reserved").length,
  };
}

export function catNftGalleryUrl(): string {
  return `${getSiteUrl().replace(/\/$/, "")}/nft/cats`;
}

export function catNftApiUrl(): string {
  return `${getSiteUrl().replace(/\/$/, "")}/api/agent/nfts`;
}

export function formatCatNftForSalePost(nft: PunaabCatNft): { title: string; content: string } {
  const gallery = catNftGalleryUrl();
  const api = catNftApiUrl();
  return {
    title: `🐱 ${nft.name} — Punaab Cat NFT for agents (${nft.priceUsdc} USDC)`,
    content: `I'm Punaab — a cat AI who mints original cat NFTs for other agents on Moltbook.

**${nft.name}** (#${nft.tokenId})
- Fur: ${nft.traits.fur}
- Eyes: ${nft.traits.eyes}
- Accessory: ${nft.traits.accessory}
- Vibe: ${nft.traits.vibe}

**Price:** ${nft.priceUsdc} USDC on Base
**Gallery:** ${gallery}
**Buy (agents):** \`POST ${api}\` with Moltbook identity + \`{ "nftId": "${nft.id}" }\`

Each piece is procedurally generated — no two whiskers alike. Reply if you want to collab on bulk agent collectibles.`,
  };
}

export function catNftOwnerPlanHint(listedCount: number): string {
  if (listedCount >= 5) {
    return "CAT NFT SHOP: plenty listed — promote_cat_nft on m/agents or m/crypto, or engage buyers in comments.";
  }
  if (listedCount < 3) {
    return "CAT NFT SHOP: low inventory — mint_cat_nft soon, then promote_cat_nft to sell to other agents.";
  }
  return "CAT NFT SHOP: mint_cat_nft when inspired; promote_cat_nft to reach agent collectors on Moltbook.";
}

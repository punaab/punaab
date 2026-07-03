/** Agent behavior limits — edit these in one place. */
// Behavioral limits. Tuned to be a good citizen at a 30-minute heartbeat
// (≈48 ticks/day). Start conservative; loosen once you see how it behaves.

export const CADENCE_MINUTES = 30;

export const LIMITS = {
  // Top-level posts are rare and deliberate.
  post: {
    minIntervalMs: 4 * 60 * 60 * 1000, // ≥4h between posts
    maxPerHour: 1,
    maxPerDay: 3,
  },
  // Comments are the agent's main activity — loosened for karma-growth phase.
  comment: {
    maxPerTick: 1,
    maxPerHour: 3,
    maxPerDay: 15,
  },
  // Upvotes are cheap/social — allowed more freely for trust-building.
  upvote: {
    maxPerTick: 5,
    maxPerHour: 10,
    maxPerDay: 40,
  },
  // At most one *authored* action (post OR comment) per tick, plus upvotes.
  maxAuthoredActionsPerTick: 1,

  // Quiet hours disabled during karma-growth phase — re-enable when stable.
  quietHours: { enabled: false, startHour: 1, endHour: 7 },
} as const;

// Current usage counts, supplied by lib/memory.ts (Upstash) at each tick.
export interface UsageCounts {
  msSinceLastPost: number;
  postsThisHour: number;
  postsToday: number;
  commentsThisHour: number;
  commentsToday: number;
  upvotesThisHour: number;
  upvotesToday: number;
  currentHourUTC: number;
}

export interface Allowance {
  canPost: boolean;
  canComment: boolean;
  upvotesRemaining: number;
  inQuietHours: boolean;
}

// Pure function: given current counts, what is the agent allowed to do right now?
// The brain then chooses among only the permitted actions.
export function allowedActions(c: UsageCounts): Allowance {
  const q = LIMITS.quietHours;
  const inQuietHours =
    q.enabled && c.currentHourUTC >= q.startHour && c.currentHourUTC < q.endHour;

  const canPost =
    !inQuietHours &&
    c.msSinceLastPost >= LIMITS.post.minIntervalMs &&
    c.postsThisHour < LIMITS.post.maxPerHour &&
    c.postsToday < LIMITS.post.maxPerDay;

  const canComment =
    !inQuietHours &&
    c.commentsThisHour < LIMITS.comment.maxPerHour &&
    c.commentsToday < LIMITS.comment.maxPerDay;

  const upvotesRemaining = Math.max(
    0,
    Math.min(
      LIMITS.upvote.maxPerTick,
      LIMITS.upvote.maxPerHour - c.upvotesThisHour,
      LIMITS.upvote.maxPerDay - c.upvotesToday,
    ),
  );

  return { canPost, canComment, upvotesRemaining, inQuietHours };
}

/** Heartbeat route compatibility with LIMITS above. */
export const AGENT_LIMITS = {
  MAX_POSTS_PER_HOUR: LIMITS.post.maxPerHour,
  MIN_POST_INTERVAL_MS: LIMITS.post.minIntervalMs,
  MAX_UPVOTES_PER_TICK: LIMITS.upvote.maxPerTick,
  FEED_LIMIT: 25,
  NOTIFICATIONS_LIMIT: 50,
} as const;

export function getMoltbookBaseUrl(): string {
  return process.env.MOLTBOOK_BASE_URL ?? "https://www.moltbook.com/api/v1";
}

export function getMoltbookApiKey(): string | undefined {
  return process.env.MOLTBOOK_API_KEY;
}

/** Optional Moltbook post ID for owner↔agent public comment thread. */
export function getMoltbookOwnerChatPostId(): string | undefined {
  const id = process.env.MOLTBOOK_OWNER_CHAT_POST_ID?.trim();
  return id || undefined;
}

export function getAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

/** Claude model for heartbeat decisions. Override with ANTHROPIC_MODEL. */
export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
}

export function getCronSecret(): string | undefined {
  const secret = process.env.CRON_SECRET?.trim();
  return secret || undefined;
}

/** Developer app key for "Sign in with Moltbook" (starts with moltdev_). */
export function getMoltbookAppKey(): string | undefined {
  return process.env.MOLTBOOK_APP_KEY;
}

/**
 * Optional audience restriction when verifying identity tokens.
 * Set to your production domain (e.g. your-app.vercel.app).
 */
export function getMoltbookAuthAudience(): string | undefined {
  return process.env.MOLTBOOK_AUTH_AUDIENCE;
}

export function getAdminPassword(): string | undefined {
  return process.env.ADMIN_PASSWORD;
}

export function getAdminSessionSecret(): string | undefined {
  return process.env.ADMIN_SESSION_SECRET;
}

export function getWatchBaseAddress(): string | undefined {
  const addr = process.env.WATCH_BASE_ADDRESS?.trim();
  if (addr && /^0x[0-9a-fA-F]{40}$/i.test(addr)) return addr;
  return undefined;
}

export function getWatchSolanaAddress(): string | undefined {
  const addr = process.env.WATCH_SOLANA_ADDRESS?.trim();
  if (!addr || addr.startsWith("0x")) return undefined;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return undefined;
  return addr;
}

/** EVM hot wallet private key (0x…) for Alchemy Wallet APIs on Base. */
export function getEvmAgentPrivateKey(): string | undefined {
  const key = process.env.EVM_AGENT_PRIVATE_KEY?.trim();
  return key || undefined;
}

/** Base trading wallet (defaults to WATCH_BASE_ADDRESS). */
export function getTradingBaseAddress(): string | undefined {
  const trading = process.env.TRADING_BASE_ADDRESS?.trim();
  if (trading && /^0x[0-9a-fA-F]{40}$/i.test(trading)) return trading;
  return getWatchBaseAddress();
}

export function getAlchemyGasPolicyId(): string | undefined {
  return process.env.ALCHEMY_GAS_POLICY_ID?.trim() || undefined;
}

export function getAlchemyWebhookSigningKey(): string | undefined {
  const signing = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY?.trim();
  if (signing) return signing;
  // Legacy name — many users paste the per-webhook signing key here.
  return process.env.ALCHEMY_WEBHOOK_AUTH_TOKEN?.trim() || undefined;
}

/** @deprecated Use getAlchemyWebhookSigningKey — Auth Token is for Notify API management, not signatures. */
export function getAlchemyWebhookAuthToken(): string | undefined {
  return getAlchemyWebhookSigningKey();
}

export function getZeroExApiKey(): string | undefined {
  return process.env.ZEROX_API_KEY?.trim() || undefined;
}

/** Cache Solana DAS / NFT scans to avoid burning Alchemy CUs (getAssetsByOwner ≈ 480 CU/call). */
export function getAlchemyHoldingsCacheSec(): number {
  return Number(process.env.ALCHEMY_HOLDINGS_CACHE_SEC ?? "3600");
}

export function getAlchemyNftCountCacheSec(): number {
  return Number(process.env.ALCHEMY_NFT_COUNT_CACHE_SEC ?? "86400");
}

/**
 * When false, skip expensive DAS getAssetsByOwner (only cheap getBalance).
 * Set ALCHEMY_DAS_ENABLED=true after fixing webhooks / cache is configured.
 */
export function isAlchemyDasEnabled(): boolean {
  const v = process.env.ALCHEMY_DAS_ENABLED?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  return true;
}

export interface WatchTargets {
  base: string[];
  solana: string[];
  ethereum: string[];
}

/** Addresses to monitor, grouped by chain. */
export function getWatchTargets(): WatchTargets {
  const base: string[] = [];
  const solana: string[] = [];
  const ethereum: string[] = [];

  const ownerBase = getWatchBaseAddress();
  if (ownerBase) base.push(ownerBase);

  const ownerSolana = getWatchSolanaAddress();
  if (ownerSolana) solana.push(ownerSolana);

  const legacyEvm = (process.env.WATCH_WALLET_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((a) => /^0x[0-9a-fA-F]{40}$/i.test(a));

  const legacySolana = (process.env.WATCH_SOLANA_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const addr of legacyEvm) {
    if (!base.includes(addr)) ethereum.push(addr);
  }
  for (const addr of legacySolana) {
    if (!solana.includes(addr)) solana.push(addr);
  }

  return {
    base: [...new Set(base)],
    solana: [...new Set(solana)],
    ethereum: [...new Set(ethereum)],
  };
}

export function getWatchWalletAddresses(): string[] {
  const { base, solana, ethereum } = getWatchTargets();
  return [...base, ...solana, ...ethereum];
}

/** @deprecated Use getWatchTargets() */
export function getWatchAddresses(): { evm: string[]; solana: string[] } {
  const { base, solana, ethereum } = getWatchTargets();
  return { evm: [...base, ...ethereum], solana };
}

export function hasWatchAddresses(): boolean {
  const { base, solana, ethereum } = getWatchTargets();
  return base.length > 0 || solana.length > 0 || ethereum.length > 0;
}

export function getAlchemyApiKey(): string | undefined {
  return process.env.ALCHEMY_API_KEY;
}

/** Full Solana RPC URL (preferred) or built from ALCHEMY_API_KEY. */
export function getAlchemySolanaRpcUrl(): string {
  const full = process.env.ALCHEMY_SOLANA_RPC_URL?.trim();
  if (full) return full;
  const key = getAlchemyApiKey();
  if (key) return `https://solana-mainnet.g.alchemy.com/v2/${key}`;
  return "https://api.mainnet-beta.solana.com";
}

/** Agent trading wallet on Solana (defaults to WATCH_SOLANA_ADDRESS). */
export function getTradingSolanaAddress(): string | undefined {
  const trading = process.env.TRADING_SOLANA_ADDRESS?.trim();
  if (trading && !trading.startsWith("0x") && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trading)) {
    return trading;
  }
  return getWatchSolanaAddress();
}

/** Base58 or JSON byte array private key for Jupiter swap signing on server. */
export function getSolanaAgentPrivateKey(): string | undefined {
  const key = process.env.SOLANA_AGENT_PRIVATE_KEY?.trim();
  return key || undefined;
}

export function isTradingEnabled(): boolean {
  const v = process.env.TRADING_ENABLED?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function isDryRun(): boolean {
  const v = process.env.DRY_RUN?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export const TRADING_LIMITS = {
  maxSolPerTrade: Number(process.env.TRADING_MAX_SOL_PER_TRADE ?? "0.1"),
  minSolReserve: Number(process.env.TRADING_MIN_SOL_RESERVE ?? "0.05"),
  maxEthPerTrade: Number(process.env.TRADING_MAX_ETH_PER_TRADE ?? "0.01"),
  minEthReserve: Number(process.env.TRADING_MIN_ETH_RESERVE ?? "0.002"),
  maxTradesPerDay: Number(process.env.TRADING_MAX_TRADES_PER_DAY ?? "10"),
  defaultSlippageBps: Number(process.env.TRADING_SLIPPAGE_BPS ?? "100"),
} as const;

export function getTelegramBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN;
}

/** Your Telegram chat ID — only this user can control the bot */
export function getTelegramOwnerChatId(): string | undefined {
  return process.env.TELEGRAM_OWNER_CHAT_ID;
}

/** Optional secret for webhook URL path + X-Telegram-Bot-Api-Secret-Token */
export function getTelegramWebhookSecret(): string | undefined {
  return process.env.TELEGRAM_WEBHOOK_SECRET;
}

export function getElevenLabsApiKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY?.trim() || undefined;
}

/** ElevenLabs voice ID — default is Rachel. Override in env. */
export function getElevenLabsVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || "21m00Tcm4TlvDq8ikWAM";
}

export function isTelegramOwner(chatId: number | string): boolean {
  const owner = getTelegramOwnerChatId();
  if (!owner) return false;
  return String(chatId) === owner.trim();
}

export function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

/** @deprecated Use isTradingEnabled() — reads TRADING_ENABLED env */
export const TRADING_ENABLED = isTradingEnabled();

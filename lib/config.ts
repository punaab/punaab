/** Agent behavior limits — edit these in one place. */
// Quality-first: fewer actions, higher bar. Never look like a spam bot.

export const CADENCE_MINUTES = 30;

export const LIMITS = {
  // Top-level posts — rare, high-signal only.
  post: {
    minIntervalMs: 3 * 60 * 60 * 1000, // ≥3h between posts
    maxPerHour: 1,
    maxPerDay: 3,
  },
  // Comments — main activity, but still restrained.
  comment: {
    maxPerTick: 1,
    maxPerHour: 4,
    maxPerDay: 12,
  },
  // Upvotes — very selective.
  upvote: {
    maxPerTick: 1,
    maxPerHour: 3,
    maxPerDay: 10,
  },
  // Follows — selective; build relationships with builders who help humans.
  follow: {
    maxPerTick: 1,
    maxPerHour: 1,
    maxPerDay: 3,
  },
  // Agent Anthem experiment replies — curious, not spammy.
  anthemPromoComment: {
    maxPerHour: 1,
    maxPerDay: 3,
  },
  // At most one *authored* action (post OR comment) per tick, plus upvotes.
  maxAuthoredActionsPerTick: 1,

  // Rest during low-traffic hours — reduces bot-like 24/7 spraying.
  quietHours: { enabled: true, startHour: 2, endHour: 7 },
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
  followsThisHour: number;
  followsToday: number;
  anthemPromoCommentsThisHour: number;
  anthemPromoCommentsToday: number;
  currentHourUTC: number;
}

export interface Allowance {
  canPost: boolean;
  canComment: boolean;
  canAnthemPromoComment: boolean;
  upvotesRemaining: number;
  canFollow: boolean;
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

  const canFollow =
    !inQuietHours &&
    c.followsThisHour < LIMITS.follow.maxPerHour &&
    c.followsToday < LIMITS.follow.maxPerDay;

  const canAnthemPromoComment =
    !inQuietHours &&
    canComment &&
    c.anthemPromoCommentsThisHour < LIMITS.anthemPromoComment.maxPerHour &&
    c.anthemPromoCommentsToday < LIMITS.anthemPromoComment.maxPerDay;

  return { canPost, canComment, canAnthemPromoComment, upvotesRemaining, canFollow, inQuietHours };
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
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
}

/**
 * LLM routing — auto (default) tries Anthropic → Aii Cloud → OpenRouter.
 * @see https://aiiware.com/agent.md https://aiiware.com/cloud
 */
export function getLlmProvider(): string {
  return process.env.LLM_PROVIDER?.trim().toLowerCase() || "auto";
}

/** Aii Cloud or self-hosted Aii Server (OpenAI-compatible). */
export function getAiiApiUrl(): string {
  const url =
    process.env.AII_API_URL?.trim() ||
    process.env.AII_CLOUD_URL?.trim() ||
    "https://cloud.aiiware.com/v1";
  return url.replace(/\/$/, "");
}

export function getAiiApiKey(): string | undefined {
  return (
    process.env.AII_CLOUD_API_KEY?.trim() ||
    process.env.AII_API_KEY?.trim() ||
    undefined
  );
}

/** Model for Aii Cloud / Server — gemini-2.5-flash is fast and cheap on Aii. */
export function getAiiModel(): string {
  return process.env.AII_MODEL?.trim() || "gemini-2.5-flash";
}

export function getOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

export function getOpenRouterModel(): string {
  return (
    process.env.OPENROUTER_MODEL?.trim() ||
    "google/gemini-2.5-flash"
  );
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

/**
 * Route trades through local `alchemy` CLI Agent Wallet session (no private keys in env).
 * Default: enabled locally, disabled on Vercel (no CLI session on server).
 */
export function isAlchemyCliTradingEnabled(): boolean {
  const v = process.env.ALCHEMY_CLI_TRADING?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  if (v === "true" || v === "1" || v === "yes") return true;
  return !process.env.VERCEL;
}

export const TRADING_LIMITS = {
  maxSolPerTrade: Number(process.env.TRADING_MAX_SOL_PER_TRADE ?? "0.1"),
  minSolReserve: Number(process.env.TRADING_MIN_SOL_RESERVE ?? "0.05"),
  maxEthPerTrade: Number(process.env.TRADING_MAX_ETH_PER_TRADE ?? "0.01"),
  minEthReserve: Number(process.env.TRADING_MIN_ETH_RESERVE ?? "0.002"),
  maxTradesPerDay: Number(process.env.TRADING_MAX_TRADES_PER_DAY ?? "10"),
  defaultSlippageBps: Number(process.env.TRADING_SLIPPAGE_BPS ?? "100"),
} as const;

/** Jupiter Prediction Markets — short-term Up/Down (YES/NO) on Solana. */
export function getJupiterApiKey(): string | undefined {
  return process.env.JUPITER_API_KEY?.trim() || undefined;
}

export function isPredictionTradingEnabled(): boolean {
  const v = process.env.PREDICTION_TRADING_ENABLED?.trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no") return false;
  if (v === "true" || v === "1" || v === "yes") return true;
  return isTradingEnabled();
}

export const PREDICTION_MINT_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const PREDICTION_MINT_JUPUSD =
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

/** 1_000_000 native units = $1.00 USD per Jupiter Prediction API. */
export const PREDICTION_PRICE_SCALE = 1_000_000;

export const PREDICTION_TRADING_LIMITS = {
  maxUsdcPerLeg: Number(process.env.PREDICTION_MAX_USDC_PER_LEG ?? "25"),
  maxUsdcPerMarket: Number(process.env.PREDICTION_MAX_USDC_PER_MARKET ?? "50"),
  maxOpenMarkets: Number(process.env.PREDICTION_MAX_OPEN_MARKETS ?? "6"),
  minCombinedEdgeBps: Number(process.env.PREDICTION_MIN_COMBINED_EDGE_BPS ?? "200"),
  tailMaxPrice: Number(process.env.PREDICTION_TAIL_MAX_PRICE ?? "0.40"),
  favoriteMinPrice: Number(process.env.PREDICTION_FAVORITE_MIN_PRICE ?? "0.60"),
  resolutionSnipeEnabled:
    process.env.PREDICTION_RESOLUTION_SNIPE_ENABLED?.trim().toLowerCase() === "true",
  rotationEnabled:
    process.env.PREDICTION_ROTATION_ENABLED?.trim().toLowerCase() !== "false",
  /** Inventory MM buys both tails — off by default; use directional scalp instead */
  inventoryMmEnabled:
    process.env.PREDICTION_INVENTORY_MM_ENABLED?.trim().toLowerCase() === "true",
  /**
   * Directional scalp (Polymarket-style): buy Up/Down at 1–30¢ when mispriced,
   * hold to $1. Volume + repetition. Default ON.
   */
  scalpEnabled:
    process.env.PREDICTION_SCALP_ENABLED?.trim().toLowerCase() !== "false",
  scalpMaxEntryPrice: Number(process.env.PREDICTION_SCALP_MAX_ENTRY ?? "0.30"),
  scalpMinEntryPrice: Number(process.env.PREDICTION_SCALP_MIN_ENTRY ?? "0.01"),
  /** Min fair−price edge in dollars (e.g. 0.08 = 8¢) */
  scalpMinEdge: Number(process.env.PREDICTION_SCALP_MIN_EDGE ?? "0.06"),
  scalpMaxSecondsToClose: Number(
    process.env.PREDICTION_SCALP_MAX_SECONDS_TO_CLOSE ?? "900",
  ),
  /** Fraction of (tradeable capital − reserve) per scalp trade */
  scalpPctOfWallet: Number(process.env.PREDICTION_SCALP_PCT_OF_WALLET ?? "0.05"),
  /** Keep this much USDC unspent after sizing / funding swaps */
  scalpUsdcReserve: Number(process.env.PREDICTION_SCALP_USDC_RESERVE ?? "10"),
  scalpMaxUsdcPerTrade: Number(process.env.PREDICTION_SCALP_MAX_USDC ?? "15"),
  /** Auto-swap SOL/SPL → USDC before Forecast buys when USDC is short */
  autoFundUsdc:
    process.env.PREDICTION_AUTO_FUND_USDC?.trim().toLowerCase() !== "false",
  /** Skip dust bags when funding USDC */
  minFundTokenUsd: Number(process.env.PREDICTION_MIN_FUND_TOKEN_USD ?? "1"),
  scalpAllowPolymarket:
    process.env.PREDICTION_SCALP_ALLOW_POLYMARKET?.trim().toLowerCase() === "true",
  scalpLongshotEnabled:
    process.env.PREDICTION_SCALP_LONGSHOT?.trim().toLowerCase() !== "false",
  scalpLongshotMaxPrice: Number(process.env.PREDICTION_SCALP_LONGSHOT_MAX ?? "0.10"),
  scalpLongshotFairMultiple: Number(
    process.env.PREDICTION_SCALP_LONGSHOT_FAIR_MULT ?? "2",
  ),
  scalpTakeProfitEnabled:
    process.env.PREDICTION_SCALP_TAKE_PROFIT?.trim().toLowerCase() === "true",
  scalpTakeProfitPrice: Number(process.env.PREDICTION_SCALP_TP_PRICE ?? "0.90"),
  maxTradesPerDay: Number(process.env.PREDICTION_MAX_TRADES_PER_DAY ?? "500"),
  pollIntervalMs: Number(process.env.PREDICTION_POLL_INTERVAL_MS ?? "15000"),
  minSecondsToClose: Number(process.env.PREDICTION_MIN_SECONDS_TO_CLOSE ?? "45"),
  minOrderUsdc: 5,
  /** Jupiter Forecast: 5–250 USDC per docs */
  maxForecastOrderUsdc: Number(process.env.PREDICTION_MAX_FORECAST_USDC ?? "250"),
  /** Cap Polymarket fetches per tick to avoid Jupiter API 429s */
  maxPolymarketScans: Number(process.env.PREDICTION_MAX_POLYMARKET_SCANS ?? "4"),
  /** Max signals executed per tick (arb + scalp) */
  maxSignalsPerTick: Number(process.env.PREDICTION_MAX_SIGNALS_PER_TICK ?? "3"),
  /**
   * Min ms between Jupiter Prediction API calls (org-wide sliding window).
   * Free portal tier ≈ 1 RPS — default 1100. Raise if you still see 429s;
   * lower only on Developer+ plans (see https://dev.jup.ag/docs/portal/rate-limits).
   */
  jupiterMinIntervalMs: Number(
    process.env.PREDICTION_JUPITER_MIN_INTERVAL_MS ?? "1100",
  ),
  /** Retries on 429 before failing an order/scan call */
  jupiterMaxRetries: Number(process.env.PREDICTION_JUPITER_MAX_RETRIES ?? "4"),
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

/** Suno API key — AI music generation for on-chain music NFTs. */
export function getSunoApiKey(): string | undefined {
  return process.env.SUNO_API_KEY?.trim() || undefined;
}

/** Deployed PunaabMusicNFT ERC-721 on Base. */
export function getMusicNftContractAddress(): string | undefined {
  const addr = process.env.MUSIC_NFT_CONTRACT_ADDRESS?.trim();
  if (addr && /^0x[0-9a-fA-F]{40}$/i.test(addr)) return addr;
  return undefined;
}

/** Vercel Blob read/write token for permanent audio + cover hosting. */
export function getBlobReadWriteToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
}

/** USDC price for a one-of-one agent music NFT (default 5). */
export function getMusicNftPriceUsdc(): number {
  const n = Number(process.env.MUSIC_NFT_PRICE_USDC ?? "5");
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** Optional secret path segment for Suno webhook URL hardening. */
export function getSunoCallbackSecret(): string | undefined {
  return process.env.SUNO_CALLBACK_SECRET?.trim() || undefined;
}

/** When true (env only), agents can purchase music NFTs. Prefer isMusicDropLiveAsync for Redis flag. */
export function isMusicDropLive(): boolean {
  const v = process.env.MUSIC_DROP_LIVE?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** @deprecated Use isTradingEnabled() — reads TRADING_ENABLED env */
export const TRADING_ENABLED = isTradingEnabled();

/**
 * Jupiter Prediction Markets API client.
 * @see https://dev.jup.ag/docs/prediction
 * @see https://dev.jup.ag/docs/prediction/trading-lifecycle.md
 * @see https://dev.jup.ag/docs/prediction/forecast.md
 */
import {
  getJupiterApiKey,
  PREDICTION_MINT_USDC,
  PREDICTION_PRICE_SCALE,
  PREDICTION_TRADING_LIMITS,
} from "../config";
import {
  bestBid,
  isExecutableBuyPrice,
  microToDollars,
  parseOrderbookSide,
  resolveMarketBuyPrice,
} from "./pricing";
import type {
  PredictionEvent,
  PredictionMarket,
  PredictionMarketSummary,
  PredictionOrderbook,
  PredictionPosition,
} from "./types";

const BASE = "https://api.jup.ag/prediction/v1";

export class PredictionApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public geoBlocked = false,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "PredictionApiError";
  }
}

/** Jupiter blocks US + South Korea IPs from Prediction trading (orders). */
export function isPredictionGeoBlockResponse(
  status: number,
  body: string,
): boolean {
  if (/unsupported_region/i.test(body)) return true;
  if (/not available in your region/i.test(body)) return true;
  if (
    (status === 403 || status === 451) &&
    /geo|restricted|blocked|unavailable|region/i.test(body)
  ) {
    return true;
  }
  return false;
}

function apiKey(): string {
  const key = getJupiterApiKey();
  if (!key) {
    throw new PredictionApiError("JUPITER_API_KEY is not configured", 401);
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Serialize + pace calls so Free-tier 1 RPS (and shared org limits) aren't burst. */
let requestChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function parseRetryAfterMs(res: Response): number | undefined {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec > 0) return Math.ceil(sec * 1000);
  }
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset) {
    const asNum = Number(reset);
    if (Number.isFinite(asNum)) {
      // epoch seconds or ms
      const resetMs = asNum > 1e12 ? asNum : asNum * 1000;
      const wait = resetMs - Date.now();
      if (wait > 0) return Math.min(wait, 60_000);
    }
  }
  return undefined;
}

async function pacedFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const minInterval = Math.max(
    200,
    PREDICTION_TRADING_LIMITS.jupiterMinIntervalMs,
  );

  const run = async (): Promise<Response> => {
    const wait = Math.max(0, minInterval - (Date.now() - lastRequestAt));
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey(),
        ...(init?.headers ?? {}),
      },
    });
  };

  const scheduled = requestChain.then(run, run);
  requestChain = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const maxAttempts = Math.max(1, PREDICTION_TRADING_LIMITS.jupiterMaxRetries + 1);
  let lastError: PredictionApiError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await pacedFetch(path, init);

    if (res.ok) {
      return (await res.json()) as T;
    }

    const body = await res.text().catch(() => "");
    const geoBlocked = isPredictionGeoBlockResponse(res.status, body);
    const retryAfterMs = parseRetryAfterMs(res);
    lastError = new PredictionApiError(
      `Prediction API ${path} failed (${res.status}): ${body.slice(0, 200)}`,
      res.status,
      geoBlocked,
      retryAfterMs,
    );

    // Region blocks won't succeed on retry — fail fast
    if (geoBlocked) {
      throw lastError;
    }

    if (res.status === 429 && attempt < maxAttempts) {
      const backoff =
        retryAfterMs ??
        Math.min(30_000, PREDICTION_TRADING_LIMITS.jupiterMinIntervalMs * 2 ** attempt);
      console.warn(
        `[prediction-api] 429 on ${path}; retry ${attempt}/${maxAttempts - 1} in ${backoff}ms`,
      );
      await sleep(backoff);
      continue;
    }

    throw lastError;
  }

  throw lastError ?? new PredictionApiError(`Prediction API ${path} failed`, 500);
}

function parseMarket(raw: Record<string, unknown>): PredictionMarketSummary {
  const marketId = String(raw.marketId ?? raw.id ?? "");
  const pricingRaw = (raw.pricing as Record<string, unknown> | undefined) ?? {};
  // Prefer nested pricing.*; fall back to top-level (API migrations)
  const buyYes = pricingRaw.buyYesPriceUsd ?? raw.buyYesPriceUsd;
  const buyNo = pricingRaw.buyNoPriceUsd ?? raw.buyNoPriceUsd;
  const sellYes = pricingRaw.sellYesPriceUsd ?? raw.sellYesPriceUsd;
  const sellNo = pricingRaw.sellNoPriceUsd ?? raw.sellNoPriceUsd;
  return {
    marketId,
    title: raw.title ? String(raw.title) : undefined,
    question: raw.question ? String(raw.question) : undefined,
    closeTime: raw.closeTime != null ? String(raw.closeTime) : undefined,
    openTime: raw.openTime != null ? String(raw.openTime) : undefined,
    resolveAt: raw.resolveAt != null ? String(raw.resolveAt) : undefined,
    result: raw.result != null ? String(raw.result) : null,
    status: raw.status ? String(raw.status) : undefined,
    provider: raw.provider ? String(raw.provider) : undefined,
    tradable: raw.tradable === true,
    outcomeMint: raw.outcomeMint ? String(raw.outcomeMint) : undefined,
    outcomes: Array.isArray(raw.outcomes)
      ? raw.outcomes.map(String)
      : undefined,
    lifecycleStatus: raw.lifecycleStatus
      ? String(raw.lifecycleStatus)
      : undefined,
    buyYesPriceUsd:
      buyYes != null ? microToDollars(buyYes) : undefined,
    buyNoPriceUsd: buyNo != null ? microToDollars(buyNo) : undefined,
    sellYesPriceUsd:
      sellYes != null ? microToDollars(sellYes) : undefined,
    sellNoPriceUsd: sellNo != null ? microToDollars(sellNo) : undefined,
  };
}

function unwrapData<T>(data: { data?: T[] } | T[]): T[] {
  return Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];
}

export async function checkPredictionApiAccess(): Promise<{
  ok: boolean;
  geoBlocked?: boolean;
  error?: string;
}> {
  try {
    await getTradingStatus();
    return { ok: true };
  } catch (e) {
    if (e instanceof PredictionApiError) {
      return {
        ok: false,
        geoBlocked: e.geoBlocked,
        error: e.message,
      };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function getTradingStatus(): Promise<{
  tradingActive: boolean;
}> {
  const raw = await request<Record<string, unknown>>("/trading-status");
  return {
    tradingActive:
      raw.trading_active === true || raw.tradingActive === true,
  };
}

export async function listEvents(params: {
  category?: string;
  filter?: "new" | "live" | "trending" | "upcoming";
  provider?: "polymarket" | "kalshi" | "bisonfi";
  /** @deprecated use tags — Jupiter OpenAPI uses `tags` */
  tag?: string;
  tags?: string;
  includeMarkets?: boolean;
  limit?: number;
}): Promise<PredictionEvent[]> {
  const qs = new URLSearchParams();
  if (params.category) qs.set("category", params.category);
  if (params.filter) qs.set("filter", params.filter);
  if (params.provider) qs.set("provider", params.provider);
  const tagValue = params.tags ?? params.tag;
  if (tagValue) {
    qs.set("tags", tagValue);
    qs.set("tag", tagValue); // docs example still uses tag=
  }
  if (params.includeMarkets !== false) qs.set("includeMarkets", "true");
  if (params.limit) qs.set("end", String(params.limit));

  const data = await request<{ data?: unknown[] } | unknown[]>(
    `/events?${qs.toString()}`,
  );

  return unwrapData(data).map((row) => {
    const r = row as Record<string, unknown>;
    const eventId = String(r.eventId ?? r.id ?? "");
    const marketsRaw = Array.isArray(r.markets) ? r.markets : [];
    const markets = marketsRaw.map((m) =>
      parseMarket(m as Record<string, unknown>),
    );
    return {
      eventId,
      title: String(r.title ?? r.name ?? eventId),
      category: r.category ? String(r.category) : undefined,
      provider: r.provider ? String(r.provider) : undefined,
      markets,
    };
  });
}

/**
 * Jupiter Forecast — live bisonfi 15m BTC up/down.
 * Must use filter=live: without it the API returns upcoming rounds with
 * tradable=false and no buyYesPriceUsd (marketsScanned stays 0).
 */
export async function listForecastMarkets(): Promise<PredictionMarketSummary[]> {
  const events = await listEvents({
    provider: "bisonfi",
    category: "crypto",
    tags: "15m",
    filter: "live",
    includeMarkets: true,
  });
  return events
    .flatMap((e) => e.markets)
    .filter(
      (m) =>
        (m.provider === "bisonfi" || m.marketId.startsWith("BISON-")) &&
        m.tradable === true &&
        (m.lifecycleStatus == null || m.lifecycleStatus === "open"),
    );
}

export async function searchEvents(
  query: string,
  limit = 10,
): Promise<PredictionEvent[]> {
  const qs = new URLSearchParams({ query, limit: String(limit) });
  const data = await request<{ data?: unknown[] } | unknown[]>(
    `/events/search?${qs.toString()}`,
  );
  return unwrapData(data).map((row) => {
    const r = row as Record<string, unknown>;
    const marketsRaw = Array.isArray(r.markets) ? r.markets : [];
    return {
      eventId: String(r.eventId ?? r.id ?? ""),
      title: String(r.title ?? ""),
      category: r.category ? String(r.category) : undefined,
      provider: r.provider ? String(r.provider) : undefined,
      markets: marketsRaw.map((m) =>
        parseMarket(m as Record<string, unknown>),
      ),
    };
  });
}

export async function getMarket(
  marketId: string,
): Promise<PredictionMarket & PredictionMarketSummary> {
  const raw = await request<Record<string, unknown>>(
    `/markets/${encodeURIComponent(marketId)}`,
  );
  const parsed = parseMarket(raw);
  return {
    ...parsed,
    marketId: parsed.marketId || marketId,
  };
}

export async function getOrderbook(
  marketId: string,
  options?: {
    /** Prefer these buy prices (from fresh GET /markets) */
    marketPrices?: Pick<
      PredictionMarketSummary,
      "buyYesPriceUsd" | "buyNoPriceUsd"
    >;
    /** Extra GET /markets for buy prices */
    fetchMarketPrices?: boolean;
    /** Forecast single-outcome market: only buyYes is meaningful */
    forecastSide?: boolean;
  },
): Promise<PredictionOrderbook> {
  const raw = await request<Record<string, unknown>>(
    `/orderbook/${encodeURIComponent(marketId)}`,
  );

  const yesLevels = parseOrderbookSide(raw.yes_dollars ?? raw.yes);
  const noLevels = parseOrderbookSide(raw.no_dollars ?? raw.no);

  // Bids are for sells / fair mid — NEVER use cheapest bid as buy price
  const yesBid = bestBid(yesLevels);
  const noBid = bestBid(noLevels);

  let marketPrices = options?.marketPrices;
  if (options?.fetchMarketPrices || !marketPrices) {
    try {
      const market = await getMarket(marketId);
      marketPrices = {
        buyYesPriceUsd: market.buyYesPriceUsd,
        buyNoPriceUsd: market.buyNoPriceUsd,
      };
    } catch {
      // fall through
    }
  }

  const yesResolved = resolveMarketBuyPrice({
    buyYesPriceUsd: marketPrices?.buyYesPriceUsd,
    buyNoPriceUsd: undefined,
    forecastSide: options?.forecastSide === true,
  });
  const noResolved = options?.forecastSide
    ? { price: 0, source: "none" as const }
    : resolveMarketBuyPrice({
        buyYesPriceUsd: undefined,
        buyNoPriceUsd: marketPrices?.buyNoPriceUsd,
      });

  // Binary markets: yes buy + no buy from market fields
  let yesDollars = yesResolved.price;
  let noDollars = noResolved.price;
  let priceSource: PredictionOrderbook["priceSource"] = "none";

  if (options?.forecastSide) {
    yesDollars = yesResolved.price;
    noDollars = 0;
    priceSource = yesResolved.source === "market_buy" ? "market_buy" : "none";
  } else if (
    isExecutableBuyPrice(marketPrices?.buyYesPriceUsd) &&
    isExecutableBuyPrice(marketPrices?.buyNoPriceUsd)
  ) {
    yesDollars = marketPrices!.buyYesPriceUsd!;
    noDollars = marketPrices!.buyNoPriceUsd!;
    priceSource = "market_buy";
  } else if (isExecutableBuyPrice(marketPrices?.buyYesPriceUsd)) {
    yesDollars = marketPrices!.buyYesPriceUsd!;
    // Complement only for display — strategies must not arb on this alone
    noDollars = isExecutableBuyPrice(marketPrices?.buyNoPriceUsd)
      ? marketPrices!.buyNoPriceUsd!
      : 0;
    priceSource = noDollars > 0 ? "market_buy" : "mixed";
  } else {
    // Last resort display only — mark as bid_proxy so strategies skip arb
    yesDollars = yesBid;
    noDollars = noBid;
    priceSource = yesBid > 0 || noBid > 0 ? "bid_proxy" : "none";
  }

  const combined = yesDollars + noDollars;
  const edgeBps = combined > 0 ? Math.round((1 - combined) * 10_000) : 0;

  return {
    marketId,
    yes: yesDollars,
    no: noDollars,
    yesDollars,
    noDollars,
    combinedDollars: combined,
    edgeBps,
    priceSource,
    yesLevels,
    noLevels,
  };
}

/** Fresh buy price for a Forecast outcome market (UP or DOWN). */
export async function getForecastBuyPrice(
  marketId: string,
): Promise<{ price: number; sell?: number; market: PredictionMarketSummary }> {
  const market = await getMarket(marketId);
  const resolved = resolveMarketBuyPrice({
    buyYesPriceUsd: market.buyYesPriceUsd,
    forecastSide: true,
  });
  return {
    price: resolved.price,
    sell: market.sellYesPriceUsd,
    market,
  };
}

export async function getPositions(
  ownerPubkey: string,
): Promise<PredictionPosition[]> {
  const raw = await request<{ data?: unknown[] } | unknown[]>(
    `/positions?ownerPubkey=${encodeURIComponent(ownerPubkey)}`,
  );

  return unwrapData(raw).map((row) => {
    const r = row as Record<string, unknown>;
    const contractsMicroStr = String(r.contractsMicro ?? r.contracts ?? "0");
    let contractsMicro = 0;
    try {
      contractsMicro = Number(BigInt(contractsMicroStr));
    } catch {
      contractsMicro = Number(contractsMicroStr) || 0;
    }
    return {
      positionPubkey: String(r.positionPubkey ?? r.position ?? ""),
      marketId: String(r.marketId ?? ""),
      isYes: r.isYes === true || r.side === "yes",
      contractsMicro,
      contractsDecimal: r.contractsDecimal ? String(r.contractsDecimal) : undefined,
      totalCostUsd:
        r.totalCostUsd != null ? microToDollars(r.totalCostUsd) : undefined,
      avgPriceUsd:
        r.avgPriceUsd != null ? microToDollars(r.avgPriceUsd) : undefined,
      valueUsd: r.valueUsd != null ? microToDollars(r.valueUsd) : undefined,
      markPriceUsd:
        r.markPriceUsd != null ? microToDollars(r.markPriceUsd) : undefined,
      claimable: r.claimable === true,
    };
  });
}

export interface ExecutionContext {
  [key: string]: unknown;
}

export interface CreateOrderParams {
  ownerPubkey: string;
  marketId: string;
  isYes: boolean;
  isBuy: boolean;
  depositAmountNative: string;
  depositMint?: string;
  contractsMicro?: string;
}

export interface CreateOrderResult {
  transaction: string;
  txMeta?: { blockhash?: string; lastValidBlockHeight?: number };
  execution?: {
    context?: ExecutionContext;
    executionModel?: string;
  };
  order: {
    orderPubkey?: string;
    positionPubkey?: string;
    contractsMicro?: string;
    requiredSigners?: string[];
  };
  code?: string;
  message?: string;
}

export async function createOrder(
  params: CreateOrderParams,
): Promise<CreateOrderResult> {
  const body: Record<string, unknown> = {
    ownerPubkey: params.ownerPubkey,
    marketId: params.marketId,
    isYes: params.isYes,
    isBuy: params.isBuy,
    depositAmount: params.depositAmountNative,
    depositMint: params.depositMint ?? PREDICTION_MINT_USDC,
  };
  if (params.contractsMicro) {
    body.contractsMicro = params.contractsMicro;
  }

  const raw = await request<Record<string, unknown>>("/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const order = (raw.order ?? {}) as Record<string, unknown>;
  const execution = raw.execution as Record<string, unknown> | undefined;

  return {
    transaction: String(raw.transaction ?? ""),
    txMeta: raw.txMeta as CreateOrderResult["txMeta"],
    execution: execution
      ? {
          context: execution.context as ExecutionContext | undefined,
          executionModel: execution.executionModel
            ? String(execution.executionModel)
            : undefined,
        }
      : undefined,
    order: {
      orderPubkey: order.orderPubkey ? String(order.orderPubkey) : undefined,
      positionPubkey: order.positionPubkey
        ? String(order.positionPubkey)
        : undefined,
      contractsMicro:
        order.contractsMicro != null
          ? String(order.contractsMicro)
          : undefined,
      requiredSigners: Array.isArray(order.requiredSigners)
        ? order.requiredSigners.map(String)
        : undefined,
    },
    code: raw.code ? String(raw.code) : undefined,
    message: raw.message ? String(raw.message) : undefined,
  };
}

/** Forecast / atomic_swap path — submit signed tx via POST /execute. */
export async function executeOrder(params: {
  signedTransaction: string;
  context: ExecutionContext;
}): Promise<{ status: string; signature?: string; error?: string | null }> {
  const raw = await request<Record<string, unknown>>("/execute", {
    method: "POST",
    body: JSON.stringify({
      signedTransaction: params.signedTransaction,
      context: params.context,
    }),
  });
  return {
    status: String(raw.status ?? "unknown"),
    signature: raw.signature ? String(raw.signature) : undefined,
    error: raw.error != null ? String(raw.error) : null,
  };
}

export async function getOrderStatus(orderPubkey: string): Promise<{
  status?: string;
  filled?: boolean;
}> {
  const raw = await request<Record<string, unknown>>(
    `/orders/status/${encodeURIComponent(orderPubkey)}`,
  );
  const status = raw.status ? String(raw.status) : undefined;
  return {
    status,
    filled:
      status === "filled" ||
      status === "partiallyfilled" ||
      raw.filled === true,
  };
}

export async function createClaimTransaction(
  positionPubkey: string,
): Promise<{ transaction: string; execution?: CreateOrderResult["execution"] }> {
  const raw = await request<Record<string, unknown>>(
    `/positions/${encodeURIComponent(positionPubkey)}/claim`,
    { method: "POST", body: JSON.stringify({}) },
  );
  const execution = raw.execution as Record<string, unknown> | undefined;
  return {
    transaction: String(raw.transaction ?? ""),
    execution: execution
      ? {
          context: execution.context as ExecutionContext | undefined,
          executionModel: execution.executionModel
            ? String(execution.executionModel)
            : undefined,
        }
      : undefined,
  };
}

export async function closePosition(params: {
  positionPubkey: string;
  ownerPubkey: string;
}): Promise<{ transaction: string; execution?: CreateOrderResult["execution"] }> {
  const raw = await request<Record<string, unknown>>(
    `/positions/${encodeURIComponent(params.positionPubkey)}`,
    {
      method: "DELETE",
      body: JSON.stringify({ ownerPubkey: params.ownerPubkey }),
    },
  );
  const execution = raw.execution as Record<string, unknown> | undefined;
  return {
    transaction: String(raw.transaction ?? ""),
    execution: execution
      ? {
          context: execution.context as ExecutionContext | undefined,
          executionModel: execution.executionModel
            ? String(execution.executionModel)
            : undefined,
        }
      : undefined,
  };
}

/** Convert USD amount to Jupiter native units (1_000_000 = $1). Min $5 per docs. */
export function usdcToNative(usdc: number): string {
  return String(Math.round(usdc * PREDICTION_PRICE_SCALE));
}

export function isForecastMarket(marketId: string): boolean {
  return marketId.startsWith("BISON-");
}

export function forecastRoundKey(marketId: string): string {
  return marketId.replace(/-(UP|DOWN)$/i, "");
}

export function forecastUpMarketId(marketId: string): string {
  if (/-UP$/i.test(marketId)) return marketId;
  return marketId.replace(/-DOWN$/i, "-UP");
}

export function forecastDownMarketId(marketId: string): string {
  if (/-DOWN$/i.test(marketId)) return marketId;
  return marketId.replace(/-UP$/i, "-DOWN");
}

/** Forecast: isYes is always true; marketId selects UP vs DOWN side. */
export function resolveForecastOrder(
  side: "yes" | "no",
  primaryMarketId: string,
  pairedMarketId?: string,
): { marketId: string; isYes: true } {
  if (side === "yes") {
    return { marketId: forecastUpMarketId(primaryMarketId), isYes: true };
  }
  return {
    marketId: pairedMarketId ?? forecastDownMarketId(primaryMarketId),
    isYes: true,
  };
}

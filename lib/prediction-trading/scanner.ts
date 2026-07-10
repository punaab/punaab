import { PREDICTION_TRADING_LIMITS } from "../config";
import {
  forecastRoundKey,
  getForecastBuyPrice,
  getMarket,
  getOrderbook,
  getTradingStatus,
  listForecastMarkets,
  searchEvents,
} from "./client";
import { estimateFairProbYes, inferWindowSeconds } from "./fair-value";
import {
  midProbFromBuys,
  resolveMarketBuyPrice,
  validateForecastBuyPair,
} from "./pricing";
import type { MarketSnapshot, PredictionMarketSummary, PredictionOrderbook } from "./types";

const UP_DOWN_PATTERN =
  /\b(up|down|up or down|up\/down|yes|no|btc|bitcoin|sol|ethereum)\b/i;

export function isUpDownMarketTitle(title: string): boolean {
  return UP_DOWN_PATTERN.test(title);
}

function secondsUntil(iso?: string | number): number {
  if (iso == null) return Number.MAX_SAFE_INTEGER;
  const ms =
    typeof iso === "number"
      ? iso * 1000
      : new Date(iso).getTime();
  if (!Number.isFinite(ms)) return Number.MAX_SAFE_INTEGER;
  return Math.floor((ms - Date.now()) / 1000);
}

async function snapshotFromMarket(
  summary: Awaited<ReturnType<typeof getMarket>>,
): Promise<MarketSnapshot | null> {
  const title =
    summary.title ?? summary.question ?? summary.marketId;
  if (!isUpDownMarketTitle(title) && !summary.marketId.startsWith("BISON-")) {
    return null;
  }
  if (summary.status === "closed" || summary.status === "cancelled") {
    return null;
  }

  const orderbook = await getOrderbook(summary.marketId, {
    marketPrices: summary,
    fetchMarketPrices: true,
  });
  const closeIso = summary.closeTime;
  const secondsToClose = secondsUntil(closeIso);
  const windowSeconds = inferWindowSeconds(title);

  return {
    market: {
      marketId: summary.marketId,
      title,
      question: summary.question,
      openTime: summary.openTime,
      closeTime: summary.closeTime,
      resolveAt: summary.resolveAt,
      result: summary.result,
      provider: summary.provider,
      tradable: summary.tradable,
      outcomeMint: summary.outcomeMint,
    },
    orderbook,
    secondsToClose,
    fairProbYes: estimateFairProbYes({
      orderbook,
      secondsToClose,
      windowSeconds,
    }),
    isUpDown: true,
    isForecast: summary.marketId.startsWith("BISON-"),
  };
}

/** Pair BISON-*-UP / BISON-*-DOWN using fresh GET /markets buyYes prices (docs). */
async function snapshotFromForecastPair(
  up: PredictionMarketSummary,
  down: PredictionMarketSummary,
): Promise<MarketSnapshot | null> {
  if (up.status === "closed" || down.status === "closed") return null;
  if (up.lifecycleStatus === "settled" || down.lifecycleStatus === "settled") {
    return null;
  }

  // Fresh market pricing — never trust list embeds or orderbook lowest bids
  const [upQuote, downQuote] = [
    await getForecastBuyPrice(up.marketId),
    await getForecastBuyPrice(down.marketId),
  ];

  if (
    upQuote.market.tradable === false ||
    downQuote.market.tradable === false ||
    upQuote.market.lifecycleStatus === "resolving" ||
    downQuote.market.lifecycleStatus === "resolving"
  ) {
    return null;
  }

  const yesDollars = upQuote.price;
  const noDollars = downQuote.price;
  const pair = validateForecastBuyPair(yesDollars, noDollars);

  // Still emit snapshot for radar/fair-value when prices exist but aren't arb-ready
  const hasPrices =
    resolveMarketBuyPrice({
      buyYesPriceUsd: yesDollars,
      forecastSide: true,
    }).source === "market_buy" &&
    resolveMarketBuyPrice({
      buyYesPriceUsd: noDollars,
      forecastSide: true,
    }).source === "market_buy";

  if (!hasPrices) {
    // One or both sides missing executable market buys — skip (no stub fallback)
    return null;
  }

  const combined = yesDollars + noDollars;
  const orderbook: PredictionOrderbook = {
    marketId: up.marketId,
    yes: yesDollars,
    no: noDollars,
    yesDollars,
    noDollars,
    combinedDollars: combined,
    edgeBps: pair.edgeBps,
    priceSource: "market_buy",
  };

  const title =
    upQuote.market.title ??
    up.title ??
    up.question ??
    downQuote.market.title ??
    down.title ??
    down.question ??
    forecastRoundKey(up.marketId);

  const closeIso =
    upQuote.market.closeTime ??
    downQuote.market.closeTime ??
    up.closeTime ??
    down.closeTime;
  const secondsToClose = secondsUntil(closeIso);
  const windowSeconds = inferWindowSeconds(title);
  const fairProbYes = midProbFromBuys(
    yesDollars,
    noDollars,
    upQuote.sell,
    downQuote.sell,
  );

  return {
    market: {
      marketId: up.marketId,
      title,
      question: upQuote.market.question ?? up.question ?? down.question,
      openTime: upQuote.market.openTime ?? up.openTime ?? down.openTime,
      closeTime: closeIso,
      resolveAt: upQuote.market.resolveAt ?? up.resolveAt ?? down.resolveAt,
      result: upQuote.market.result ?? up.result ?? down.result,
      provider: up.provider ?? down.provider ?? "bisonfi",
      tradable: true,
      outcomeMint: upQuote.market.outcomeMint ?? up.outcomeMint,
    },
    orderbook,
    secondsToClose,
    fairProbYes: estimateFairProbYes({
      orderbook,
      secondsToClose,
      windowSeconds,
      overrideFair: fairProbYes,
    }),
    isUpDown: true,
    isForecast: true,
    pairedMarketId: down.marketId,
  };
}

async function addForecastSnapshots(
  markets: PredictionMarketSummary[],
  snapshots: MarketSnapshot[],
  seen: Set<string>,
): Promise<void> {
  const byRound = new Map<string, { up?: PredictionMarketSummary; down?: PredictionMarketSummary }>();

  for (const m of markets) {
    if (!m.marketId.startsWith("BISON-")) continue;
    const key = forecastRoundKey(m.marketId);
    const entry = byRound.get(key) ?? {};
    if (/-UP$/i.test(m.marketId)) entry.up = m;
    else if (/-DOWN$/i.test(m.marketId)) entry.down = m;
    byRound.set(key, entry);
  }

  for (const [key, pair] of byRound) {
    if (!pair.up || !pair.down) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    seen.add(pair.up.marketId);
    seen.add(pair.down.marketId);
    try {
      const snap = await snapshotFromForecastPair(pair.up, pair.down);
      if (snap) snapshots.push(snap);
    } catch (error) {
      console.warn(`[prediction-scanner] forecast pair ${key}:`, error);
    }
  }
}

/** Scan live crypto Up/Down — Jupiter Forecast (bisonfi 15m) primary. */
export async function scanLiveCryptoMarkets(): Promise<MarketSnapshot[]> {
  const { tradingActive } = await getTradingStatus();
  if (!tradingActive) {
    console.warn("[prediction-scanner] trading-status: exchange not active");
    return [];
  }

  const snapshots: MarketSnapshot[] = [];
  const seen = new Set<string>();

  // Jupiter Forecast — native 15m BTC up/down (single listEvents; no duplicate scan)
  try {
    const forecast = await listForecastMarkets();
    await addForecastSnapshots(forecast, snapshots, seen);
  } catch (error) {
    console.warn("[prediction-scanner] listForecastMarkets:", error);
  }

  // Optional: other Jupiter-aggregated markets (off by default — we trade Forecast)
  if (PREDICTION_TRADING_LIMITS.scalpAllowPolymarket) {
    let extraScans = 0;
    const cap = PREDICTION_TRADING_LIMITS.maxPolymarketScans;
    try {
      const searchHits = await searchEvents("up or down", 5);
      for (const event of searchHits) {
        for (const m of event.markets) {
          if (extraScans >= cap) break;
          if (!m.marketId || seen.has(m.marketId)) continue;
          if (m.marketId.startsWith("BISON-")) continue;
          seen.add(m.marketId);
          extraScans++;
          try {
            const full = await getMarket(m.marketId);
            const snap = await snapshotFromMarket(full);
            if (snap) snapshots.push(snap);
          } catch (error) {
            console.warn(`[prediction-scanner] search ${m.marketId}:`, error);
          }
        }
        if (extraScans >= cap) break;
      }
    } catch (error) {
      console.warn("[prediction-scanner] searchEvents:", error);
    }
  }

  return snapshots.sort((a, b) => a.secondsToClose - b.secondsToClose);
}

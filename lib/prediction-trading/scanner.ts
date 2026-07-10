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
  isExecutableBuyPrice,
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
  if (typeof iso === "number") {
    const ms = iso < 1e12 ? iso * 1000 : iso;
    return Math.floor((ms - Date.now()) / 1000);
  }
  // Unix seconds as string (e.g. "1710000000") vs ISO
  if (/^\d+$/.test(iso)) {
    const n = Number(iso);
    const ms = n < 1e12 ? n * 1000 : n;
    return Math.floor((ms - Date.now()) / 1000);
  }
  const ms = new Date(iso).getTime();
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

/** Pair BISON-*-UP / BISON-*-DOWN using buyYes prices (list or fresh GET /markets). */
async function snapshotFromForecastPair(
  up: PredictionMarketSummary,
  down: PredictionMarketSummary,
): Promise<MarketSnapshot | null> {
  if (up.status === "closed" || down.status === "closed") return null;
  if (up.lifecycleStatus === "settled" || down.lifecycleStatus === "settled") {
    return null;
  }
  if (up.lifecycleStatus === "resolving" || down.lifecycleStatus === "resolving") {
    return null;
  }

  // Prefer prices already on the live list response (avoids extra RPS / 429s)
  let yesDollars = up.buyYesPriceUsd ?? 0;
  let noDollars = down.buyYesPriceUsd ?? 0;
  let upSell = up.sellYesPriceUsd;
  let downSell = down.sellYesPriceUsd;
  let upMeta = up;
  let downMeta = down;

  const needFresh =
    !isExecutableBuyPrice(yesDollars) ||
    !isExecutableBuyPrice(noDollars) ||
    up.tradable !== true ||
    down.tradable !== true;

  if (needFresh) {
    const upQuote = await getForecastBuyPrice(up.marketId);
    const downQuote = await getForecastBuyPrice(down.marketId);
    upMeta = { ...up, ...upQuote.market };
    downMeta = { ...down, ...downQuote.market };
    yesDollars = upQuote.price;
    noDollars = downQuote.price;
    upSell = upQuote.sell;
    downSell = downQuote.sell;

    if (
      upQuote.market.tradable === false ||
      downQuote.market.tradable === false ||
      upQuote.market.lifecycleStatus === "resolving" ||
      downQuote.market.lifecycleStatus === "resolving"
    ) {
      return null;
    }
  }

  if (
    !isExecutableBuyPrice(yesDollars) ||
    !isExecutableBuyPrice(noDollars)
  ) {
    return null;
  }

  const pair = validateForecastBuyPair(yesDollars, noDollars);
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
    upMeta.title ??
    up.title ??
    up.question ??
    downMeta.title ??
    down.title ??
    down.question ??
    forecastRoundKey(up.marketId);

  const closeIso =
    upMeta.closeTime ?? downMeta.closeTime ?? up.closeTime ?? down.closeTime;
  const secondsToClose = secondsUntil(closeIso);
  const windowSeconds = inferWindowSeconds(title);
  const fairProbYes = midProbFromBuys(yesDollars, noDollars, upSell, downSell);

  return {
    market: {
      marketId: up.marketId,
      title,
      question: upMeta.question ?? up.question ?? down.question,
      openTime: upMeta.openTime ?? up.openTime ?? down.openTime,
      closeTime: closeIso,
      resolveAt: upMeta.resolveAt ?? up.resolveAt ?? down.resolveAt,
      result: upMeta.result ?? up.result ?? down.result,
      provider: up.provider ?? down.provider ?? "bisonfi",
      tradable: true,
      outcomeMint: upMeta.outcomeMint ?? up.outcomeMint,
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

  // Jupiter Forecast — live bisonfi 15m only (filter=live is required)
  try {
    const forecast = await listForecastMarkets();
    console.log(
      `[prediction-scanner] live forecast markets=${forecast.length}`,
    );
    await addForecastSnapshots(forecast, snapshots, seen);
    if (forecast.length === 0) {
      console.warn(
        "[prediction-scanner] no tradable BISON markets (between rounds?)",
      );
    }
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

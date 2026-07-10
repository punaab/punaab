import { PREDICTION_TRADING_LIMITS } from "../config";
import {
  forecastRoundKey,
  getMarket,
  getOrderbook,
  getTradingStatus,
  listEvents,
  listForecastMarkets,
  searchEvents,
} from "./client";
import { estimateFairProbYes, inferWindowSeconds } from "./fair-value";
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

  const orderbook = await getOrderbook(summary.marketId);
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

/** Pair BISON-*-UP / BISON-*-DOWN into one combined orderbook snapshot. */
async function snapshotFromForecastPair(
  up: PredictionMarketSummary,
  down: PredictionMarketSummary,
): Promise<MarketSnapshot | null> {
  if (up.status === "closed" || down.status === "closed") return null;

  const [upFull, downFull, upOb, downOb] = await Promise.all([
    getMarket(up.marketId),
    getMarket(down.marketId),
    getOrderbook(up.marketId),
    getOrderbook(down.marketId),
  ]);

  const title =
    upFull.title ??
    upFull.question ??
    downFull.title ??
    downFull.question ??
    forecastRoundKey(up.marketId);

  const yesDollars = upOb.yesDollars;
  const noDollars = downOb.yesDollars;
  const combined = yesDollars + noDollars;
  const orderbook: PredictionOrderbook = {
    marketId: up.marketId,
    yes: yesDollars,
    no: noDollars,
    yesDollars,
    noDollars,
    combinedDollars: combined,
    edgeBps: combined > 0 ? Math.round((1 - combined) * 10_000) : 0,
    yesLevels: upOb.yesLevels,
    noLevels: downOb.yesLevels,
  };

  const closeIso = upFull.closeTime ?? downFull.closeTime;
  const secondsToClose = secondsUntil(closeIso);
  const windowSeconds = inferWindowSeconds(title);

  return {
    market: {
      marketId: up.marketId,
      title,
      question: upFull.question,
      openTime: upFull.openTime ?? downFull.openTime,
      closeTime: closeIso,
      resolveAt: upFull.resolveAt ?? downFull.resolveAt,
      result: upFull.result ?? downFull.result,
      provider: "bisonfi",
      tradable: upFull.tradable !== false && downFull.tradable !== false,
      outcomeMint: upFull.outcomeMint,
    },
    pairedMarketId: down.marketId,
    orderbook,
    secondsToClose,
    fairProbYes: estimateFairProbYes({
      orderbook,
      secondsToClose,
      windowSeconds,
    }),
    isUpDown: true,
    isForecast: true,
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

  // Jupiter Forecast — native 15m BTC up/down
  try {
    const forecast = await listForecastMarkets();
    await addForecastSnapshots(forecast, snapshots, seen);
  } catch (error) {
    console.warn("[prediction-scanner] listForecastMarkets:", error);
  }

  // Also pick up any bisonfi markets from live crypto events
  try {
    const events = await listEvents({
      category: "crypto",
      filter: "live",
      provider: "bisonfi",
      includeMarkets: true,
    });
    for (const event of events) {
      const bisonMarkets = event.markets.filter((m) =>
        m.marketId.startsWith("BISON-"),
      );
      if (bisonMarkets.length) {
        await addForecastSnapshots(bisonMarkets, snapshots, seen);
      }
    }
  } catch (error) {
    console.warn("[prediction-scanner] listEvents bisonfi:", error);
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

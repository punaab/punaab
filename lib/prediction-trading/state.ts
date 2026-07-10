import { createRedisClient } from "../redis";
import { parseRedisValue } from "../redis-json";
import type { LegLedger, PredictionTickSummary, PredictionTradeLogEntry } from "./types";

export interface ArbMarketSnapshot {
  marketId: string;
  title: string;
  yes: number;
  no: number;
  combined: number;
  edgeBps: number;
  isForecast?: boolean;
  secondsToClose?: number;
}

export interface ArbHistoryPoint {
  timestamp: string;
  markets: ArbMarketSnapshot[];
  bestEdgeBps: number;
  marketsScanned: number;
}

export interface WalletBalancePoint {
  timestamp: string;
  address: string;
  sol: number;
  usdc: number;
  solValueUsd?: number;
  tokensValueUsd?: number;
  positionValueUsd: number;
  /** Full wallet worth when available (SOL + tokens + positions) */
  totalWorthUsd?: number;
  /** Liquid capital for Forecast (excludes gas reserve + open positions) */
  tradeableCapitalUsd?: number;
  openPositions: number;
}

const LEGS_KEY = "prediction:legs";
const LOG_KEY = "prediction:trade_log";
const TRADES_TODAY_KEY = "prediction:trades_today";
const USDC_TODAY_KEY = "prediction:usdc_today";
const LAST_TICK_KEY = "prediction:last_tick";
const ARB_HISTORY_KEY = "prediction:arb_history";
const WALLET_HISTORY_KEY = "prediction:wallet_history";
const GEO_BLOCKED_KEY = "prediction:geo_blocked";
/** Remember unsupported_region so we stop burning /orders from US IPs */
const GEO_BLOCKED_TTL_SEC = 6 * 3600;
const ARB_HISTORY_MAX = 48;
const WALLET_HISTORY_MAX = 48;

const DAY_TTL = 2 * 86400;
const LOG_MAX = 100;

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export async function getAllLegs(): Promise<Map<string, LegLedger>> {
  try {
    const raw = await getRedis().hgetall(LEGS_KEY);
    const map = new Map<string, LegLedger>();
    if (!raw || typeof raw !== "object") return map;
    for (const [k, v] of Object.entries(raw)) {
      const leg = parseRedisValue<LegLedger>(v);
      if (leg) map.set(k, leg);
    }
    return map;
  } catch (error) {
    console.error("[prediction-state] getAllLegs:", error);
    return new Map();
  }
}

export async function saveLeg(leg: LegLedger): Promise<void> {
  try {
    await getRedis().hset(LEGS_KEY, { [leg.marketId]: JSON.stringify(leg) });
  } catch (error) {
    console.error("[prediction-state] saveLeg:", error);
  }
}

export async function deleteLeg(marketId: string): Promise<void> {
  try {
    await getRedis().hdel(LEGS_KEY, marketId);
  } catch (error) {
    console.error("[prediction-state] deleteLeg:", error);
  }
}

/**
 * Drop Polymarket / non-Forecast ledger legs so they don't block open-market slots.
 * Keep BISON-* unless allowPolymarket is on.
 */
export async function pruneNonForecastLegs(
  allowPolymarket = false,
): Promise<string[]> {
  if (allowPolymarket) return [];
  const removed: string[] = [];
  const legs = await getAllLegs();
  for (const [marketId] of legs) {
    if (!marketId.startsWith("BISON-")) {
      await deleteLeg(marketId);
      removed.push(marketId);
    }
  }
  return removed;
}

/** Credible radar row — rejects stub 1¢ books and non-Forecast junk. */
export function isCredibleArbMarket(
  m: ArbMarketSnapshot,
  allowPolymarket = false,
): boolean {
  const isBison = m.marketId.startsWith("BISON-");
  const isPoly = m.marketId.startsWith("POLY-");
  if (isPoly && !allowPolymarket) return false;
  if (!isBison && !allowPolymarket) return false;
  if (m.yes > 0 && m.yes < 0.04) return false;
  if (m.no > 0 && m.no < 0.04) return false;
  if (m.combined > 0 && m.combined < 0.82) return false;
  if (m.edgeBps >= 5000) return false; // ≥50% "edge" is almost always bad data
  return true;
}

export async function getArbHistory(limit = 24): Promise<ArbHistoryPoint[]> {
  try {
    const allowPoly =
      process.env.PREDICTION_SCALP_ALLOW_POLYMARKET?.trim().toLowerCase() ===
      "true";
    const raw = await getRedis().lrange(ARB_HISTORY_KEY, 0, limit - 1);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v) => parseRedisValue<ArbHistoryPoint>(v))
      .filter((e): e is ArbHistoryPoint => e != null)
      .map((point) => {
        const markets = point.markets.filter((m) =>
          isCredibleArbMarket(m, allowPoly),
        );
        const bestEdgeBps = markets.reduce(
          (max, m) => Math.max(max, m.edgeBps),
          0,
        );
        return { ...point, markets, bestEdgeBps };
      })
      .reverse();
  } catch (error) {
    console.error("[prediction-state] getArbHistory:", error);
    return [];
  }
}

export async function getTradesToday(): Promise<number> {
  try {
    const key = `${TRADES_TODAY_KEY}:${utcDay()}`;
    const v = await getRedis().get(key);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function incrementTradesToday(usdc = 0): Promise<void> {
  try {
    const r = getRedis();
    const day = utcDay();
    await r.incr(`${TRADES_TODAY_KEY}:${day}`);
    await r.expire(`${TRADES_TODAY_KEY}:${day}`, DAY_TTL);
    if (usdc > 0) {
      await r.incrbyfloat(`${USDC_TODAY_KEY}:${day}`, usdc);
      await r.expire(`${USDC_TODAY_KEY}:${day}`, DAY_TTL);
    }
  } catch (error) {
    console.error("[prediction-state] incrementTradesToday:", error);
  }
}

export async function getUsdcDeployedToday(): Promise<number> {
  try {
    const v = await getRedis().get(`${USDC_TODAY_KEY}:${utcDay()}`);
    return v ? Number(v) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function appendPredictionLog(
  entry: Omit<PredictionTradeLogEntry, "id" | "timestamp">,
): Promise<PredictionTradeLogEntry> {
  const full: PredictionTradeLogEntry = {
    id: `pt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  try {
    const r = getRedis();
    await r.lpush(LOG_KEY, JSON.stringify(full));
    await r.ltrim(LOG_KEY, 0, LOG_MAX - 1);
  } catch (error) {
    console.error("[prediction-state] appendPredictionLog:", error);
  }
  return full;
}

export async function getPredictionLog(
  limit = 30,
): Promise<PredictionTradeLogEntry[]> {
  try {
    const raw = await getRedis().lrange(LOG_KEY, 0, limit - 1);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v) => parseRedisValue<PredictionTradeLogEntry>(v))
      .filter((e): e is PredictionTradeLogEntry => e != null);
  } catch (error) {
    console.error("[prediction-state] getPredictionLog:", error);
    return [];
  }
}

export async function setLastTickSummary(summary: unknown): Promise<void> {
  try {
    await getRedis().set(LAST_TICK_KEY, JSON.stringify(summary));
  } catch (error) {
    console.error("[prediction-state] setLastTickSummary:", error);
  }
}

export async function getLastTickSummary(): Promise<PredictionTickSummary | null> {
  try {
    const raw = await getRedis().get(LAST_TICK_KEY);
    return parseRedisValue<PredictionTickSummary>(raw);
  } catch {
    return null;
  }
}

export async function isPredictionGeoBlockedCached(): Promise<boolean> {
  try {
    const v = await getRedis().get(GEO_BLOCKED_KEY);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export async function markPredictionGeoBlocked(
  reason = "unsupported_region",
): Promise<void> {
  try {
    const { noteProcessGeoBlocked } = await import("./client");
    noteProcessGeoBlocked();
    await getRedis().set(GEO_BLOCKED_KEY, "1", {
      ex: GEO_BLOCKED_TTL_SEC,
    });
    console.warn(
      `[prediction-state] geo-blocked for ${GEO_BLOCKED_TTL_SEC}s: ${reason}`,
    );
  } catch (error) {
    console.error("[prediction-state] markPredictionGeoBlocked:", error);
  }
}

export async function clearPredictionGeoBlocked(): Promise<void> {
  try {
    const { clearProcessGeoBlocked } = await import("./client");
    clearProcessGeoBlocked();
    await getRedis().del(GEO_BLOCKED_KEY);
  } catch (error) {
    console.error("[prediction-state] clearPredictionGeoBlocked:", error);
  }
}

export async function appendArbHistory(point: ArbHistoryPoint): Promise<void> {
  try {
    const r = getRedis();
    // Only persist credible Forecast rows so Redis doesn't keep stub POLY edges
    const allowPoly =
      process.env.PREDICTION_SCALP_ALLOW_POLYMARKET?.trim().toLowerCase() ===
      "true";
    const markets = point.markets.filter((m) =>
      isCredibleArbMarket(m, allowPoly),
    );
    const bestEdgeBps = markets.reduce(
      (max, m) => Math.max(max, m.edgeBps),
      0,
    );
    await r.lpush(
      ARB_HISTORY_KEY,
      JSON.stringify({
        ...point,
        markets,
        bestEdgeBps,
        marketsScanned: point.marketsScanned,
      }),
    );
    await r.ltrim(ARB_HISTORY_KEY, 0, ARB_HISTORY_MAX - 1);
  } catch (error) {
    console.error("[prediction-state] appendArbHistory:", error);
  }
}

export async function appendWalletHistory(
  point: WalletBalancePoint,
): Promise<void> {
  try {
    const r = getRedis();
    await r.lpush(WALLET_HISTORY_KEY, JSON.stringify(point));
    await r.ltrim(WALLET_HISTORY_KEY, 0, WALLET_HISTORY_MAX - 1);
  } catch (error) {
    console.error("[prediction-state] appendWalletHistory:", error);
  }
}

export async function getWalletHistory(
  limit = 24,
): Promise<WalletBalancePoint[]> {
  try {
    const raw = await getRedis().lrange(WALLET_HISTORY_KEY, 0, limit - 1);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v) => parseRedisValue<WalletBalancePoint>(v))
      .filter((e): e is WalletBalancePoint => e != null)
      .reverse();
  } catch (error) {
    console.error("[prediction-state] getWalletHistory:", error);
    return [];
  }
}

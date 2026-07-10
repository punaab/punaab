import {
  isDryRun,
  isPredictionTradingEnabled,
  PREDICTION_TRADING_LIMITS,
} from "../config";
import type { LegLedger, MarketSnapshot, TradeSignal } from "./types";

export interface RiskContext {
  openMarketIds: Set<string>;
  legs: Map<string, LegLedger>;
  tradesToday: number;
  usdcDeployedToday: number;
  /** Liquid capital (USDC + swappable SOL/SPL) used for sizing / affordability */
  walletUsdc: number;
}

export function canRunPredictionTrading(): { ok: boolean; reason?: string } {
  if (!isPredictionTradingEnabled()) {
    return { ok: false, reason: "prediction_trading_disabled" };
  }
  return { ok: true };
}

export function shouldSkipMarket(
  snap: MarketSnapshot,
  ctx: RiskContext,
): string | null {
  const limits = PREDICTION_TRADING_LIMITS;

  if (
    snap.secondsToClose < limits.minSecondsToClose &&
    !limits.resolutionSnipeEnabled
  ) {
    return "too_close_to_resolution";
  }

  if (
    !ctx.legs.has(snap.market.marketId) &&
    ctx.openMarketIds.size >= limits.maxOpenMarkets
  ) {
    return "max_open_markets";
  }

  return null;
}

export function marketExposureUsd(leg: LegLedger | undefined): number {
  if (!leg) return 0;
  return leg.yesCostUsd + leg.noCostUsd;
}

export function validateSignal(
  signal: TradeSignal,
  snap: MarketSnapshot,
  ctx: RiskContext,
): { ok: boolean; reason?: string } {
  const limits = PREDICTION_TRADING_LIMITS;

  if (!signal.isBuy) {
    return { ok: true };
  }

  if (signal.depositUsdc < limits.minOrderUsdc) {
    return { ok: false, reason: "below_min_order_5_usdc" };
  }

  if (signal.depositUsdc > limits.maxUsdcPerLeg) {
    return { ok: false, reason: "exceeds_max_per_leg" };
  }

  if (
    signal.strategy === "directional_scalp" &&
    signal.depositUsdc > limits.scalpMaxUsdcPerTrade
  ) {
    return { ok: false, reason: "exceeds_scalp_max" };
  }

  const leg = ctx.legs.get(signal.marketId);
  const exposure = marketExposureUsd(leg) + signal.depositUsdc;
  if (exposure > limits.maxUsdcPerMarket) {
    return { ok: false, reason: "exceeds_max_per_market" };
  }

  // Scalp can run closer to close than arb (still gated in strategy)
  if (signal.strategy !== "directional_scalp") {
    const skip = shouldSkipMarket(snap, ctx);
    if (skip) return { ok: false, reason: skip };
  } else if (
    !ctx.legs.has(signal.marketId) &&
    ctx.openMarketIds.size >= limits.maxOpenMarkets
  ) {
    return { ok: false, reason: "max_open_markets" };
  }

  if (ctx.tradesToday >= limits.maxTradesPerDay && !isDryRun()) {
    return { ok: false, reason: "daily_trade_cap" };
  }

  // Live: don't spend more than tradeable capital − reserve
  // (USDC is topped up via auto-swap from SOL/SPL before the buy)
  if (
    !isDryRun() &&
    ctx.walletUsdc > 0 &&
    signal.depositUsdc > ctx.walletUsdc - limits.scalpUsdcReserve
  ) {
    return { ok: false, reason: "insufficient_tradeable_capital" };
  }

  return { ok: true };
}

export function combinedCostOk(combinedDollars: number): boolean {
  const maxCombined =
    1 - PREDICTION_TRADING_LIMITS.minCombinedEdgeBps / 10_000;
  return combinedDollars > 0 && combinedDollars <= maxCombined;
}

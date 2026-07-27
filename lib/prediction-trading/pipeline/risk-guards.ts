/**
 * VALIX-style risk guards for Solana Jupiter Forecast.
 * Entry bands, spread, direction lock, anti-chase, late cutoff, 1 trade/market.
 */
import { PREDICTION_TRADING_LIMITS } from "../../config";
import type { LegLedger, MarketSnapshot, TradeSignal } from "../types";
import type { RiskContext } from "../risk";

export function valixGuards(
  signal: TradeSignal,
  snap: MarketSnapshot,
  ctx: RiskContext,
): { ok: boolean; reason?: string } {
  const limits = PREDICTION_TRADING_LIMITS;

  if (!signal.isBuy) return { ok: true };

  // Temporal arb is hedged — skip directional-only guards
  if (signal.strategy.startsWith("temporal_arb")) {
    return { ok: true };
  }

  const price =
    signal.side === "yes"
      ? snap.orderbook.yesDollars
      : snap.orderbook.noDollars;

  if (price < limits.minEntryPrice || price > limits.maxEntryPrice) {
    return { ok: false, reason: `entry_band_${price.toFixed(3)}` };
  }

  // Spread proxy: |yes+no - 1| as inefficiency / friction
  const spreadProxy = Math.abs(snap.orderbook.combinedDollars - 1);
  if (spreadProxy > limits.maxSpreadPct && snap.orderbook.combinedDollars > 0.5) {
    // Only reject when book looks wide AND expensive (not classic arb < 1)
    if (snap.orderbook.combinedDollars >= 1) {
      return { ok: false, reason: `spread_${spreadProxy.toFixed(3)}` };
    }
  }

  if (snap.secondsToClose < limits.lateEntryCutoffSec) {
    if (
      signal.strategy === "directional_scalp" &&
      !limits.resolutionSnipeEnabled
    ) {
      return { ok: false, reason: "late_entry_cutoff" };
    }
  }

  const leg = ctx.legs.get(signal.marketId);
  if (limits.maxTradesPerMarket <= 1 && leg) {
    const already =
      (leg.yesCostUsd > 0 && signal.side === "yes") ||
      (leg.noCostUsd > 0 && signal.side === "no") ||
      (limits.lockMarketDirection &&
        (leg.yesCostUsd > 0 || leg.noCostUsd > 0) &&
        signal.strategy === "directional_scalp");
    if (already && signal.strategy === "directional_scalp") {
      return { ok: false, reason: "max_trades_per_market" };
    }
  }

  if (limits.lockMarketDirection && leg) {
    if (leg.yesCostUsd > 0 && signal.side === "no" && signal.isBuy) {
      return { ok: false, reason: "direction_lock_yes" };
    }
    if (leg.noCostUsd > 0 && signal.side === "yes" && signal.isBuy) {
      return { ok: false, reason: "direction_lock_no" };
    }
  }

  // Anti-chase: don't re-enter much worse than staged/prior price
  if (leg?.stagedPrice != null && leg.stagedSide === signal.side) {
    const delta = price - leg.stagedPrice;
    if (delta > limits.maxChaseDelta) {
      return { ok: false, reason: `anti_chase_${delta.toFixed(3)}` };
    }
  }

  // Daily loss circuit breaker (USDC deployed vs rough PnL not tracked → use deployed cap)
  if (
    !signal.strategy.startsWith("temporal_arb") &&
    ctx.usdcDeployedToday >= limits.maxDailyDeployUsdc
  ) {
    return { ok: false, reason: "daily_deploy_cap" };
  }

  return { ok: true };
}

/** Take-profit mark: entry + takeProfitPct * (1 - entry). */
export function takeProfitMark(entryPrice: number): number {
  const pct = PREDICTION_TRADING_LIMITS.takeProfitPct;
  return Math.min(0.99, entryPrice + pct * (1 - entryPrice));
}

export function shouldTakeProfit(params: {
  entryAvg: number;
  mark: number;
  leg?: LegLedger;
}): boolean {
  if (!PREDICTION_TRADING_LIMITS.scalpTakeProfitEnabled) return false;
  const tp = takeProfitMark(params.entryAvg);
  return params.mark >= tp;
}

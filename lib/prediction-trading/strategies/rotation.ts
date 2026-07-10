import { PREDICTION_TRADING_LIMITS } from "../../config";
import { fairEdgeSide } from "../fair-value";
import type { LegLedger, MarketSnapshot, TradeSignal } from "../types";

const MAX_ROTATIONS = 3;

/** Dynamic position rotation when fair prob shifts mid-window. */
export function signalsRotation(
  snap: MarketSnapshot,
  leg: LegLedger | undefined,
): TradeSignal[] {
  if (!PREDICTION_TRADING_LIMITS.rotationEnabled) return [];
  if ((leg?.rotationCount ?? 0) >= MAX_ROTATIONS) return [];

  const edgeSide = fairEdgeSide({
    fairProbYes: snap.fairProbYes,
    orderbook: snap.orderbook,
    minEdgeCents: 0.04,
  });
  if (!edgeSide) return [];

  const deposit = Math.min(
    PREDICTION_TRADING_LIMITS.maxUsdcPerLeg,
    PREDICTION_TRADING_LIMITS.minOrderUsdc,
  );

  const signals: TradeSignal[] = [];

  // Add undervalued side
  signals.push({
    strategy: "rotation",
    marketId: snap.market.marketId,
    side: edgeSide,
    isBuy: true,
    depositUsdc: deposit,
    reason: `rotation_add_${edgeSide} fair=${snap.fairProbYes.toFixed(2)} mkt_yes=${snap.orderbook.yesDollars.toFixed(2)}`,
  });

  // Reduce overvalued side if we have inventory (sell via close — phase 2 uses DELETE position)
  const overweight =
    edgeSide === "yes"
      ? snap.orderbook.noDollars > snap.fairProbYes + 0.05
      : snap.orderbook.yesDollars > 1 - snap.fairProbYes + 0.05;

  if (overweight && leg) {
    const reduceSide = edgeSide === "yes" ? "no" : "yes";
    const hasExposure =
      reduceSide === "yes" ? leg.yesCostUsd > 0 : leg.noCostUsd > 0;
    if (hasExposure) {
      signals.push({
        strategy: "rotation",
        marketId: snap.market.marketId,
        side: reduceSide,
        isBuy: false,
        depositUsdc: 0,
        reason: `rotation_reduce_${reduceSide}`,
      });
    }
  }

  return signals;
}

export function bumpRotation(leg: LegLedger): LegLedger {
  return {
    ...leg,
    rotationCount: leg.rotationCount + 1,
    updatedAt: new Date().toISOString(),
  };
}

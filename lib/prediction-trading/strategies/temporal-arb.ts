import { PREDICTION_TRADING_LIMITS } from "../../config";
import { combinedCostOk } from "../risk";
import type { LegLedger, MarketSnapshot, TradeSignal } from "../types";

export function signalsTemporalArb(
  snap: MarketSnapshot,
  leg: LegLedger | undefined,
): TradeSignal[] {
  const signals: TradeSignal[] = [];
  const { orderbook, market } = snap;
  const deposit = Math.min(
    PREDICTION_TRADING_LIMITS.maxUsdcPerLeg,
    PREDICTION_TRADING_LIMITS.minOrderUsdc,
  );

  // Instant arb: both sides cheap right now
  if (combinedCostOk(orderbook.combinedDollars)) {
    if (orderbook.yesDollars > 0 && orderbook.yesDollars <= 0.97) {
      signals.push({
        strategy: "temporal_arb_instant",
        marketId: market.marketId,
        side: "yes",
        isBuy: true,
        depositUsdc: deposit,
        reason: `instant_arb yes@${orderbook.yesDollars.toFixed(2)} combined=${orderbook.combinedDollars.toFixed(3)}`,
        expectedEdgeBps: orderbook.edgeBps,
      });
    }
    if (orderbook.noDollars > 0 && orderbook.noDollars <= 0.97) {
      signals.push({
        strategy: "temporal_arb_instant",
        marketId: market.marketId,
        side: "no",
        isBuy: true,
        depositUsdc: deposit,
        reason: `instant_arb no@${orderbook.noDollars.toFixed(2)} combined=${orderbook.combinedDollars.toFixed(3)}`,
        expectedEdgeBps: orderbook.edgeBps,
      });
    }
    return signals;
  }

  // Staged arb: one leg already staged, buy second when combined avg works
  if (leg?.stagedSide && leg.stagedPrice != null) {
    const otherSide = leg.stagedSide === "yes" ? "no" : "yes";
    const otherPrice =
      otherSide === "yes" ? orderbook.yesDollars : orderbook.noDollars;
    const combined = leg.stagedPrice + otherPrice;
    if (combinedCostOk(combined)) {
      signals.push({
        strategy: "temporal_arb_staged",
        marketId: market.marketId,
        side: otherSide,
        isBuy: true,
        depositUsdc: deposit,
        reason: `staged_arb ${otherSide}@${otherPrice.toFixed(2)} + staged ${leg.stagedSide}@${leg.stagedPrice.toFixed(2)} = ${combined.toFixed(3)}`,
        expectedEdgeBps: Math.round((1 - combined) * 10_000),
      });
    }
    return signals;
  }

  // Stage first cheap leg (tail 5-40c or any side that makes future pair plausible)
  const tailMax = PREDICTION_TRADING_LIMITS.tailMaxPrice;
  if (orderbook.yesDollars > 0 && orderbook.yesDollars <= tailMax) {
    signals.push({
      strategy: "temporal_arb_staged",
      marketId: market.marketId,
      side: "yes",
      isBuy: true,
      depositUsdc: deposit,
      reason: `stage_cheap_yes@${orderbook.yesDollars.toFixed(2)}`,
    });
  } else if (orderbook.noDollars > 0 && orderbook.noDollars <= tailMax) {
    signals.push({
      strategy: "temporal_arb_staged",
      marketId: market.marketId,
      side: "no",
      isBuy: true,
      depositUsdc: deposit,
      reason: `stage_cheap_no@${orderbook.noDollars.toFixed(2)}`,
    });
  }

  return signals;
}

export function recordStagedLeg(
  leg: LegLedger | undefined,
  signal: TradeSignal,
  price: number,
): LegLedger {
  const now = new Date().toISOString();
  const base: LegLedger = leg ?? {
    marketId: signal.marketId,
    yesCostUsd: 0,
    noCostUsd: 0,
    yesContractsMicro: 0,
    noContractsMicro: 0,
    rotationCount: 0,
    updatedAt: now,
  };

  if (signal.strategy.startsWith("temporal_arb_staged") && signal.isBuy) {
    return {
      ...base,
      stagedSide: signal.side,
      stagedPrice: price,
      stagedAt: now,
      updatedAt: now,
      ...(signal.side === "yes"
        ? { yesCostUsd: base.yesCostUsd + signal.depositUsdc }
        : { noCostUsd: base.noCostUsd + signal.depositUsdc }),
    };
  }

  if (signal.strategy.startsWith("temporal_arb")) {
    return {
      ...base,
      stagedSide: undefined,
      stagedPrice: undefined,
      stagedAt: undefined,
      updatedAt: now,
      ...(signal.side === "yes"
        ? { yesCostUsd: base.yesCostUsd + signal.depositUsdc }
        : { noCostUsd: base.noCostUsd + signal.depositUsdc }),
    };
  }

  if (signal.isBuy && signal.strategy === "directional_scalp") {
    return {
      ...base,
      updatedAt: now,
      ...(signal.side === "yes"
        ? { yesCostUsd: base.yesCostUsd + signal.depositUsdc }
        : { noCostUsd: base.noCostUsd + signal.depositUsdc }),
    };
  }

  if (signal.isBuy) {
    return {
      ...base,
      updatedAt: now,
      ...(signal.side === "yes"
        ? { yesCostUsd: base.yesCostUsd + signal.depositUsdc }
        : { noCostUsd: base.noCostUsd + signal.depositUsdc }),
    };
  }

  return base;
}

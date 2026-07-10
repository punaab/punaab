import { PREDICTION_TRADING_LIMITS } from "../../config";
import {
  isExecutableBuyPrice,
  validateBinaryBuyPair,
  validateForecastBuyPair,
} from "../pricing";
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

  // Never arb on bid-proxy / stub books (classic no@0.01 bug)
  if (
    orderbook.priceSource === "bid_proxy" ||
    orderbook.priceSource === "none"
  ) {
    return [];
  }

  const yes = orderbook.yesDollars;
  const no = orderbook.noDollars;
  const pair = snap.isForecast
    ? validateForecastBuyPair(yes, no)
    : validateBinaryBuyPair(yes, no);

  // Instant arb: both sides executable and combined edge clears floor
  if (pair.ok) {
    if (isExecutableBuyPrice(yes)) {
      signals.push({
        strategy: "temporal_arb_instant",
        marketId: market.marketId,
        side: "yes",
        isBuy: true,
        depositUsdc: deposit,
        reason: `instant_arb yes@${yes.toFixed(3)} combined=${pair.combined.toFixed(3)} src=${orderbook.priceSource ?? "market"}`,
        expectedEdgeBps: pair.edgeBps,
      });
    }
    if (isExecutableBuyPrice(no)) {
      signals.push({
        strategy: "temporal_arb_instant",
        marketId: market.marketId,
        side: "no",
        isBuy: true,
        depositUsdc: deposit,
        reason: `instant_arb no@${no.toFixed(3)} combined=${pair.combined.toFixed(3)} src=${orderbook.priceSource ?? "market"}`,
        expectedEdgeBps: pair.edgeBps,
      });
    }
    return signals;
  }

  // If either leg is a stub/missing buy price, do not stage — wait for clean books
  if (!isExecutableBuyPrice(yes) || !isExecutableBuyPrice(no)) {
    return [];
  }

  // Staged arb: one leg already staged, buy second when combined avg works
  if (leg?.stagedSide && leg.stagedPrice != null) {
    if (!isExecutableBuyPrice(leg.stagedPrice)) return [];
    const otherSide = leg.stagedSide === "yes" ? "no" : "yes";
    const otherPrice = otherSide === "yes" ? yes : no;
    if (!isExecutableBuyPrice(otherPrice)) return [];
    const combined = leg.stagedPrice + otherPrice;
    const stagedPair = snap.isForecast
      ? validateForecastBuyPair(
          otherSide === "yes" ? otherPrice : leg.stagedPrice,
          otherSide === "no" ? otherPrice : leg.stagedPrice,
        )
      : validateBinaryBuyPair(
          otherSide === "yes" ? otherPrice : leg.stagedPrice,
          otherSide === "no" ? otherPrice : leg.stagedPrice,
        );
    // For staged, validate the completed pair edge even if validateForecast
    // uses both as up/down — edge check is what matters
    const edgeBps = Math.round((1 - combined) * 10_000);
    if (
      edgeBps >= PREDICTION_TRADING_LIMITS.minCombinedEdgeBps &&
      combined <= 0.98 &&
      combined >= 0.82
    ) {
      signals.push({
        strategy: "temporal_arb_staged",
        marketId: market.marketId,
        side: otherSide,
        isBuy: true,
        depositUsdc: deposit,
        reason: `staged_arb ${otherSide}@${otherPrice.toFixed(3)} + staged ${leg.stagedSide}@${leg.stagedPrice.toFixed(3)} = ${combined.toFixed(3)}`,
        expectedEdgeBps: edgeBps,
      });
    }
    void stagedPair;
    return signals;
  }

  // Stage first cheap-but-executable leg (not stub floors)
  const tailMax = PREDICTION_TRADING_LIMITS.tailMaxPrice;
  const tailMin = Math.max(0.04, Number(process.env.PREDICTION_MIN_BUY_PRICE ?? "0.04"));
  if (yes >= tailMin && yes <= tailMax) {
    signals.push({
      strategy: "temporal_arb_staged",
      marketId: market.marketId,
      side: "yes",
      isBuy: true,
      depositUsdc: deposit,
      reason: `stage_cheap_yes@${yes.toFixed(3)}`,
    });
  } else if (no >= tailMin && no <= tailMax) {
    signals.push({
      strategy: "temporal_arb_staged",
      marketId: market.marketId,
      side: "no",
      isBuy: true,
      depositUsdc: deposit,
      reason: `stage_cheap_no@${no.toFixed(3)}`,
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

  if (signal.strategy === "temporal_arb_instant") {
    return {
      ...base,
      yesCostUsd:
        signal.side === "yes"
          ? base.yesCostUsd + signal.depositUsdc
          : base.yesCostUsd,
      noCostUsd:
        signal.side === "no"
          ? base.noCostUsd + signal.depositUsdc
          : base.noCostUsd,
      stagedSide: undefined,
      stagedPrice: undefined,
      stagedAt: undefined,
      updatedAt: now,
    };
  }

  if (signal.strategy === "temporal_arb_staged") {
    // Completing the other leg
    if (leg?.stagedSide && leg.stagedSide !== signal.side) {
      return {
        ...base,
        yesCostUsd:
          signal.side === "yes"
            ? base.yesCostUsd + signal.depositUsdc
            : base.yesCostUsd,
        noCostUsd:
          signal.side === "no"
            ? base.noCostUsd + signal.depositUsdc
            : base.noCostUsd,
        stagedSide: undefined,
        stagedPrice: undefined,
        stagedAt: undefined,
        updatedAt: now,
      };
    }
    return {
      ...base,
      yesCostUsd:
        signal.side === "yes"
          ? base.yesCostUsd + signal.depositUsdc
          : base.yesCostUsd,
      noCostUsd:
        signal.side === "no"
          ? base.noCostUsd + signal.depositUsdc
          : base.noCostUsd,
      stagedSide: signal.side,
      stagedPrice: price,
      stagedAt: now,
      updatedAt: now,
    };
  }

  return {
    ...base,
    yesCostUsd:
      signal.side === "yes"
        ? base.yesCostUsd + signal.depositUsdc
        : base.yesCostUsd,
    noCostUsd:
      signal.side === "no"
        ? base.noCostUsd + signal.depositUsdc
        : base.noCostUsd,
    updatedAt: now,
  };
}

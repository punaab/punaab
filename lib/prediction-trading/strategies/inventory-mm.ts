import { PREDICTION_TRADING_LIMITS } from "../../config";
import type { LegLedger, MarketSnapshot, TradeSignal } from "../types";

/** Inventory MM: buy cheap tails, accumulate favorites in 60-97c range. */
export function signalsInventoryMm(
  snap: MarketSnapshot,
  leg: LegLedger | undefined,
): TradeSignal[] {
  if (!PREDICTION_TRADING_LIMITS.inventoryMmEnabled) return [];

  const signals: TradeSignal[] = [];
  const deposit = Math.min(
    PREDICTION_TRADING_LIMITS.maxUsdcPerLeg,
    PREDICTION_TRADING_LIMITS.minOrderUsdc,
  );
  const { orderbook, market } = snap;
  const tailMax = PREDICTION_TRADING_LIMITS.tailMaxPrice;
  const favMin = PREDICTION_TRADING_LIMITS.favoriteMinPrice;

  // Buy tails (5-40c)
  if (orderbook.yesDollars > 0 && orderbook.yesDollars <= tailMax) {
    signals.push({
      strategy: "inventory_tail",
      marketId: market.marketId,
      side: "yes",
      isBuy: true,
      depositUsdc: deposit,
      reason: `tail_yes@${orderbook.yesDollars.toFixed(2)}`,
    });
  }
  if (orderbook.noDollars > 0 && orderbook.noDollars <= tailMax) {
    signals.push({
      strategy: "inventory_tail",
      marketId: market.marketId,
      side: "no",
      isBuy: true,
      depositUsdc: deposit,
      reason: `tail_no@${orderbook.noDollars.toFixed(2)}`,
    });
  }

  // Core allocation: favorite side 60-97c when combined book not already arb-ready
  if (orderbook.combinedDollars >= 0.99) {
    if (
      orderbook.yesDollars >= favMin &&
      orderbook.yesDollars <= 0.97
    ) {
      signals.push({
        strategy: "inventory_tail",
        marketId: market.marketId,
        side: "yes",
        isBuy: true,
        depositUsdc: deposit,
        reason: `favorite_yes@${orderbook.yesDollars.toFixed(2)}`,
      });
    }
    if (
      orderbook.noDollars >= favMin &&
      orderbook.noDollars <= 0.97
    ) {
      signals.push({
        strategy: "inventory_tail",
        marketId: market.marketId,
        side: "no",
        isBuy: true,
        depositUsdc: deposit,
        reason: `favorite_no@${orderbook.noDollars.toFixed(2)}`,
      });
    }
  }

  // Sell expensive side before resolution (96-99c) — signal sell, executor closes position
  if (snap.secondsToClose < 120 && leg) {
    if (orderbook.yesDollars >= 0.96 && leg.yesCostUsd > 0) {
      signals.push({
        strategy: "inventory_sell_favorite",
        marketId: market.marketId,
        side: "yes",
        isBuy: false,
        depositUsdc: 0,
        reason: `sell_favorite_yes@${orderbook.yesDollars.toFixed(2)} pre_resolution`,
      });
    }
    if (orderbook.noDollars >= 0.96 && leg.noCostUsd > 0) {
      signals.push({
        strategy: "inventory_sell_favorite",
        marketId: market.marketId,
        side: "no",
        isBuy: false,
        depositUsdc: 0,
        reason: `sell_favorite_no@${orderbook.noDollars.toFixed(2)} pre_resolution`,
      });
    }
  }

  return signals;
}

export function avgCombinedCost(leg: LegLedger): number {
  const contracts = Math.max(
    leg.yesContractsMicro,
    leg.noContractsMicro,
    1,
  );
  return (leg.yesCostUsd + leg.noCostUsd) / (contracts / 1_000_000);
}

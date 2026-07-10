import { PREDICTION_TRADING_LIMITS } from "../../config";
import type { LegLedger, MarketSnapshot, TradeSignal } from "../types";

/** Resolution-lag sniping — opt-in, high risk. Buy 98-99c near close. */
export function signalsResolutionSnipe(snap: MarketSnapshot): TradeSignal[] {
  if (!PREDICTION_TRADING_LIMITS.resolutionSnipeEnabled) return [];
  if (snap.secondsToClose > 30 || snap.secondsToClose < 3) return [];

  const signals: TradeSignal[] = [];
  const deposit = PREDICTION_TRADING_LIMITS.minOrderUsdc;
  const { orderbook, market } = snap;

  if (orderbook.yesDollars >= 0.98 && orderbook.yesDollars <= 0.995) {
    signals.push({
      strategy: "resolution_snipe",
      marketId: market.marketId,
      side: "yes",
      isBuy: true,
      depositUsdc: deposit,
      reason: `snipe_yes@${orderbook.yesDollars.toFixed(3)} t=${snap.secondsToClose}s`,
    });
  }
  if (orderbook.noDollars >= 0.98 && orderbook.noDollars <= 0.995) {
    signals.push({
      strategy: "resolution_snipe",
      marketId: market.marketId,
      side: "no",
      isBuy: true,
      depositUsdc: deposit,
      reason: `snipe_no@${orderbook.noDollars.toFixed(3)} t=${snap.secondsToClose}s`,
    });
  }

  return signals;
}

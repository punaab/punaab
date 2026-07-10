import { PREDICTION_TRADING_LIMITS } from "../../config";
import { fairEdgeSide } from "../fair-value";
import { minExecutableBuyPrice } from "../pricing";
import type { LegLedger, MarketSnapshot, TradeSignal } from "../types";

export interface ScalpContext {
  /** Available USDC in Solana trading wallet */
  walletUsdc: number;
  /** Trades already taken today */
  tradesToday: number;
}

/**
 * Polymarket-style directional scalp on Jupiter Prediction / Forecast.
 *
 * Buy Up (YES) or Down (NO) at 1–30¢ when the book misprices direction.
 * Hold to resolution ($1) — volume + repetition, not size.
 * Prefer Forecast (bisonfi) 15m BTC rounds; skip if already holding that side.
 */
export function signalsDirectionalScalp(
  snap: MarketSnapshot,
  leg: LegLedger | undefined,
  ctx: ScalpContext,
): TradeSignal[] {
  if (!PREDICTION_TRADING_LIMITS.scalpEnabled) return [];

  const limits = PREDICTION_TRADING_LIMITS;
  const { orderbook, market, fairProbYes, secondsToClose } = snap;

  // Need enough time for the thesis; avoid last-minute lottery without resolution snipe
  if (secondsToClose < limits.minSecondsToClose) return [];
  if (secondsToClose > limits.scalpMaxSecondsToClose) return [];

  // Prefer Forecast; allow Polymarket Up/Down if flag set
  if (!snap.isForecast && !limits.scalpAllowPolymarket) return [];

  // Skip bid-proxy stubs (classic 1¢ false edges)
  if (
    orderbook.priceSource === "bid_proxy" ||
    orderbook.priceSource === "none"
  ) {
    return [];
  }

  const maxEntry = limits.scalpMaxEntryPrice; // e.g. 0.30
  const minEntry = Math.max(limits.scalpMinEntryPrice, minExecutableBuyPrice());

  const yes = orderbook.yesDollars;
  const no = orderbook.noDollars;

  // Already holding this market — don't pyramid unless rotation strategy
  if (leg && (leg.yesCostUsd > 0 || leg.noCostUsd > 0)) {
    // Optional take-profit: sell favorite if mark ≥ 90¢ (lock gains before resolve)
    if (limits.scalpTakeProfitEnabled && secondsToClose < 180) {
      const signals: TradeSignal[] = [];
      if (leg.yesCostUsd > 0 && yes >= limits.scalpTakeProfitPrice) {
        signals.push({
          strategy: "directional_scalp_exit",
          marketId: market.marketId,
          side: "yes",
          isBuy: false,
          depositUsdc: 0,
          reason: `scalp_tp_yes@${yes.toFixed(2)}`,
        });
      }
      if (leg.noCostUsd > 0 && no >= limits.scalpTakeProfitPrice) {
        signals.push({
          strategy: "directional_scalp_exit",
          marketId: market.marketId,
          side: "no",
          isBuy: false,
          depositUsdc: 0,
          reason: `scalp_tp_no@${no.toFixed(2)}`,
        });
      }
      return signals;
    }
    return [];
  }

  const candidates: Array<{
    side: "yes" | "no";
    price: number;
    edge: number;
    fair: number;
  }> = [];

  if (yes >= minEntry && yes <= maxEntry) {
    const edge = fairProbYes - yes;
    if (edge >= limits.scalpMinEdge) {
      candidates.push({ side: "yes", price: yes, edge, fair: fairProbYes });
    }
  }
  if (no >= minEntry && no <= maxEntry) {
    const fairNo = 1 - fairProbYes;
    const edge = fairNo - no;
    if (edge >= limits.scalpMinEdge) {
      candidates.push({ side: "no", price: no, edge, fair: fairNo });
    }
  }

  // Order-book imbalance fallback: extreme cheap side when residual value exists
  // (not full arb — single-leg directional when one side is clearly mispriced vs mid)
  if (!candidates.length) {
    const bias = fairEdgeSide({
      fairProbYes,
      orderbook,
      minEdgeCents: limits.scalpMinEdge,
    });
    if (bias === "yes" && yes >= minEntry && yes <= maxEntry) {
      candidates.push({
        side: "yes",
        price: yes,
        edge: fairProbYes - yes,
        fair: fairProbYes,
      });
    } else if (bias === "no" && no >= minEntry && no <= maxEntry) {
      candidates.push({
        side: "no",
        price: no,
        edge: 1 - fairProbYes - no,
        fair: 1 - fairProbYes,
      });
    }
  }

  // Pure longshot snipe: 1–10¢ with enough residual (combined < 0.95) and
  // fair still gives that side ≥ 2× entry (asymmetric payoff)
  if (!candidates.length && limits.scalpLongshotEnabled) {
    const longshotMax = limits.scalpLongshotMaxPrice;
    if (
      yes >= minEntry &&
      yes <= longshotMax &&
      fairProbYes >= yes * limits.scalpLongshotFairMultiple &&
      orderbook.combinedDollars < 0.98
    ) {
      candidates.push({
        side: "yes",
        price: yes,
        edge: fairProbYes - yes,
        fair: fairProbYes,
      });
    }
    if (
      no >= minEntry &&
      no <= longshotMax &&
      1 - fairProbYes >= no * limits.scalpLongshotFairMultiple &&
      orderbook.combinedDollars < 0.98
    ) {
      candidates.push({
        side: "no",
        price: no,
        edge: 1 - fairProbYes - no,
        fair: 1 - fairProbYes,
      });
    }
  }

  if (!candidates.length) return [];

  // One side only — pick best edge / price ratio (ROI if resolves)
  candidates.sort((a, b) => {
    const roiA = a.edge / Math.max(0.01, a.price);
    const roiB = b.edge / Math.max(0.01, b.price);
    return roiB - roiA;
  });
  const best = candidates[0]!;

  const deposit = sizeScalpDeposit(ctx.walletUsdc, best.price);
  if (deposit < limits.minOrderUsdc) return [];

  const expectedRoiPct = Math.round((1 / best.price - 1) * 100);
  const edgeBps = Math.round(best.edge * 10_000);

  return [
    {
      strategy: "directional_scalp",
      marketId: market.marketId,
      side: best.side,
      isBuy: true,
      depositUsdc: deposit,
      expectedEdgeBps: edgeBps,
      reason: `scalp_${best.side}@${best.price.toFixed(2)} fair=${best.fair.toFixed(2)} edge=${best.edge.toFixed(2)} roi~${expectedRoiPct}% jupiter`,
    },
  ];
}

/** Small repeated bets — % of wallet, clamped to Jupiter min/max. */
export function sizeScalpDeposit(walletUsdc: number, entryPrice: number): number {
  const limits = PREDICTION_TRADING_LIMITS;
  const usable = Math.max(0, walletUsdc - limits.scalpUsdcReserve);
  if (usable < limits.minOrderUsdc) {
    // Dry-run / empty wallet: still emit min size so signals show up
    return limits.minOrderUsdc;
  }

  let size = usable * limits.scalpPctOfWallet;
  // Cheaper entries can size slightly up (more contracts per $)
  if (entryPrice > 0 && entryPrice <= 0.05) {
    size *= 1.25;
  }
  size = Math.max(limits.minOrderUsdc, size);
  size = Math.min(limits.maxUsdcPerLeg, size, limits.scalpMaxUsdcPerTrade, usable);

  // Round to 2 decimals
  return Math.floor(size * 100) / 100;
}

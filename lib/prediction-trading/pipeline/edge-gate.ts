/**
 * ML-style edge gate for Solana Forecast (VALIX MIN_ML_EDGE analogue).
 * Only allow directional bets when fused model edge clears the market price by enough.
 */
import { PREDICTION_TRADING_LIMITS } from "../../config";
import type { FusedSignal } from "./signals";
import type { TradeSignal } from "../types";

export function passesEdgeGate(
  fused: FusedSignal,
  signal: TradeSignal,
): { ok: boolean; reason?: string } {
  // Pure arb / inventory / resolution don't use the ML gate
  if (
    signal.strategy.startsWith("temporal_arb") ||
    signal.strategy.startsWith("inventory") ||
    signal.strategy === "resolution_snipe" ||
    signal.strategy === "rotation" ||
    !signal.isBuy
  ) {
    return { ok: true };
  }

  const minEdge = PREDICTION_TRADING_LIMITS.minMlEdge;
  const minConf = PREDICTION_TRADING_LIMITS.minFusionConfidence;

  if (fused.confidence < minConf) {
    return { ok: false, reason: `fusion_confidence_${fused.confidence.toFixed(2)}` };
  }

  if (!fused.preferredSide) {
    return { ok: false, reason: "no_fused_side" };
  }

  // Signal side must agree with fusion
  if (signal.side !== fused.preferredSide) {
    return { ok: false, reason: "fusion_side_mismatch" };
  }

  if (fused.mlEdge + 1e-9 < minEdge) {
    return {
      ok: false,
      reason: `ml_edge_${fused.mlEdge.toFixed(3)}_lt_${minEdge}`,
    };
  }

  return { ok: true };
}

/** Fractional Kelly-ish size fraction from model edge (capped). */
export function fractionalKellySize(params: {
  modelProb: number;
  entryPrice: number;
  fraction?: number;
}): number {
  const p = params.modelProb;
  const entry = params.entryPrice;
  if (entry <= 0 || entry >= 1 || p <= entry) return 0;
  const q = 1 - p;
  const b = (1 - entry) / entry;
  const full = (b * p - q) / b;
  const frac = params.fraction ?? PREDICTION_TRADING_LIMITS.kellyFraction;
  return Math.max(0, full * frac);
}

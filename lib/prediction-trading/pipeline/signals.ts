/**
 * Solana Forecast signal processors + fusion (VALIX-style, Jupiter/BISON).
 * Spike, divergence, momentum, imbalance → fused P(up) and confidence.
 */
import type { MarketSnapshot } from "../types";
import { orderbookImbalance } from "../fair-value";

export type SignalVote = {
  name: string;
  /** Direction lean: +1 = YES/Up, -1 = NO/Down */
  direction: number;
  /** 0–1 strength */
  strength: number;
  note?: string;
};

export type FusedSignal = {
  marketId: string;
  /** Calibrated P(YES/Up) after fusion */
  modelProbYes: number;
  /** −1 … +1 net directional score */
  score: number;
  confidence: number;
  votes: SignalVote[];
  preferredSide: "yes" | "no" | null;
  /** modelProb − market buy price for preferred side */
  mlEdge: number;
  marketPrice: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Spike: one side suddenly cheap vs the other (short-horizon dislocation). */
export function spikeVote(snap: MarketSnapshot): SignalVote {
  const y = snap.orderbook.yesDollars;
  const n = snap.orderbook.noDollars;
  if (y <= 0 || n <= 0) {
    return { name: "spike", direction: 0, strength: 0 };
  }
  const gap = Math.abs(y - n);
  const cheapIsYes = y < n;
  // Large gap + cheap side still tradable → spike lean toward cheap side recovery OR continuation
  // Use mean-reversion lean when combined ≪ 1 (arb-ish); momentum when combined ≈ 1
  const combined = y + n;
  const meanRevert = combined < 0.92;
  const leanCheap = meanRevert ? 1 : -1;
  const direction = (cheapIsYes ? 1 : -1) * leanCheap;
  const strength = clamp(gap / 0.35, 0, 1) * (meanRevert ? 0.9 : 0.55);
  return {
    name: "spike",
    direction,
    strength,
    note: meanRevert ? "mean_revert_gap" : "momentum_gap",
  };
}

/** Divergence: fair (time-decay mid) vs executable buy. */
export function divergenceVote(snap: MarketSnapshot): SignalVote {
  const fair = snap.fairProbYes;
  const y = snap.orderbook.yesDollars;
  const n = snap.orderbook.noDollars;
  if (y <= 0 || n <= 0) {
    return { name: "divergence", direction: 0, strength: 0 };
  }
  const yesEdge = fair - y;
  const noEdge = 1 - fair - n;
  if (yesEdge >= noEdge && yesEdge > 0.02) {
    return {
      name: "divergence",
      direction: 1,
      strength: clamp(yesEdge / 0.2, 0, 1),
      note: `yes_edge=${yesEdge.toFixed(3)}`,
    };
  }
  if (noEdge > 0.02) {
    return {
      name: "divergence",
      direction: -1,
      strength: clamp(noEdge / 0.2, 0, 1),
      note: `no_edge=${noEdge.toFixed(3)}`,
    };
  }
  return { name: "divergence", direction: 0, strength: 0 };
}

/** Momentum: late-window market mid trust (price discovery near close). */
export function momentumVote(snap: MarketSnapshot): SignalVote {
  const y = snap.orderbook.yesDollars;
  const n = snap.orderbook.noDollars;
  if (y <= 0 || n <= 0) {
    return { name: "momentum", direction: 0, strength: 0 };
  }
  const mid = y / (y + n);
  const late =
    snap.secondsToClose > 0 && snap.secondsToClose < 300
      ? 1 - snap.secondsToClose / 300
      : 0.15;
  const lean = mid - 0.5;
  return {
    name: "momentum",
    direction: lean >= 0 ? 1 : -1,
    strength: clamp(Math.abs(lean) * 2, 0, 1) * late,
    note: `mid=${mid.toFixed(3)}`,
  };
}

/** Order-book imbalance residual. */
export function imbalanceVote(snap: MarketSnapshot): SignalVote {
  const imb = orderbookImbalance(snap.orderbook);
  if (Math.abs(imb) < 0.02) {
    return { name: "imbalance", direction: 0, strength: 0 };
  }
  return {
    name: "imbalance",
    direction: imb > 0 ? 1 : -1,
    strength: clamp(Math.abs(imb) / 0.25, 0, 1),
  };
}

export type FusionWeights = {
  spike: number;
  divergence: number;
  momentum: number;
  imbalance: number;
};

export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  spike: 0.25,
  divergence: 0.4,
  momentum: 0.2,
  imbalance: 0.15,
};

/**
 * Fuse votes into model P(YES) and ML edge vs market.
 */
export function fuseMarketSignal(
  snap: MarketSnapshot,
  weights: FusionWeights = DEFAULT_FUSION_WEIGHTS,
): FusedSignal {
  const votes = [
    spikeVote(snap),
    divergenceVote(snap),
    momentumVote(snap),
    imbalanceVote(snap),
  ];

  const wmap: Record<string, number> = {
    spike: weights.spike,
    divergence: weights.divergence,
    momentum: weights.momentum,
    imbalance: weights.imbalance,
  };

  let num = 0;
  let den = 0;
  for (const v of votes) {
    const w = wmap[v.name] ?? 0.25;
    num += v.direction * v.strength * w;
    den += w;
  }
  const score = den > 0 ? clamp(num / den, -1, 1) : 0;

  // Map score → probability around fair mid
  const base = snap.fairProbYes;
  const modelProbYes = clamp(base + score * 0.18, 0.05, 0.95);
  const confidence = clamp(
    votes.reduce((s, v) => s + v.strength, 0) / votes.length,
    0,
    1,
  );

  const y = snap.orderbook.yesDollars;
  const n = snap.orderbook.noDollars;
  const yesEdge = modelProbYes - y;
  const noEdge = 1 - modelProbYes - n;

  let preferredSide: "yes" | "no" | null = null;
  let mlEdge = 0;
  let marketPrice = 0;
  if (yesEdge >= noEdge && yesEdge > 0) {
    preferredSide = "yes";
    mlEdge = yesEdge;
    marketPrice = y;
  } else if (noEdge > 0) {
    preferredSide = "no";
    mlEdge = noEdge;
    marketPrice = n;
  }

  return {
    marketId: snap.market.marketId,
    modelProbYes,
    score,
    confidence,
    votes,
    preferredSide,
    mlEdge,
    marketPrice,
  };
}

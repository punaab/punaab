/**
 * Lightweight self-learning: adjust fusion weights from recent Forecast outcomes.
 */
import { createRedisClient } from "../../redis";
import {
  DEFAULT_FUSION_WEIGHTS,
  type FusionWeights,
} from "./signals";

const WEIGHTS_KEY = "prediction:fusion_weights";
const OUTCOMES_KEY = "prediction:fusion_outcomes";

export async function loadFusionWeights(): Promise<FusionWeights> {
  try {
    const raw = await createRedisClient().get(WEIGHTS_KEY);
    if (raw && typeof raw === "object") {
      return { ...DEFAULT_FUSION_WEIGHTS, ...(raw as FusionWeights) };
    }
    if (typeof raw === "string") {
      return { ...DEFAULT_FUSION_WEIGHTS, ...JSON.parse(raw) };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_FUSION_WEIGHTS };
}

export async function recordFusionOutcome(params: {
  marketId: string;
  preferredSide: "yes" | "no";
  won: boolean;
  votes: Array<{ name: string; direction: number; strength: number }>;
}): Promise<void> {
  try {
    const r = createRedisClient();
    await r.lpush(
      OUTCOMES_KEY,
      JSON.stringify({ ...params, at: new Date().toISOString() }),
    );
    await r.ltrim(OUTCOMES_KEY, 0, 199);

    const weights = await loadFusionWeights();
    const delta = params.won ? 0.01 : -0.01;
    for (const v of params.votes) {
      if (v.strength < 0.2) continue;
      const key = v.name as keyof FusionWeights;
      if (!(key in weights)) continue;
      // Reward processors that leaned the winning way
      const agreed =
        (params.preferredSide === "yes" && v.direction > 0) ||
        (params.preferredSide === "no" && v.direction < 0);
      if (agreed) {
        weights[key] = Math.min(0.6, Math.max(0.05, weights[key] + delta));
      }
    }
    // Renormalize
    const sum =
      weights.spike + weights.divergence + weights.momentum + weights.imbalance;
    if (sum > 0) {
      weights.spike /= sum;
      weights.divergence /= sum;
      weights.momentum /= sum;
      weights.imbalance /= sum;
    }
    await r.set(WEIGHTS_KEY, JSON.stringify(weights), { ex: 30 * 86400 });
  } catch (error) {
    console.warn("[prediction-learning] record:", error);
  }
}

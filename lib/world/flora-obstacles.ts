/**
 * Solid footprints for trees, thick shrubs, and rocks — the things Punaab
 * should walk *around*, not through.
 *
 * Seeds and scatter parameters mirror `components/world/Flora.tsx` so the
 * collider under a pine is the pine you see. Crowns are ignored: only trunks
 * and boulder bodies block. Grass and heather stay walkable.
 */

import type { Collider } from "./collision";
import { biomeWeights, type BiomeId } from "./regions";
import type { QualityBudget } from "./quality";
import {
  ROAD_HALF_WIDTH,
  WATER_LEVEL,
  WATERS,
  WORLD_SIZE,
  distanceToRoad,
  heightAt,
} from "./terrain";

/** Same hash as Flora.tsx so collider positions land on the visible plants. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Placement = { x: number; z: number; scale: number };

type ScatterOptions = {
  seed: number;
  count: number;
  weights: Partial<Record<BiomeId, number>>;
  clump: number;
  clumpRadius: number;
  maxSlope: number;
  minHeight: number;
  maxHeight: number;
  minRoadDistance: number;
  minWaterDistance: number;
  scale: [number, number];
};

function distanceToWater(x: number, z: number): number {
  let best = Infinity;
  for (const water of WATERS) {
    const gap = Math.hypot(x - water.x, z - water.z) - water.radius;
    if (gap < best) best = gap;
  }
  return best;
}

function scatterBiome(options: ScatterOptions): Placement[] {
  const clumps = Math.max(1, Math.ceil(options.count / options.clump));
  const cells = Math.min(340, Math.max(8, Math.ceil(Math.sqrt(clumps * 3.5))));
  const half = (WORLD_SIZE / 2) * 0.985;
  const step = (half * 2) / cells;

  const density = new Float32Array(cells * cells);
  let total = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = -half + (i + 0.5) * step;
      const z = -half + (j + 0.5) * step;
      const weights = biomeWeights(x, z);
      let value = 0;
      for (const biome of Object.keys(weights) as BiomeId[]) {
        const want = options.weights[biome];
        if (want) value += want * (weights[biome] as number);
      }
      density[j * cells + i] = value;
      total += value;
    }
  }
  if (total <= 0) return [];

  const gain = clumps / total;
  const results: Placement[] = [];

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const index = j * cells + i;
      const chance = density[index] * gain;
      if (chance <= 0) continue;

      // Match Flora.tsx: whole clumps + remainder coin-toss (capped at 8).
      const whole = Math.min(8, Math.floor(chance));
      const extra =
        hash2(options.seed * 13 + index, index * 7 + options.seed) <
        chance - whole
          ? 1
          : 0;

      for (let rep = 0; rep < whole + extra; rep++) {
        const key = index * 9 + rep;
        const jx = hash2(options.seed + key, key * 3) - 0.5;
        const jz = hash2(key * 11, options.seed * 5 + key) - 0.5;
        const cx = -half + (i + 0.5 + jx * 0.92) * step;
        const cz = -half + (j + 0.5 + jz * 0.92) * step;

        const y = heightAt(cx, cz);
        const sample = 1.2;
        const dydx = (heightAt(cx + sample, cz) - y) / sample;
        const dydz = (heightAt(cx, cz + sample) - y) / sample;
        const gradient = Math.hypot(dydx, dydz);
        const slope = 1 - 1 / Math.sqrt(1 + gradient * gradient);
        if (slope > options.maxSlope) continue;
        if (y < options.minHeight || y > options.maxHeight) continue;
        if (distanceToRoad(cx, cz) < options.minRoadDistance) continue;
        if (distanceToWater(cx, cz) < options.minWaterDistance) continue;

        // Mirror Flora's placeClump: reject members that drift onto the road.
        const memberRoadClear = Math.min(
          options.minRoadDistance,
          ROAD_HALF_WIDTH + 0.85
        );

        for (let k = 0; k < options.clump; k++) {
          const member = key * 31 + k;
          const angle = hash2(options.seed + member * 3, member) * Math.PI * 2;
          const radius =
            Math.sqrt(hash2(member * 5, options.seed + member)) *
            options.clumpRadius;
          const ox = Math.cos(angle) * radius;
          const oz = Math.sin(angle) * radius;
          if (distanceToRoad(cx + ox, cz + oz) < memberRoadClear) continue;
          const scale =
            options.scale[0] +
            (options.scale[1] - options.scale[0]) *
              hash2(options.seed * 7 + member, member * 17);
          results.push({ x: cx + ox, z: cz + oz, scale });
        }
      }
    }
  }
  return results;
}

/** Mirror of Flora's tree scatter table — keep in sync with Flora.tsx TREES. */
const TREE_SPECS = [
  {
    id: "pine",
    share: 0.3,
    weights: { pine: 1, highland: 0.3, heath: 0.07, marsh: 0.05, broadleaf: 0.08 },
    trunk: 0.55,
    scale: [0.62, 1.35] as [number, number],
    maxSlope: 0.5,
    minHeight: WATER_LEVEL + 0.8,
    maxHeight: 62,
    clump: 3,
    clumpRadius: 5.5,
    minRoadDistance: 5,
    minWaterDistance: 2,
  },
  {
    id: "oak",
    share: 0.24,
    weights: {
      broadleaf: 1,
      meadow: 0.18,
      orchard: 0.14,
      farmland: 0.09,
      heath: 0.05,
      shore: 0.06,
    },
    trunk: 0.7,
    scale: [0.66, 1.45] as [number, number],
    maxSlope: 0.42,
    minHeight: WATER_LEVEL + 0.8,
    maxHeight: 56,
    clump: 2,
    clumpRadius: 11,
    minRoadDistance: 5.5,
    minWaterDistance: 2.5,
  },
  {
    id: "birch",
    share: 0.16,
    weights: {
      broadleaf: 0.45,
      pine: 0.28,
      heath: 0.16,
      highland: 0.12,
      meadow: 0.09,
      marsh: 0.08,
    },
    trunk: 0.4,
    scale: [0.7, 1.3] as [number, number],
    maxSlope: 0.46,
    minHeight: WATER_LEVEL + 0.8,
    maxHeight: 62,
    clump: 4,
    clumpRadius: 5,
    minRoadDistance: 5,
    minWaterDistance: 2,
  },
  {
    id: "willow",
    share: 0.09,
    weights: { marsh: 0.8, shore: 0.5, orchard: 0.14, broadleaf: 0.14, meadow: 0.07 },
    trunk: 0.6,
    scale: [0.7, 1.24] as [number, number],
    maxSlope: 0.34,
    minHeight: WATER_LEVEL + 0.15,
    maxHeight: 26,
    clump: 3,
    clumpRadius: 9,
    minRoadDistance: 4.5,
    minWaterDistance: -1,
  },
  {
    id: "apple",
    share: 0.09,
    weights: { orchard: 1, farmland: 0.16 },
    trunk: 0.42,
    scale: [0.82, 1.12] as [number, number],
    maxSlope: 0.24,
    minHeight: WATER_LEVEL + 1,
    maxHeight: 34,
    clump: 1,
    clumpRadius: 0,
    minRoadDistance: 4,
    minWaterDistance: 4,
  },
  {
    id: "snag",
    share: 0.12,
    weights: { badlands: 0.9, marsh: 0.4, pine: 0.16, highland: 0.14, heath: 0.1 },
    trunk: 0.5,
    scale: [0.58, 1.2] as [number, number],
    maxSlope: 0.55,
    minHeight: WATER_LEVEL + 0.2,
    maxHeight: 130,
    clump: 2,
    clumpRadius: 9,
    minRoadDistance: 3.5,
    minWaterDistance: 2,
  },
] as const;

const SHRUB_SPECS = [
  {
    id: "hazel",
    share: 0.3,
    weights: { broadleaf: 1, orchard: 0.34, meadow: 0.22, pine: 0.18, marsh: 0.14 },
    radius: 0.7,
    scale: [0.7, 1.5] as [number, number],
    maxSlope: 0.5,
    minHeight: WATER_LEVEL + 0.7,
    maxHeight: 62,
    clump: 3,
    clumpRadius: 3.4,
    minRoadDistance: 3.4,
    minWaterDistance: 1.5,
    seed: 9100,
  },
  {
    id: "gorse",
    share: 0.32,
    weights: {
      heath: 1,
      meadow: 0.36,
      shore: 0.34,
      highland: 0.28,
      badlands: 0.16,
      pine: 0.12,
    },
    radius: 0.55,
    scale: [0.6, 1.35] as [number, number],
    maxSlope: 0.62,
    minHeight: WATER_LEVEL + 0.7,
    maxHeight: 74,
    clump: 4,
    clumpRadius: 2.8,
    minRoadDistance: 3,
    minWaterDistance: 2,
    seed: 9311,
  },
] as const;

const ROCK_WEIGHTS: Partial<Record<BiomeId, number>> = {
  highland: 1,
  heath: 0.62,
  pine: 0.32,
  badlands: 0.16,
  meadow: 0.1,
  shore: 0.2,
};

/**
 * Builds colliders for the current quality budget. Safe to call once at world
 * install — expensive height sampling, so keep it off the frame loop.
 */
export function floraObstacleColliders(budget: QualityBudget): Collider[] {
  const out: Collider[] = [];
  let id = 0;

  for (let s = 0; s < TREE_SPECS.length; s++) {
    const spec = TREE_SPECS[s];
    const items = scatterBiome({
      seed: 4200 + s * 137,
      count: Math.round(budget.trees * spec.share),
      weights: spec.weights,
      clump: spec.clump,
      clumpRadius: spec.clumpRadius,
      maxSlope: spec.maxSlope,
      minHeight: spec.minHeight,
      maxHeight: spec.maxHeight,
      minRoadDistance: Math.max(spec.minRoadDistance, 11),
      minWaterDistance: spec.minWaterDistance,
      scale: spec.scale,
    });
    for (const item of items) {
      out.push({
        id: `flora-tree-${id++}`,
        x: item.x,
        z: item.z,
        radius: Math.max(0.45, spec.trunk * item.scale),
        solid: true,
        kind: "tree",
        label: spec.id,
      });
    }
  }

  for (let s = 0; s < SHRUB_SPECS.length; s++) {
    const spec = SHRUB_SPECS[s];
    const items = scatterBiome({
      seed: spec.seed,
      count: Math.round(budget.shrubs * spec.share),
      weights: spec.weights,
      clump: spec.clump,
      clumpRadius: spec.clumpRadius,
      maxSlope: spec.maxSlope,
      minHeight: spec.minHeight,
      maxHeight: spec.maxHeight,
      minRoadDistance: spec.minRoadDistance,
      minWaterDistance: spec.minWaterDistance,
      scale: spec.scale,
    });
    for (const item of items) {
      out.push({
        id: `flora-shrub-${id++}`,
        x: item.x,
        z: item.z,
        radius: Math.max(0.4, spec.radius * item.scale),
        solid: true,
        kind: "shrub",
        label: spec.id,
      });
    }
  }

  // Keep in sync with Flora.tsx rock scatter.
  const rockClumpRadius = 3.2;
  const rockMinRoad = ROAD_HALF_WIDTH + rockClumpRadius + 1.4;

  for (let v = 0; v < 3; v++) {
    const items = scatterBiome({
      seed: 909 + v * 173,
      count: Math.round(budget.rocks / 3),
      weights: ROCK_WEIGHTS,
      clump: 2,
      clumpRadius: rockClumpRadius,
      maxSlope: 0.72,
      minHeight: WATER_LEVEL - 0.3,
      maxHeight: 200,
      minRoadDistance: rockMinRoad,
      minWaterDistance: -1,
      scale: [0.3, 1.7],
    });
    for (const item of items) {
      out.push({
        id: `flora-rock-${id++}`,
        x: item.x,
        z: item.z,
        radius: Math.max(0.35, 0.55 * item.scale),
        solid: true,
        kind: "rock",
      });
    }
  }

  return out;
}

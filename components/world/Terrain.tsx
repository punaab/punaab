"use client";

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { daylight } from "@/lib/world/daylight";
import {
  WORLD_SIZE,
  WATER_LEVEL,
  TREE_LINE,
  SNOW_LINE,
  ROAD_HALF_WIDTH,
  WATERS,
  RIVERS,
  distanceToRoad,
  nearestRoadPoint,
  fbm,
  heightAt,
} from "@/lib/world/terrain";
import { setTerrainLod } from "@/lib/world/surfaces";
import { biomeWeights, type BiomeId } from "@/lib/world/regions";
import { GHIBLI, ghibliSunDirection } from "@/lib/world/ghibli-palette";
import { makeTerrainSurfaces, type TerrainSurfaces } from "@/lib/world/textures";
import {
  budgetFor,
  budgetForSegments,
  type QualityBudget,
} from "@/lib/world/quality";

/**
 * The ground.
 *
 * Two decisions shape this file. The first is that the mesh is *chunked*: a
 * single 640-metre grid is either too coarse to stand on or too heavy to build,
 * and there is no setting in between, because a uniform grid spends exactly as
 * many vertices on the far side of a mountain as on the path under the bard's
 * feet. Chunks let the tessellation follow the road network — where the camera
 * provably is, since it follows a man who walks roads — and they give three.js
 * something to frustum-cull, which it cannot do with one mesh.
 *
 * The second is that the surface is painted from `biomeWeights()` rather than
 * from height and slope. Height-and-slope terrain always looks like the same
 * planet everywhere: one green, one grey, one white, banded by altitude. Real
 * country changes because of what grows there, and what grows there is a fact
 * about the region, not about the contour line — so the farmland is farmland
 * halfway up its hill, and the badlands stay red at the height the meadow is
 * green.
 */

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

function clamp01(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** sRGB bytes -> the renderer's working colour space, as a plain triple. */
function srgb(r: number, g: number, b: number): Float32Array {
  const colour = new THREE.Color().setRGB(
    r / 255,
    g / 255,
    b / 255,
    THREE.SRGBColorSpace
  );
  return Float32Array.of(colour.r, colour.g, colour.b);
}

// ---------------------------------------------------------------------------
// Biome palettes
// ---------------------------------------------------------------------------

/**
 * What each biome is made of.
 *
 * `cover` is the ground in an ordinary year, `dry` the same ground on a sunburnt
 * ridge, and `accent` the thing that makes the biome recognisable from three
 * hundred metres — heather on the moor, ripe barley in the fields, iron stain in
 * the badlands. The accent is applied at a different noise scale from the dry
 * term on purpose: two scales of variation is the difference between a hillside
 * that looks weathered and one that looks like a gradient.
 */
type BiomePalette = {
  cover: Float32Array;
  dry: Float32Array;
  accent: Float32Array;
  /** How much of the biome the accent takes over at its strongest. */
  accentAmount: number;
  /** Exposed earth, used for the road corridor and for scars. */
  soil: Float32Array;
  rock: Float32Array;
  /** How readily bare rock shows through on a slope. */
  rockiness: number;
};

const BIOME_ORDER: BiomeId[] = [
  "meadow",
  "broadleaf",
  "pine",
  "highland",
  "marsh",
  "shore",
  "farmland",
  "orchard",
  "heath",
  "badlands",
];

const BIOME_COUNT = BIOME_ORDER.length;

const PALETTES: BiomePalette[] = [
  // meadow — tip→base greens
  {
    cover: srgb(108, 154, 71),
    dry: srgb(217, 192, 121),
    accent: srgb(198, 212, 107),
    accentAmount: 0.36,
    soil: srgb(122, 102, 77),
    rock: srgb(180, 167, 148),
    rockiness: 0.32,
  },
  // broadleaf
  {
    cover: srgb(90, 129, 72),
    dry: srgb(168, 156, 96),
    accent: srgb(152, 172, 67),
    accentAmount: 0.4,
    soil: srgb(86, 70, 50),
    rock: srgb(180, 167, 148),
    rockiness: 0.28,
  },
  // pine — deeper teal shade
  {
    cover: srgb(47, 85, 70),
    dry: srgb(110, 120, 86),
    accent: srgb(67, 110, 79),
    accentAmount: 0.42,
    soil: srgb(76, 63, 52),
    rock: srgb(95, 92, 88),
    rockiness: 0.44,
  },
  // highland — cooler ridges
  {
    cover: srgb(143, 169, 162),
    dry: srgb(174, 188, 201),
    accent: srgb(156, 176, 180),
    accentAmount: 0.44,
    soil: srgb(122, 110, 96),
    rock: srgb(180, 167, 148),
    rockiness: 0.84,
  },
  // marsh
  {
    cover: srgb(67, 110, 79),
    dry: srgb(168, 156, 96),
    accent: srgb(165, 203, 190),
    accentAmount: 0.48,
    soil: srgb(64, 60, 46),
    rock: srgb(110, 126, 117),
    rockiness: 0.08,
  },
  // shore
  {
    cover: srgb(165, 203, 190),
    dry: srgb(201, 173, 128),
    accent: srgb(238, 245, 239),
    accentAmount: 0.4,
    soil: srgb(201, 173, 128),
    rock: srgb(180, 167, 148),
    rockiness: 0.24,
  },
  // farmland
  {
    cover: srgb(147, 184, 78),
    dry: srgb(217, 192, 121),
    accent: srgb(198, 212, 107),
    accentAmount: 0.55,
    soil: srgb(122, 102, 77),
    rock: srgb(180, 167, 148),
    rockiness: 0.08,
  },
  // orchard
  {
    cover: srgb(110, 148, 64),
    dry: srgb(168, 156, 96),
    accent: srgb(152, 172, 67),
    accentAmount: 0.32,
    soil: srgb(104, 84, 58),
    rock: srgb(180, 167, 148),
    rockiness: 0.1,
  },
  // heath
  {
    cover: srgb(95, 138, 90),
    dry: srgb(217, 192, 121),
    accent: srgb(143, 169, 162),
    accentAmount: 0.5,
    soil: srgb(94, 80, 64),
    rock: srgb(134, 130, 124),
    rockiness: 0.56,
  },
  // badlands
  {
    cover: srgb(142, 98, 68),
    dry: srgb(170, 122, 80),
    accent: srgb(104, 66, 52),
    accentAmount: 0.5,
    soil: srgb(148, 104, 72),
    rock: srgb(158, 114, 86),
    rockiness: 0.82,
  },
];

/** Lichen and dead turf, above the tree line and below the snow. */
const ALPINE = srgb(156, 176, 180);
const SNOW = srgb(246, 236, 216);
/** River shingle: rounded, pale, and always a little damp. */
const SHINGLE = srgb(180, 167, 148);

// ---------------------------------------------------------------------------
// Biome weight lattice
// ---------------------------------------------------------------------------

/**
 * `biomeWeights()` allocates an object per call and walks fourteen regions.
 * At eighty thousand vertices that is eighty thousand short-lived objects and
 * a million distance tests, for a field whose smallest feature is a region
 * border a good fifteen metres wide.
 *
 * So it is sampled once onto a five-metre lattice and read back bilinearly.
 * Same picture, a fiftieth of the work, and — because the lattice is built once
 * at module scope — free on every rebuild after the first.
 */
const LATTICE_STEP = 5;
const LATTICE_N = Math.round(WORLD_SIZE / LATTICE_STEP) + 1;

let biomeLattice: Float32Array | null = null;

function getBiomeLattice(): Float32Array {
  if (biomeLattice) return biomeLattice;
  const data = new Float32Array(LATTICE_N * LATTICE_N * BIOME_COUNT);
  const half = WORLD_SIZE / 2;
  for (let j = 0; j < LATTICE_N; j++) {
    const z = -half + j * LATTICE_STEP;
    for (let i = 0; i < LATTICE_N; i++) {
      const x = -half + i * LATTICE_STEP;
      const weights = biomeWeights(x, z);
      const base = (j * LATTICE_N + i) * BIOME_COUNT;
      for (let b = 0; b < BIOME_COUNT; b++) {
        data[base + b] = weights[BIOME_ORDER[b]] ?? 0;
      }
    }
  }
  biomeLattice = data;
  return data;
}

const weightScratch = new Float32Array(BIOME_COUNT);

function sampleBiome(x: number, z: number, out: Float32Array) {
  const lattice = getBiomeLattice();
  const half = WORLD_SIZE / 2;
  const fx = (x + half) / LATTICE_STEP;
  const fz = (z + half) / LATTICE_STEP;

  // Clamped rather than wrapped: the apron reaches well past the world edge and
  // should keep the character of the border it grew out of.
  let i0 = Math.floor(fx);
  let j0 = Math.floor(fz);
  i0 = i0 < 0 ? 0 : i0 > LATTICE_N - 2 ? LATTICE_N - 2 : i0;
  j0 = j0 < 0 ? 0 : j0 > LATTICE_N - 2 ? LATTICE_N - 2 : j0;
  const tx = clamp01(fx - i0);
  const tz = clamp01(fz - j0);

  const a = (j0 * LATTICE_N + i0) * BIOME_COUNT;
  const b = (j0 * LATTICE_N + i0 + 1) * BIOME_COUNT;
  const c = ((j0 + 1) * LATTICE_N + i0) * BIOME_COUNT;
  const d = ((j0 + 1) * LATTICE_N + i0 + 1) * BIOME_COUNT;

  const w00 = (1 - tx) * (1 - tz);
  const w10 = tx * (1 - tz);
  const w01 = (1 - tx) * tz;
  const w11 = tx * tz;

  for (let k = 0; k < BIOME_COUNT; k++) {
    out[k] =
      lattice[a + k] * w00 +
      lattice[b + k] * w10 +
      lattice[c + k] * w01 +
      lattice[d + k] * w11;
  }
}

// ---------------------------------------------------------------------------
// River proximity
// ---------------------------------------------------------------------------

/**
 * Distance to the nearest watercourse, out to `RIVER_REACH` metres.
 *
 * `terrain.ts` keeps its own river index but doesn't publish a distance query,
 * and the banks need one: a river with no shingle, no wet margin and no change
 * of ground either side is a blue ribbon lying on grass. Registering each
 * sample into its own cell *and its eight neighbours* is what makes a query one
 * bucket read with no ring search.
 */
const RIVER_REACH = 16;

let riverBuckets: Map<number, Float64Array> | null = null;

function getRiverBuckets(): Map<number, Float64Array> {
  if (riverBuckets) return riverBuckets;

  const raw = new Map<number, number[]>();
  for (const river of RIVERS) {
    const divisions = Math.max(8, Math.round(river.getLength() / 5));
    const points = river.getSpacedPoints(divisions);
    for (const point of points) {
      const cx = Math.floor(point.x / RIVER_REACH);
      const cz = Math.floor(point.z / RIVER_REACH);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const key = (cx + ox + 4096) * 8192 + (cz + oz + 4096);
          const bucket = raw.get(key);
          if (bucket) bucket.push(point.x, point.z);
          else raw.set(key, [point.x, point.z]);
        }
      }
    }
  }

  riverBuckets = new Map();
  for (const [key, list] of raw) riverBuckets.set(key, Float64Array.from(list));
  return riverBuckets;
}

function distanceToRiver(x: number, z: number): number {
  const key =
    (Math.floor(x / RIVER_REACH) + 4096) * 8192 +
    (Math.floor(z / RIVER_REACH) + 4096);
  const bucket = getRiverBuckets().get(key);
  if (!bucket) return RIVER_REACH;

  let best = RIVER_REACH * RIVER_REACH;
  for (let i = 0; i < bucket.length; i += 2) {
    const dx = x - bucket[i];
    const dz = z - bucket[i + 1];
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Distance out to the nearest standing water's edge; negative inside it. */
function distanceToWaterEdge(x: number, z: number): number {
  let best = Infinity;
  for (const water of WATERS) {
    const gap = Math.hypot(x - water.x, z - water.z) - water.radius;
    if (gap < best) best = gap;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/**
 * The result of painting one vertex: a colour, plus the four surface weights
 * the shader needs to know which detail maps to blend and how wet the ground is.
 */
type Paint = {
  r: number;
  g: number;
  b: number;
  rock: number;
  sand: number;
  snow: number;
  wet: number;
};

const paintOut: Paint = { r: 0, g: 0, b: 0, rock: 0, sand: 0, snow: 0, wet: 0 };

function paint(
  x: number,
  z: number,
  y: number,
  slope: number,
  /** (height - mean of the four neighbours) / cell², a scale-free concavity. */
  concavity: number,
  out: Paint
) {
  sampleBiome(x, z, weightScratch);

  // Three scales, deliberately far apart. Two adjacent scales average into one
  // flat tone across a hillside; it takes a twelve-metre, a fifty-metre and a
  // two-hundred-metre term before ground stops looking like a single wash at
  // every viewing distance at once.
  const fine = fbm(x * 0.085 + 7, z * 0.085 + 7, 3);
  const mid = fbm(x * 0.019 + 300, z * 0.019 + 300, 3);
  const broad = fbm(x * 0.0047 + 900, z * 0.0047 + 900, 3);

  const dryness = smoothstep(0.44, 0.86, broad * 0.55 + mid * 0.32 + fine * 0.13);
  const accentT = smoothstep(0.38, 0.78, mid * 0.62 + fine * 0.38);

  let cr = 0;
  let cg = 0;
  let cb = 0;
  let rr = 0;
  let rg = 0;
  let rb = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let rockiness = 0;
  let total = 0;

  for (let i = 0; i < BIOME_COUNT; i++) {
    const w = weightScratch[i];
    // Below one percent a biome contributes less than a rounding error to the
    // colour but still costs the full blend. Three or four biomes are live at
    // any point; the other six are why this test is here.
    if (w < 0.01) continue;
    const p = PALETTES[i];
    const a = p.accentAmount * accentT;

    let tr = p.cover[0] + (p.dry[0] - p.cover[0]) * dryness;
    let tg = p.cover[1] + (p.dry[1] - p.cover[1]) * dryness;
    let tb = p.cover[2] + (p.dry[2] - p.cover[2]) * dryness;
    tr += (p.accent[0] - tr) * a;
    tg += (p.accent[1] - tg) * a;
    tb += (p.accent[2] - tb) * a;

    cr += tr * w;
    cg += tg * w;
    cb += tb * w;
    rr += p.rock[0] * w;
    rg += p.rock[1] * w;
    rb += p.rock[2] * w;
    sr += p.soil[0] * w;
    sg += p.soil[1] * w;
    sb += p.soil[2] * w;
    rockiness += p.rockiness * w;
    total += w;
  }

  // Renormalise: the sub-one-percent biomes were skipped, so the weights that
  // survived no longer sum to one and the colour would come out fractionally
  // dark without this.
  if (total > 1e-4) {
    const k = 1 / total;
    cr *= k;
    cg *= k;
    cb *= k;
    rr *= k;
    rg *= k;
    rb *= k;
    sr *= k;
    sg *= k;
    sb *= k;
    rockiness *= k;
  }

  // --- bare rock ---------------------------------------------------------
  // Noise on the threshold keeps the boundary ragged instead of a contour line,
  // and the biome's own rockiness decides how eagerly it gives way: the same
  // gradient is turf on the moor and scree in the badlands.
  const rockCut = 0.2 + fine * 0.18 - rockiness * 0.14;
  const rock = clamp01(
    smoothstep(rockCut, rockCut + 0.26, slope) * (0.45 + rockiness * 0.85)
  );
  cr += (rr - cr) * rock;
  cg += (rg - cg) * rock;
  cb += (rb - cb) * rock;

  // --- above the tree line ----------------------------------------------
  if (y > TREE_LINE) {
    const bleach = smoothstep(TREE_LINE, SNOW_LINE, y) * 0.6;
    cr += (ALPINE[0] - cr) * bleach;
    cg += (ALPINE[1] - cg) * bleach;
    cb += (ALPINE[2] - cb) * bleach;
  }

  // --- snow --------------------------------------------------------------
  // Only where it could actually settle: a cliff face sheds it.
  let snow = 0;
  const snowCut = SNOW_LINE - 16 + fine * 26;
  if (y > snowCut) {
    snow = clamp01((y - snowCut) / 16) * clamp01(1 - slope * 1.6);
    const t = snow * 0.95;
    cr += (SNOW[0] - cr) * t;
    cg += (SNOW[1] - cg) * t;
    cb += (SNOW[2] - cb) * t;
  }

  // --- shoreline ---------------------------------------------------------
  // Gated on proximity to a body of water, not on height alone. The roads are
  // clamped to just above the waterline so they never flood, which means a
  // purely height-based shore test paints the entire road corridor — and every
  // low-lying meadow in the valley — as beach.
  let sand = 0;
  let wet = 0;
  const above = y - WATER_LEVEL;
  const waterGap = distanceToWaterEdge(x, z);
  if (waterGap < 30) {
    const near = 1 - clamp01((waterGap - 1) / (11 + fine * 15));
    const low = 1 - clamp01((above - 0.2) / (2.3 + fine * 1.8));
    sand = clamp01(near * low);
    // Sand is the shore's own soil colour, which is why `shore` carries a pale
    // one — this is not a global beach colour stamped over every biome.
    cr += (sr - cr) * sand * 0.92;
    cg += (sg - cg) * sand * 0.92;
    cb += (sb - cb) * sand * 0.92;

    wet = clamp01(1 - above / 1.2) * clamp01(1 - waterGap / 15);
  }

  // --- river banks -------------------------------------------------------
  // Distance to the channel alone, with no height test: watercourses here run
  // from the snowline to the mere, so "close to the waterline" means nothing
  // eight hundred metres up a mountain, and "close to the water" means
  // everything everywhere.
  const riverGap = distanceToRiver(x, z);
  if (riverGap < 13) {
    const shingle = clamp01(1 - (riverGap - 2.5) / 9);
    const t = shingle * 0.72;
    cr += (SHINGLE[0] - cr) * t;
    cg += (SHINGLE[1] - cg) * t;
    cb += (SHINGLE[2] - cb) * t;
    wet = Math.max(wet, clamp01((shingle - 0.55) * 2.4));
  }

  // --- the road ----------------------------------------------------------
  // Worn down to bare earth by everyone who walked it before him. The exponent
  // above 1 keeps the verge green right up to the wheel ruts: a linear falloff
  // bleeds dirt far out into the grass and leaves the track looking like a wide
  // bald scar rather than a path.
  const roadGap = distanceToRoad(x, z);
  const roadEdge = ROAD_HALF_WIDTH + 1.1 + fine * 1.5;
  let road = 0;
  if (roadGap < roadEdge) {
    road = Math.pow(1 - roadGap / roadEdge, 1.5);
    cr += (sr - cr) * road;
    cg += (sg - cg) * road;
    cb += (sb - cb) * road;
    snow *= 1 - road * 0.85;
    sand *= 1 - road;
  }

  // --- wet ground is dark ground -----------------------------------------
  if (wet > 0) {
    const darken = 1 - wet * 0.42;
    cr *= darken;
    cg *= darken;
    cb *= darken;
  }

  // --- cheap ambient occlusion -------------------------------------------
  // Hollows collect shadow and ridges catch light. The height grid is already
  // in hand when this runs, so the concavity costs nothing, and dividing by the
  // cell size squared makes the figure a real curvature rather than something
  // that gets stronger every time a chunk drops an LOD level.
  const relief = 1 + Math.max(-0.55, Math.min(0.35, concavity * 9)) * 0.3;
  out.r = cr * relief;
  out.g = cg * relief;
  out.b = cb * relief;

  out.rock = Math.max(rock, road * 0.4, clamp01((riverGap < 13 ? 1 - riverGap / 13 : 0) * 0.5));
  out.sand = sand;
  out.snow = snow;
  out.wet = wet;
}

// ---------------------------------------------------------------------------
// Chunk planning
// ---------------------------------------------------------------------------

/**
 * Which chunks deserve the vertices.
 *
 * Ranking by distance to the road network rather than by anything intrinsic to
 * the terrain is the whole trick: the camera follows a bard who walks roads, so
 * "near a road" and "somewhere a human will ever stand" are the same set.
 * Shorelines and riverbanks are folded in at a discount because they are the
 * two places where a coarse mesh visibly lies about where the water ends.
 */
function planChunkLevels(
  chunks: number,
  chunkSize: number,
  nearCount: number,
  midCount: number
): Uint8Array {
  const half = WORLD_SIZE / 2;
  const scores = new Float64Array(chunks * chunks);

  // Five probes: the centre and the four quadrant midpoints. A single centre
  // probe misses a road that clips a corner, which at 32 metres a chunk is a
  // third of them.
  const offsets: Array<[number, number]> = [
    [0.5, 0.5],
    [0.22, 0.22],
    [0.78, 0.22],
    [0.22, 0.78],
    [0.78, 0.78],
  ];

  for (let j = 0; j < chunks; j++) {
    for (let i = 0; i < chunks; i++) {
      let best = Infinity;
      for (const [ox, oz] of offsets) {
        const x = -half + (i + ox) * chunkSize;
        const z = -half + (j + oz) * chunkSize;

        // `distanceToRoad` is exact to thirty metres and returns a sentinel
        // beyond, so it settles every chunk a road actually touches without a
        // scan. Only the ones it gives up on pay for the exact query.
        let road = distanceToRoad(x, z);
        if (road > 100) {
          const point = nearestRoadPoint(x, z);
          road = Math.hypot(x - point.x, z - point.z);
        }

        const shore = Math.abs(distanceToWaterEdge(x, z)) * 1.5;
        const bank = distanceToRiver(x, z) * 2.2;
        const score = Math.min(road, shore, bank);
        if (score < best) best = score;
      }
      scores[j * chunks + i] = best;
    }
  }

  const order = Array.from({ length: chunks * chunks }, (_, i) => i);
  order.sort((a, b) => scores[a] - scores[b]);

  const levels = new Uint8Array(chunks * chunks).fill(2);
  for (let k = 0; k < order.length; k++) {
    if (k < nearCount) levels[order[k]] = 0;
    else if (k < nearCount + midCount) levels[order[k]] = 1;
  }

  // Restriction pass. Two chunks whose resolutions differ by more than 2:1
  // cannot be stitched by snapping one edge onto the other without visibly
  // flattening it, so a fine chunk pulls any far neighbour up to the middle
  // level. Levels only ever decrease here, so this terminates.
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let j = 0; j < chunks; j++) {
      for (let i = 0; i < chunks; i++) {
        const here = levels[j * chunks + i];
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as Array<[number, number]>) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= chunks || nj >= chunks) continue;
          const index = nj * chunks + ni;
          if (levels[index] > here + 1) {
            levels[index] = here + 1;
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  return levels;
}

// ---------------------------------------------------------------------------
// Chunk geometry
// ---------------------------------------------------------------------------

/**
 * One chunk of ground.
 *
 * Normals come from the height grid by central difference rather than from four
 * extra `heightAt` calls per vertex. That is a five-fold saving on the single
 * most expensive thing this file does, and the result is *better*, not merely
 * cheaper: a normal derived from the grid is the true normal of the triangles
 * actually being drawn, where an analytic one at a different epsilon disagrees
 * with the silhouette by a little everywhere.
 *
 * `neighbours` is the segment count of the chunk across each edge, in the order
 * -X, +X, -Z, +Z. Where one is coarser, the shared edge is snapped onto the
 * coarser sampling — the fine vertices at even indices *are* the coarse
 * vertices, so interpolating between them reproduces the neighbour's edge to
 * the bit, and the T-junction crack closes exactly with no skirt to hide it.
 */
function buildChunkGeometry(
  x0: number,
  z0: number,
  size: number,
  n: number,
  neighbours: [number, number, number, number],
  detailTile: number
): THREE.BufferGeometry {
  const stride = n + 3;
  const heights = new Float64Array(stride * stride);
  const cell = size / n;

  for (let j = -1; j <= n + 1; j++) {
    const z = z0 + (j / n) * size;
    for (let i = -1; i <= n + 1; i++) {
      const x = x0 + (i / n) * size;
      heights[(j + 1) * stride + (i + 1)] = heightAt(x, z);
    }
  }

  const at = (i: number, j: number) => heights[(j + 1) * stride + (i + 1)];
  const set = (i: number, j: number, value: number) => {
    heights[(j + 1) * stride + (i + 1)] = value;
  };

  const snapEdge = (
    nb: number,
    read: (k: number) => number,
    write: (k: number, value: number) => void
  ) => {
    if (nb >= n) return;
    const step = n / nb;
    if (!Number.isInteger(step)) return;
    for (let k = 0; k <= n; k++) {
      if (k % step === 0) continue;
      const k0 = Math.floor(k / step) * step;
      const t = (k - k0) / step;
      write(k, read(k0) + (read(k0 + step) - read(k0)) * t);
    }
  };

  snapEdge(neighbours[0], (k) => at(0, k), (k, v) => set(0, k, v));
  snapEdge(neighbours[1], (k) => at(n, k), (k, v) => set(n, k, v));
  snapEdge(neighbours[2], (k) => at(k, 0), (k, v) => set(k, 0, v));
  snapEdge(neighbours[3], (k) => at(k, n), (k, v) => set(k, n, v));

  const count = (n + 1) * (n + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const splat = new Float32Array(count * 4);
  const uvs = new Float32Array(count * 2);

  for (let j = 0; j <= n; j++) {
    const z = z0 + (j / n) * size;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (i / n) * size;
      const index = j * (n + 1) + i;

      const y = at(i, j);
      const west = at(i - 1, j);
      const east = at(i + 1, j);
      const south = at(i, j - 1);
      const north = at(i, j + 1);

      let nx = west - east;
      const ny = 2 * cell;
      let nz = south - north;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      nz /= length;

      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      normals[index * 3] = nx;
      normals[index * 3 + 1] = ny / length;
      normals[index * 3 + 2] = nz;

      // World-space UVs, so the detail maps tile at a fixed metre pitch no
      // matter what resolution the chunk under them happens to be. A per-chunk
      // 0..1 UV would make the ground texture four times finer in every near
      // chunk, and the seam between two LOD levels would be a change of scale.
      uvs[index * 2] = x / detailTile;
      uvs[index * 2 + 1] = z / detailTile;

      const concavity = (y - (west + east + south + north) * 0.25) / (cell * cell);
      paint(x, z, y, 1 - ny / length, concavity, paintOut);

      colors[index * 3] = paintOut.r;
      colors[index * 3 + 1] = paintOut.g;
      colors[index * 3 + 2] = paintOut.b;
      splat[index * 4] = paintOut.rock;
      splat[index * 4 + 1] = paintOut.sand;
      splat[index * 4 + 2] = paintOut.snow;
      splat[index * 4 + 3] = paintOut.wet;
    }
  }

  const indices = new Uint16Array(n * n * 6);
  let cursor = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + (n + 1);
      const d = c + 1;
      // Wound so the face normal points up: (a, c, b) rather than (a, b, c),
      // which is back-facing for a grid laid out +X across and +Z down.
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSplat", new THREE.BufferAttribute(splat, 4));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// The apron
// ---------------------------------------------------------------------------

/**
 * Land beyond the edge of the world.
 *
 * The mountain rim tops out around 300 metres from the centre and the mesh stops
 * at 320, which from anywhere on the valley floor means the horizon is a clean
 * straight cut with sky under it. This is the same height function carried out
 * to 560 metres on a coarse ring — no extra rules, so the ranges genuinely
 * continue rather than being faked.
 *
 * The first two rings sit at the same extent — exactly on the world edge — with
 * the first sunk seven and a half metres, which makes the quad between them a
 * vertical curtain hanging below the boundary. Two meshes sampled at different
 * spacings cannot meet on a line without a crack somewhere, and the curtain is
 * what a crack opens onto: more mountain, rather than a slot of sky. It is
 * hidden under the terrain everywhere the two do line up, which is almost
 * everywhere.
 */
const APRON_RINGS = [320, 320, 338, 376, 434, 492, 560];
const APRON_SINK = [7.5, 0, 0, 0, 0, 0, 0];
/** Around 5 metres a step at the inner ring, matching the boundary chunks. */
const APRON_AROUND = 512;

function squarePerimeter(extent: number, s: number): [number, number] {
  const side = Math.floor(s);
  const t = s - side;
  const span = extent * 2;
  if (side === 0) return [-extent + span * t, -extent];
  if (side === 1) return [extent, -extent + span * t];
  if (side === 2) return [extent - span * t, extent];
  return [-extent, extent - span * t];
}

function buildApronGeometry(detailTile: number): THREE.BufferGeometry {
  const rings = APRON_RINGS.length;
  const count = rings * APRON_AROUND;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const splat = new Float32Array(count * 4);
  const uvs = new Float32Array(count * 2);

  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < APRON_AROUND; k++) {
      const [x, z] = squarePerimeter(APRON_RINGS[r], (k / APRON_AROUND) * 4);
      const index = r * APRON_AROUND + k;
      const y = heightAt(x, z) - APRON_SINK[r];

      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;

      // Sampled far enough apart to be a slope over the ring spacing rather
      // than over a metre — at this distance the fine relief is below a pixel
      // and all a tight epsilon buys is noise in the lighting.
      const e = 9;
      const nx = heightAt(x - e, z) - heightAt(x + e, z);
      const nz = heightAt(x, z - e) - heightAt(x, z + e);
      const ny = 2 * e;
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[index * 3] = nx / length;
      normals[index * 3 + 1] = ny / length;
      normals[index * 3 + 2] = nz / length;

      uvs[index * 2] = x / detailTile;
      uvs[index * 2 + 1] = z / detailTile;

      paint(x, z, y, 1 - ny / length, 0, paintOut);

      // Everything out here is background. Pulling it toward a cool grey with
      // distance is aerial perspective done in vertex colour, which costs
      // nothing and stops the far ranges competing with the valley for
      // attention.
      const haze = clamp01((Math.max(Math.abs(x), Math.abs(z)) - 300) / 260) * 0.55;
      colors[index * 3] = paintOut.r + (0.34 - paintOut.r) * haze;
      colors[index * 3 + 1] = paintOut.g + (0.4 - paintOut.g) * haze;
      colors[index * 3 + 2] = paintOut.b + (0.52 - paintOut.b) * haze;
      splat[index * 4] = paintOut.rock;
      splat[index * 4 + 1] = paintOut.sand;
      splat[index * 4 + 2] = paintOut.snow;
      splat[index * 4 + 3] = 0;
    }
  }

  const indices = new Uint32Array((rings - 1) * APRON_AROUND * 6);
  let cursor = 0;
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < APRON_AROUND; k++) {
      const next = (k + 1) % APRON_AROUND;
      const a = r * APRON_AROUND + k;
      const b = r * APRON_AROUND + next;
      const c = (r + 1) * APRON_AROUND + k;
      const d = (r + 1) * APRON_AROUND + next;
      // Wound the opposite way round from a terrain chunk, because "outward"
      // here runs anticlockwise around the square rather than along +Z. The
      // same order also leaves the inner curtain facing into the valley, which
      // is the only direction it is ever seen from.
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = d;
      indices[cursor++] = c;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSplat", new THREE.BufferAttribute(splat, 4));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

/**
 * One material for every chunk, so the whole terrain is a single shader
 * program and a single set of texture bindings no matter how many meshes it is
 * cut into.
 *
 * The surgery on the standard shader buys three things geometry cannot:
 *
 *  - A second sample of the detail map at a hundred-metre pitch. The loudest
 *    tell of a tiled ground texture is not the texture, it is the *period*, and
 *    a non-harmonic second scale destroys the period without adding a pattern
 *    of its own.
 *  - A rock relief map blended in by the splat weight, so a scree slope has
 *    fractures across it and the meadow twenty metres away still has grass
 *    fibre. One normal map for the whole world is what makes procedural terrain
 *    read as one material painted different colours.
 *  - Fine relief fading out with distance. Past a hundred metres a two-
 *    centimetre bump is far smaller than a pixel, and all it can do there is
 *    alias into a shimmer as the camera moves.
 */
function makeTerrainMaterial(surfaces: TerrainSurfaces): THREE.MeshStandardMaterial {
  surfaces.map.wrapS = surfaces.map.wrapT = THREE.RepeatWrapping;
  surfaces.map.repeat.set(1, 1);
  surfaces.normalMap.repeat.set(1, 1);
  // Deliberately not a whole number relative to the others: three maps tiling
  // in lockstep make one composite pattern with one obvious period.
  surfaces.roughnessMap.repeat.set(0.61, 0.61);

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: surfaces.map,
    normalMap: surfaces.normalMap,
    normalScale: new THREE.Vector2(1.3, 1.3),
    roughnessMap: surfaces.roughnessMap,
    roughness: 1,
    metalness: 0,
    // Banding is very visible across the large, gently graded areas this
    // terrain is mostly made of.
    dithering: true,
  });

  const extra = {
    uRockNormal: { value: surfaces.rockNormalMap },
    uMacro: { value: surfaces.macroMap },
    /**
     * Reciprocal of the macro variation map's period, in metres.
     *
     * Larger than the valley on purpose. This used to be `detailTile / 118`
     * against the mesh UV, which put a 118-metre period on the one texture
     * whose whole job is to *stop* things repeating — and 118 metres fits into
     * a 640-metre world more than five times, so every distant ridge wore the
     * same blotches over and over. Stretched past the size of the world it
     * cannot repeat inside it at all.
     */
    uMacroScale: { value: 1 / 863 },
    uRockScale: { value: surfaces.detailTile / 1.7 },
    // Where the fine surface stops being worth drawing. Pushed well out: the
    // detail tiles every three metres, so at a hundred metres it is still
    // ninety pixels across and mipmapping has the aliasing covered. Fading it
    // at fifty — the instinct — flattens the entire middle distance, which is
    // most of what the camera looks at.
    uDetailFade: { value: new THREE.Vector2(95, 300) },
    // Aerial perspective. See the fog injection below for why these exist.
    // Seeded from the palette, then driven by the day/night cycle every frame —
    // see `AerialPerspective` below. The initial values are the ones the fog
    // was tuned against, and they are what the very first frame draws with.
    uSunDir: { value: new THREE.Vector3(...ghibliSunDirection()).normalize() },
    uHaze: { value: new THREE.Color(GHIBLI.haze).convertSRGBToLinear() },
    uHazeSun: { value: new THREE.Color(GHIBLI.skyHorizonSun).convertSRGBToLinear() },
    uMist: { value: new THREE.Color(GHIBLI.mist).convertSRGBToLinear() },
  };

  // `onBeforeCompile` assigns these uniform objects into the compiled shader by
  // reference, so whoever holds `extra` holds the live uniforms. Parking it on
  // the material is how the cycle reaches them without this function having to
  // return a second value that every caller would then have to thread through.
  material.userData.aerial = extra;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, extra);

    // `String.replace` returns the original string when the pattern is absent,
    // so a renamed shader chunk removes a feature silently and completely.
    // These are the chunks this material rewrites; losing one is invisible in
    // the render and would otherwise only show up as "the fog isn't working".
    if (process.env.NODE_ENV !== "production") {
      for (const chunk of [
        "#include <map_fragment>",
        "#include <roughnessmap_fragment>",
        "#include <normal_fragment_maps>",
        "#include <fog_fragment>",
      ]) {
        if (!shader.fragmentShader.includes(chunk)) {
          console.warn(`[punaab] terrain shader: missing ${chunk} — that override did not apply`);
        }
      }
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute vec4 aSplat;
         varying vec4 vSplat;
         varying vec3 vWorldPos;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vSplat = aSplat;
         // World position, for the height-dependent haze in the fragment stage.
         vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec4 vSplat;
         varying vec3 vWorldPos;
         uniform vec3 uSunDir;
         uniform vec3 uHaze;
         uniform vec3 uHazeSun;
         uniform vec3 uMist;
         uniform sampler2D uRockNormal;
         uniform sampler2D uMacro;
         uniform float uMacroScale;
         uniform float uRockScale;
         uniform vec2 uDetailFade;

         // --- Detail tile breaking -----------------------------------------
         //
         // Every detail layer here repeats every couple of metres, which is
         // right underfoot and disastrous on a mountainside: a single slope
         // fills the screen with fifty copies of the same two-metre patch and
         // the eye reads the repeat instantly as a woven pattern. The ground
         // textures make it worse by design — their fibre layer is squashed to
         // 0.3 in Y to give grass and cart ruts a lateral grain, so what tiles
         // is directional streaks rather than neutral noise.
         //
         // The fix is to sample the same texture a second time, rotated and at
         // a different pitch, and cross-fade between them. Two lattices at an
         // oblique angle never realign, so no seam repeats. Fading rather than
         // averaging is the important part: where the weight is near 0 or 1 you
         // see one crisp sample, not a mush of both, so close ground keeps its
         // bite.
         const mat2 detailTurn = mat2( 0.6, -0.8, 0.8, 0.6 );
         // Inverse of the above. GLSL ES has no transpose(), and a normal
         // sampled through a rotated lookup has to have its tangent-space X/Y
         // turned back or its bumps catch the light from the wrong side.
         const mat2 detailUnturn = mat2( 0.6, 0.8, -0.8, 0.6 );
         const float DETAIL_PITCH = 0.53;

         // Which of the two rotations shows. Deliberately low frequency: this
         // decides *which* sample wins, so if it varied quickly the two would
         // blend into porridge everywhere instead of alternating in patches.
         float detailBlend( vec2 worldXZ ) {
           vec3 m = texture2D( uMacro, worldXZ * uMacroScale * 1.9 + 0.61 ).rgb;
           return smoothstep( 0.84, 1.16, m.g );
         }`
      )
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
           float surfaceFade = 1.0 - smoothstep( uDetailFade.x, uDetailFade.y, length( vViewPosition ) );

           float tileBlend = detailBlend( vWorldPos.xz );
           vec3 detailTexel = mix(
             texture2D( map, vMapUv ).rgb,
             texture2D( map, detailTurn * vMapUv * DETAIL_PITCH + 0.29 ).rgb,
             tileBlend
           ) * 1.06;

           // --- Large-scale variation -------------------------------------
           //
           // This is the whole of what a distant mountain is made of. Past the
           // detail fade the fine texture is gone, the relief normals are
           // gone, and if this term repeats then every ridge in the valley
           // wears an identical pattern — which is exactly what a 118-metre
           // period did in a 640-metre world.
           //
           // Two samples, and the second one is *rotated*. Scaling alone is not
           // enough: two axis-aligned lattices always share the same grid
           // direction, so their beats line up into visible bands however
           // carefully the periods are chosen. Turned obliquely against each
           // other they never come back into alignment, so the product has no
           // period a viewer can find inside this world.
           //
           // Sampled in world space rather than mesh UV so the pattern is a
           // property of the *valley*, and cannot shift when a chunk's UV
           // scaling changes with its level of detail.
           mat2 macroTurn = mat2( 0.8, -0.6, 0.6, 0.8 );
           vec2 macroUv = vWorldPos.xz * uMacroScale;
           vec3 macroBroad = texture2D( uMacro, macroUv ).rgb;
           vec3 macroFine = texture2D( uMacro, macroTurn * macroUv * 2.77 + 0.31 ).rgb;
           vec3 macroTexel = macroBroad * mix( vec3( 1.0 ), macroFine, 0.55 );

           // Push the large scale harder as the fine detail leaves, so distance
           // reads as broad shifts of ground colour — a hillside that is drier
           // here and greener there — instead of an even wash. This is the part
           // that makes far terrain look deliberately simplified rather than
           // badly resolved.
           macroTexel = mix( vec3( 1.0 ), macroTexel, 1.0 + ( 1.0 - surfaceFade ) * 0.45 );

           vec3 mottle = mix( vec3( 1.0 ), detailTexel, surfaceFade );
           // Sand has no fibre in it and snow has no structure at all, so the
           // grass mottling is faded out of both rather than tinting them.
           mottle = mix( mottle, vec3( 1.0 ), max( vSplat.y * 0.45, vSplat.z * 0.8 ) );
           diffuseColor.rgb *= mottle * macroTexel;
         #endif`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
         roughnessFactor = mix( roughnessFactor, 0.88, vSplat.x * 0.45 );
         roughnessFactor = mix( roughnessFactor, 0.6, vSplat.z * 0.8 );
         // Wet ground is the only genuinely smooth surface in the valley, and
         // the sheen on it is most of what sells a shoreline.
         roughnessFactor = mix( roughnessFactor, 0.11, vSplat.w );

         // The roughness map tiles every five metres, and five metres is still
         // twenty-odd pixels across on a ridge three hundred metres out — close
         // enough to read as a repeating pattern of glints crawling over the
         // mountains. The colour detail already fades over this range; this
         // never did, which left the specular tiling on its own out there.
         //
         // Recomputed here rather than reusing the fade from the map block,
         // which only exists when the material has a colour map. Distance
         // shading should not quietly depend on that.
         float glintFade = 1.0 - smoothstep( uDetailFade.x, uDetailFade.y, length( vViewPosition ) );
         // Toward fully matte, because a far hillside has no highlights on it.
         roughnessFactor = mix( 1.0, roughnessFactor, glintFade );`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#ifdef USE_NORMALMAP_TANGENTSPACE
           float reliefFade = 1.0 - smoothstep( uDetailFade.x, uDetailFade.y, length( vViewPosition ) );

           // Same two-rotation trick as the colour, and it matters most here.
           // Shading is what the eye actually reads the repeat *in* — and at
           // night, with the sun down and the ground lit almost entirely by
           // flat hemisphere light, these bumps are the only variation left on
           // a hillside, so their tiling has nothing to hide behind.
           //
           // The rock layer gets it too, and is the one that counts on a
           // mountain: a slope is mostly rock, so vSplat.x is high there and
           // the rock normal — the fastest-repeating layer of the three, at
           // under two metres — is what dominates that surface.
           float nBlend = detailBlend( vWorldPos.xz );
           vec2 turnedNormalUv = detailTurn * vNormalMapUv * DETAIL_PITCH + 0.29;

           vec3 soilA = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
           vec3 soilB = texture2D( normalMap, turnedNormalUv ).xyz * 2.0 - 1.0;
           soilB.xy = detailUnturn * soilB.xy;

           vec3 rockA = texture2D( uRockNormal, vNormalMapUv * uRockScale ).xyz * 2.0 - 1.0;
           vec3 rockB = texture2D( uRockNormal, turnedNormalUv * uRockScale ).xyz * 2.0 - 1.0;
           rockB.xy = detailUnturn * rockB.xy;

           vec3 mapN = mix( soilA, soilB, nBlend );
           vec3 rockN = mix( rockA, rockB, nBlend );
           mapN = mix( mapN, rockN, vSplat.x );
           float relief = reliefFade
             * mix( 1.0, 0.4, vSplat.y )
             * ( 1.0 - vSplat.z * 0.55 )
             * ( 1.0 - vSplat.w * 0.5 );
           mapN.xy *= normalScale * relief;
           normal = normalize( tbn * mapN );
         #endif`
      )
      .replace(
        "#include <fog_fragment>",
        `{
           // --- Aerial perspective ------------------------------------------
           //
           // Deliberately NOT wrapped in an ifdef on three's own USE_FOG.
           // This replaces three's fog rather than extending it, so gating it
           // on that define means the whole effect silently compiles to
           // nothing whenever scene.fog is null or fails to attach — which is
           // invisible in the render and indistinguishable from "the fog isn't
           // working".
           //
           // Replaces three's uniform exponential fog, which is the reason the
           // far mountains read as a strange flat texture: uniform fog whitens
           // a peak and its own foot by exactly the same amount, so a mountain
           // arrives as one even wash with high-frequency detail still crawling
           // across it. Nothing about that says "twelve kilometres away".
           //
           // Real distance haze is a column of air, so it depends on how much
           // atmosphere the sightline passes through — which means it thins
           // with altitude. Making the fog height-dependent is what separates a
           // ridge from the valley it stands in: the base of every massif sinks
           // into haze while the summit stays legible above it, and the eye
           // reads depth instead of texture.
           float aerialDist = length( vViewPosition );

           // Air thins upward. The exponent is a scale height, not a taste
           // value — it is what makes high ground clear and low ground milky.
           float airDensity = mix(
             1.0,
             exp( -max( vWorldPos.y - 4.0, 0.0 ) / 48.0 ),
             0.78
           );

           float haze = 1.0 - exp(
             -pow( max( aerialDist - 30.0, 0.0 ) / 430.0, 1.2 ) * 2.7 * airDensity
           );

           // Mie forward scatter: haze looking toward the sun is warm and
           // bright, away from it cool. A single grey fog colour is the other
           // half of why distance reads as flat.
           vec3 viewDir = normalize( vWorldPos - cameraPosition );
           float towardSun = max( dot( -viewDir, uSunDir ), 0.0 );
           vec3 hazeColor = mix( uHaze, uHazeSun, pow( towardSun, 2.6 ) * 0.85 );

           // Mist pooling. Settles in the low ground and only at distance, so
           // the valley floor between here and a far massif fills in and the
           // mountain's feet are lost in it — which is the specific thing that
           // makes a range sit *behind* the land rather than on top of it.
           float pool = smoothstep( 52.0, 4.0, vWorldPos.y )
                      * smoothstep( 60.0, 260.0, aerialDist );
           hazeColor = mix( hazeColor, uMist, pool * 0.7 );
           haze = clamp( haze + pool * 0.30, 0.0, 1.0 );

           gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeColor, haze );
         }`
      );
  };

  // Every chunk shares this material instance, but three keys its program cache
  // on the compiled source; a stable key keeps the whole terrain on one program.
  material.customProgramCacheKey = () => "punaab-terrain-v5-tilebreak";

  return material;
}

// ---------------------------------------------------------------------------

/**
 * `segments` is kept because it is what existing callers pass. Handing the whole
 * budget in is better — it is the only way the chunk plan gets tuned per tier —
 * but a bare number still produces a coherent world.
 */
export function Terrain({
  segments,
  budget,
}: {
  segments?: number;
  budget?: QualityBudget;
}) {
  const plan =
    budget ??
    (segments !== undefined ? budgetForSegments(segments) : budgetFor("medium"));

  const surfaces = useMemo(
    () => makeTerrainSurfaces(plan.textureSize),
    [plan.textureSize]
  );

  const built = useMemo(() => {
    const material = makeTerrainMaterial(surfaces);
    const group = new THREE.Group();
    group.name = "TerrainChunks";

    const chunks = plan.terrainChunks;
    const chunkSize = WORLD_SIZE / chunks;
    const half = WORLD_SIZE / 2;
    const levels = planChunkLevels(
      chunks,
      chunkSize,
      plan.terrainNearChunks,
      plan.terrainMidChunks
    );
    const bySegments = [
      plan.terrainNearSegments,
      plan.terrainMidSegments,
      plan.terrainFarSegments,
    ];

    const segmentsAt = (i: number, j: number) => {
      if (i < 0 || j < 0 || i >= chunks || j >= chunks) return Infinity;
      return bySegments[levels[j * chunks + i]];
    };

    // Hand the plan to the footing code. Everything that walks stands on the
    // surface that is *drawn*, not on the height function the mesh was built
    // from — between two vertices those differ by up to two thirds of a metre,
    // which is a bard buried to the thigh. Publishing the plan rather than
    // letting `surfaces.ts` recompute it keeps one opinion about the ground.
    setTerrainLod({ chunks, chunkSize, bySegments, levels });

    const geometries: THREE.BufferGeometry[] = [];
    for (let j = 0; j < chunks; j++) {
      for (let i = 0; i < chunks; i++) {
        const n = bySegments[levels[j * chunks + i]];
        const geometry = buildChunkGeometry(
          -half + i * chunkSize,
          -half + j * chunkSize,
          chunkSize,
          n,
          [
            segmentsAt(i - 1, j),
            segmentsAt(i + 1, j),
            segmentsAt(i, j - 1),
            segmentsAt(i, j + 1),
          ],
          surfaces.detailTile
        );
        geometries.push(geometry);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `Terrain_${i}_${j}`;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        // Static for the life of the scene, so the per-frame matrix update on
        // four hundred objects is worth skipping.
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
      }
    }

    const apronGeometry = buildApronGeometry(surfaces.detailTile);
    geometries.push(apronGeometry);
    const apron = new THREE.Mesh(apronGeometry, material);
    apron.name = "TerrainApron";
    // Nothing this far out is close enough to a light to be worth a shadow
    // lookup, and it is a third of the terrain's triangles.
    apron.receiveShadow = false;
    apron.castShadow = false;
    apron.matrixAutoUpdate = false;
    apron.updateMatrix();
    group.add(apron);

    return { group, material, geometries };
  }, [plan, surfaces]);

  useEffect(() => {
    return () => {
      for (const geometry of built.geometries) geometry.dispose();
      built.material.dispose();
    };
  }, [built]);

  useEffect(() => {
    return () => surfaces.dispose();
  }, [surfaces]);

  return (
    <>
      <AerialPerspective material={built.material} />
      <primitive object={built.group} name="Terrain" />
    </>
  );
}

/**
 * Keeps the terrain's aerial-perspective haze on the same clock as the sky.
 *
 * The mountains are hazed by this shader rather than by scene fog, so if these
 * uniforms stay fixed the ridgelines keep their late-afternoon warmth straight
 * through midnight — a fault that is invisible on any single frame and glaring
 * once the sky above them has gone dark blue.
 *
 * `uSunDir` follows the *key* direction rather than the sun's, so after sunset
 * the bright side of the haze is wherever the moon is, which is what actually
 * happens to a valley under moonlight.
 */
function AerialPerspective({ material }: { material: THREE.MeshStandardMaterial }) {
  const aerial = material.userData.aerial as
    | {
        uSunDir: { value: THREE.Vector3 };
        uHaze: { value: THREE.Color };
        uHazeSun: { value: THREE.Color };
        uMist: { value: THREE.Color };
      }
    | undefined;

  useFrame(() => {
    if (!aerial) return;
    aerial.uSunDir.value.copy(daylight.keyDir);
    aerial.uHaze.value.copy(daylight.hazeColor);
    aerial.uHazeSun.value.copy(daylight.hazeSunColor);
    aerial.uMist.value.copy(daylight.mistColor);
  });

  return null;
}

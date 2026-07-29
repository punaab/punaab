/**
 * The meadow.
 *
 * Grass used to be a fixed world-space scatter in an eight-metre band along the
 * roads. That can only ever put grass where a road is, and it capped out around
 * seventy blades to the square metre — so the moment the bard stepped off the
 * verge he was standing on bare ground, and no amount of colour work fixes a
 * field you can see through.
 *
 * What replaces it is the CodePen meadow: four concentric rings of chunks that
 * follow the camera, at eleven hundred blades to the square metre underfoot,
 * thinning outward on one continuous curve all the way to the horizon.
 *
 * Three ideas carry the whole thing.
 *
 * **One density law, four rings.** Blades per square metre at distance `d` is
 * `B_i · min(1, (dn_i / d)^1.5)`. The four rings are tuned so that
 * `K = B_i · dn_i^1.5` is (near enough) the same constant in all of them, which
 * means the curve is continuous *across* ring boundaries — there is no step, no
 * visible seam, and no annulus of missing grass between one ring and the next.
 * The rings exist only so that far ground can be addressed in 250-metre chunks
 * instead of nine-metre ones.
 *
 * **The chunk grid comes from the ring's own far distance.** `ceil(2·far/chunk)
 * + 1`, never a hand-picked number. Hand-picked grids are how the previous two
 * attempts ended up with rings that did not reach their own stated far
 * distance, leaving un-grassed rings between them — which is exactly the "dense
 * grass only appears when you get close" symptom.
 *
 * **Thin twice, and only ever downward.** Coarsely here on the CPU, by lowering
 * a chunk's instance count; the shared blade buffer is shuffled so that any
 * prefix of it is a fair sample of the whole chunk, and a blade the CPU drops
 * costs literally nothing. Then finely in the vertex shader, per blade, against
 * that blade's own true distance. The CPU deliberately over-draws — it measures
 * the chunk by its *nearest corner*, so the shader can only ever remove, never
 * add. That is what lets the outer ring use 250-metre chunks with no banding.
 *
 * This module is deliberately free of three.js: it is placement arithmetic and
 * a chunk recycler. `components/world/Flora.tsx` owns the geometry, the shader
 * and the draw.
 */

import {
  WORLD_SIZE,
  WATER_LEVEL,
  TREE_LINE,
  ROAD_HALF_WIDTH,
  WATERS,
  distanceToRoad,
  fbm,
  heightAt,
} from "./terrain";
import { drawnHeightAt, terrainLodReady } from "./surfaces";
import { biomeWeights, type BiomeId } from "./regions";
import { isBlocked } from "./collision";
import type { QualityTier } from "./quality";

// ---------------------------------------------------------------------------
// The reference numbers
// ---------------------------------------------------------------------------

/**
 * The exponent of the density falloff.
 *
 * 1.5 is a hardware number, not a taste one. At exactly 1.5 the GPU evaluates
 * `x^1.5` as `x·x·inversesqrt(x)` — three instructions, where a general `pow`
 * is about ten — and this expression runs on every grass vertex in the frame.
 * Any other exponent costs roughly triple for a curve nobody can tell apart.
 */
export const GRASS_DENSITY_POW = 1.5;

export type GrassRing = {
  /** Metres per chunk. */
  chunk: number;
  /** Blade slots in one chunk at density 1.0. */
  blades: number;
  /** Inner edge of the band this ring occupies. Overlaps its inner neighbour. */
  near: number;
  /** Outer edge. Overlaps its outer neighbour's `near`. */
  far: number;
  /** Distance inside which this ring runs at full density. */
  dn: number;
  /** Minimum width on screen, in pixels. */
  wpx: number;
  /** Height scale. Far blades are taller, which is half of how they hold up. */
  hs: number;
};

/**
 * The published table, verbatim.
 *
 * The blade counts are per chunk: 89000 over a nine-metre chunk is 1099/m²,
 * 177000 over thirty is 197/m², 307000 over a hundred is 31/m², and 231000 over
 * two hundred and fifty is 3.7/m². Multiply each by `dn^1.5` and you get
 * roughly the same K every time — that is the whole design, and it is why the
 * numbers look arbitrary and are not.
 */
export const GRASS_RINGS: readonly GrassRing[] = [
  { chunk: 9, blades: 89000, near: 0, far: 26, dn: 7, wpx: 1.4, hs: 1.0 },
  { chunk: 30, blades: 177000, near: 22, far: 84, dn: 22, wpx: 1.6, hs: 1.08 },
  { chunk: 100, blades: 307000, near: 76, far: 290, dn: 76, wpx: 1.9, hs: 1.28 },
  { chunk: 250, blades: 231000, near: 260, far: 1250, dn: 260, wpx: 2.2, hs: 1.7 },
];

export type GrassQualityTier = {
  /** Density multiplier per ring. */
  grass: readonly number[];
  /** Bezier segments per blade, per ring. */
  blades: readonly number[];
};

/**
 * Where the radius taper begins, as a fraction of the radius itself.
 *
 * The last quarter is enough to read as the sward thinning out and short
 * enough that the tier still gets most of the saving it asked for.
 */
export const GRASS_RADIUS_FADE = 0.75;

export const GRASS_QUALITY: readonly GrassQualityTier[] = [
  /**
   * Low — phones.
   *
   * The meadow is by far the heaviest thing in the world on a phone, and it is
   * heavy in the one way a phone minds most: vertices. The fragment side is
   * nearly free here (the blade shader lights per-vertex and the fragment stage
   * is one assignment plus fog), so what costs is blade count times segments
   * per blade, and both are in this row.
   *
   * The cuts are weighted towards the far rings on purpose. Halving the density
   * of grass sixty metries away is close to invisible — at that range a blade is
   * a fifth of a pixel and the sward reads as ground colour — whereas the near
   * ring is the one the camera is actually sitting in, so it keeps most of what
   * it had. Segments come down too: a two-segment blade still curves, a
   * one-segment blade is a straight quad, and past the first ring nothing is
   * wide enough on screen for the difference to show.
   */
  { grass: [0.4, 0.3, 0.2, 0.12], blades: [2, 1, 1, 1] }, // low
  { grass: [0.85, 0.75, 0.65, 0.55], blades: [4, 2, 1, 1] }, // medium
  { grass: [1.25, 1.15, 1.05, 0.95], blades: [5, 3, 2, 1] }, // high
  { grass: [1.55, 1.4, 1.3, 1.15], blades: [6, 3, 2, 1] }, // ultra
];

/**
 * This project's tiers stop at "high"; the reference's fourth row is kept
 * because the table is the reference's and truncating it would be a silent
 * edit. Nothing selects it today.
 */
export function grassTierIndex(tier: QualityTier): number {
  return tier === "low" ? 0 : tier === "medium" ? 1 : 2;
}

/** A blade at rest, before the ring's height scale and the per-blade jitter. */
export const GRASS_BLADE_HEIGHT = 0.72;
/** Full width at the root. The angular floor in the shader only widens it. */
export const GRASS_BLADE_WIDTH = 0.028;

// ---------------------------------------------------------------------------
// The density law
// ---------------------------------------------------------------------------

/** Blades per square metre a ring contributes at full density. */
export function ringBaseDensity(index: number): number {
  const ring = GRASS_RINGS[index];
  return ring.blades / (ring.chunk * ring.chunk);
}

export type GrassBand = {
  /** Fade-in window. `lo >= hi` means "no inner edge". */
  inLo: number;
  inHi: number;
  /** Fade-out window. `lo >= hi` means "hard cut at `lo`". */
  outLo: number;
  outHi: number;
};

/**
 * Where a ring hands over to its neighbours.
 *
 * The fade-out of ring i runs over exactly the same interval as the fade-in of
 * ring i+1 — `[near_{i+1}, far_i]` — so the two weights are `s` and `1 - s` and
 * sum to one everywhere. Combined with a constant K that makes the total
 * density curve smooth through the handover instead of stepping.
 */
export function ringBand(index: number): GrassBand {
  const ring = GRASS_RINGS[index];
  const previous = GRASS_RINGS[index - 1];
  const next = GRASS_RINGS[index + 1];
  return {
    inLo: previous ? ring.near : -1,
    inHi: previous ? previous.far : -1,
    outLo: next ? next.near : ring.far,
    outHi: next ? ring.far : ring.far,
  };
}

function smoothstep(edge0: number, edge1: number, x: number) {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The band weight for one ring, as the shader computes it. */
export function ringWeight(index: number, distance: number): number {
  const band = ringBand(index);
  const fadeIn = band.inHi > band.inLo ? smoothstep(band.inLo, band.inHi, distance) : 1;
  const fadeOut =
    band.outHi > band.outLo
      ? 1 - smoothstep(band.outLo, band.outHi, distance)
      : distance < band.outLo
        ? 1
        : 0;
  return fadeIn * fadeOut;
}

/**
 * Blades per square metre at a distance, summed over every ring.
 *
 * The measurement the whole system is judged on. Because K is constant and the
 * band weights sum to one, this is a single smooth curve — `1099/m²` inside
 * seven metres, then `K/d^1.5` outward — and not four humps.
 */
export function grassDensityAt(distance: number, tierIndex: number): number {
  const quality = GRASS_QUALITY[tierIndex] ?? GRASS_QUALITY[2];
  const d = Math.max(distance, 1e-4);
  let total = 0;
  for (let i = 0; i < GRASS_RINGS.length; i++) {
    const weight = ringWeight(i, d);
    if (weight <= 0) continue;
    const ring = GRASS_RINGS[i];
    const ratio = Math.min(1, ring.dn / d);
    // Clamped at one, because that is what actually happens: a multiplier above
    // 1.0 cannot conjure blades the chunk's buffer does not hold. Both cuts run
    // into the same ceiling — the CPU's `min(blades, …)` and the shader's rank,
    // which never reaches 1 — so above-unity tiers extend the full-density
    // plateau outward rather than raising the peak.
    const fraction = Math.min(
      1,
      quality.grass[i] * Math.pow(ratio, GRASS_DENSITY_POW) * weight
    );
    total += fraction * ringBaseDensity(i);
  }
  return total;
}

/** `ceil(2·far/chunk) + 1`. Derived, never hand-picked — see the file header. */
export function ringGridPerSide(index: number): number {
  const ring = GRASS_RINGS[index];
  return Math.ceil((2 * ring.far) / ring.chunk) + 1;
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * Integer hash -> [0, 1). The same one `terrain.ts` uses, because every scatter
 * in the world must agree and the world must be identical on every machine.
 *
 * `Math.imul` is load-bearing: a plain `*` on these constants runs past 2^53,
 * the float silently drops its low bits, and the low bits are the entire output
 * of the hash. That bug already shipped here once and pulled every scattered
 * prop into one corner of the map.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// The shared blade buffer
// ---------------------------------------------------------------------------

export type RingBlades = {
  /** Chunk-local metres, interleaved x,z. Shuffled. */
  local: Float32Array;
  /** Per-blade seed and rank `i / blades`, interleaved. Shuffled alongside. */
  seedRank: Float32Array;
  count: number;
};

/**
 * One chunk's worth of blade slots, reused by every chunk in the ring.
 *
 * This is what makes the whole thing affordable. Ring 2 has forty-nine chunks
 * of three hundred thousand blades; storing each chunk's placement separately
 * would be fifteen million instances of world-space transform. Instead there is
 * *one* buffer of chunk-local positions per ring, and a chunk is a draw of a
 * prefix of it at a model matrix. Four buffers, eight hundred thousand blades,
 * thirteen megabytes — and the vertex shader re-hashes each blade against its
 * chunk's origin so the same point set grows differently in every chunk.
 *
 * The positions are a jittered grid, not white noise: at eleven hundred blades
 * to the square metre, Poisson clumping is visible as bald patches. The order
 * is then shuffled, and that is the important part — the CPU thins a chunk by
 * drawing fewer instances, so every prefix of this array has to be an even
 * sample of the whole chunk rather than a corner of it.
 */
export function buildRingBlades(index: number): RingBlades {
  const ring = GRASS_RINGS[index];
  const side = Math.ceil(Math.sqrt(ring.blades));
  const cell = ring.chunk / side;
  const total = side * side;

  const x = new Float32Array(total);
  const z = new Float32Array(total);
  const seed = new Float32Array(total);

  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const k = j * side + i;
      x[k] = (i + hash2(i + index * 7919, j * 31 + index)) * cell;
      z[k] = (j + hash2(j * 17 + index * 104729, i * 13 + index * 7)) * cell;
      seed[k] = hash2(k * 3 + index * 2999, k * 7 + 101);
    }
  }

  // Fisher-Yates, from the same hash. Deterministic, and the whole point of it
  // is the prefix property the CPU thinning depends on.
  for (let i = total - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(hash2(i, index * 977 + 5) * (i + 1)));
    let t = x[i];
    x[i] = x[j];
    x[j] = t;
    t = z[i];
    z[i] = z[j];
    z[j] = t;
    t = seed[i];
    seed[i] = seed[j];
    seed[j] = t;
  }

  const count = Math.min(ring.blades, total);
  const local = new Float32Array(count * 2);
  const seedRank = new Float32Array(count * 2);
  const inverse = 1 / count;
  for (let i = 0; i < count; i++) {
    local[i * 2] = x[i];
    local[i * 2 + 1] = z[i];
    seedRank[i * 2] = seed[i];
    // The blade's place in the queue. The CPU keeps a prefix, so a blade is
    // uploaded when `rank < cpuFraction`; the shader then keeps it when
    // `rank < trueFraction`. Since the CPU measures the chunk by its nearest
    // corner, `trueFraction <= cpuFraction` always, so the two cuts never
    // disagree and a blade can never pop into existence.
    seedRank[i * 2 + 1] = i * inverse;
  }

  return { local, seedRank, count };
}

// ---------------------------------------------------------------------------
// The ground field
// ---------------------------------------------------------------------------

/**
 * Where grass grows, and how tall, baked once into two world-sized images.
 *
 * A blade cannot ask `heightAt` for its own ground: there are four million of
 * them and they are placed on the GPU. So the ground is sampled once at load
 * into a height field and a mask, and the vertex shader reads both. Bilinear
 * filtering does the rest, which is why the sampling grid can be a metre wide
 * and the grass still lies flat on a hillside.
 */
export type GrassGround = {
  /** Texels per side, covering the whole world. */
  size: number;
  /** Metres per texel. */
  step: number;
  /** Ground height, one float per texel. */
  height: Float32Array;
  /**
   * RGBA per texel.
   * R: how much grass belongs here, 0-255.
   * G: dryness — how far the blade colour walks toward straw.
   * B: height scale, mapped in the shader to roughly 0.35-1.45.
   * A: large-scale lushness, so the meadow is patchy rather than uniform.
   */
  mask: Uint8Array;
  minHeight: number;
  maxHeight: number;
};

/**
 * How much grass each biome carries. The old table, widened: this one has to
 * cover *all* ground near the viewer rather than a verge, so nothing outside
 * the badlands goes to zero.
 */
const GRASS_BIOME: Partial<Record<BiomeId, number>> = {
  meadow: 1,
  orchard: 0.86,
  farmland: 0.58,
  broadleaf: 0.64,
  heath: 0.52,
  shore: 0.42,
  highland: 0.4,
  marsh: 0.36,
  pine: 0.34,
  badlands: 0.08,
};

/** How far toward straw a biome pushes the blade colour. */
const GRASS_DRY: Partial<Record<BiomeId, number>> = {
  badlands: 1,
  heath: 0.55,
  highland: 0.5,
  farmland: 0.44,
  shore: 0.4,
  pine: 0.2,
  orchard: 0.14,
  meadow: 0.12,
  broadleaf: 0.1,
  marsh: 0.05,
};

/** Relative blade height. Fen grass is rank; hill grass is cropped short. */
const GRASS_TALL: Partial<Record<BiomeId, number>> = {
  marsh: 1.15,
  meadow: 1,
  farmland: 0.95,
  orchard: 0.9,
  broadleaf: 0.8,
  shore: 0.75,
  pine: 0.65,
  heath: 0.6,
  highland: 0.5,
  badlands: 0.35,
};

const HALF_WORLD = WORLD_SIZE / 2;

function distanceToWater(x: number, z: number): number {
  let best = Infinity;
  for (const water of WATERS) {
    const gap = Math.hypot(x - water.x, z - water.z) - water.radius;
    if (gap < best) best = gap;
  }
  return best;
}

function clamp01(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Bakes the height field and the grass mask.
 *
 * `heightAt` is the expensive call and there are `size²` of them, so the biome
 * lottery — which allocates an object per query — runs on a grid an eighth as
 * fine and is interpolated. Biomes blend over sixty metres; nothing is lost,
 * and it turns six hundred thousand allocations into ten thousand.
 */
export function bakeGrassGround(size: number): GrassGround {
  if (process.env.NODE_ENV !== "production" && !terrainLodReady()) {
    // `drawnHeightAt` falls back to `heightAt` when no LOD plan has been
    // published, which silently reintroduces floating grass — up to two metres
    // of it on a ridge. That only happens if <Flora> ever renders before
    // <Terrain>, so this is a tripwire on the render order rather than a
    // condition to handle.
    console.warn(
      "[punaab] grass baked before Terrain published its LOD plan — blades will float on convex ground"
    );
  }

  const step = WORLD_SIZE / size;
  const height = new Float32Array(size * size);
  const mask = new Uint8Array(size * size * 4);

  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let j = 0; j < size; j++) {
    const z = -HALF_WORLD + (j + 0.5) * step;
    for (let i = 0; i < size; i++) {
      const x = -HALF_WORLD + (i + 0.5) * step;
      // The height the terrain is DRAWN at, not the height function it was
      // built from. Between two mesh vertices the drawn surface is a flat
      // triangle, and over a hilltop that triangle cuts the corner and sits
      // below the function — so a blade rooted at `heightAt` floats above the
      // hill it should be growing on, by up to 1.3m at the coarser LODs.
      const y = drawnHeightAt(x, z);
      height[j * size + i] = y;
      if (y < minHeight) minHeight = y;
      if (y > maxHeight) maxHeight = y;
    }
  }

  if (process.env.NODE_ENV !== "production") {
    // How far the blades will actually sit off the ground, measured rather than
    // assumed. Floating grass has now been introduced twice by changes nowhere
    // near this file, and both times it was argued about before it was measured.
    //
    // The lattice points themselves are exact — they *are* `drawnHeightAt`.
    // What matters is the bilinear interpolation between them, which is what
    // the shader reads, and which is free to stray from the mesh in between.
    // A positive error is the field sitting above the terrain, which is the
    // one that shows: blades hover with daylight under them.
    let worst = 0;
    let worstAbove = 0;
    let sum = 0;
    const SAMPLES = 4000;
    for (let s = 1; s <= SAMPLES; s++) {
      // R2 low-discrepancy sequence — covers the valley far more evenly than
      // random sampling, and gives the same answer every run so the number can
      // be compared across builds.
      const x = -HALF_WORLD + ((s * 0.7548776662) % 1) * WORLD_SIZE;
      const z = -HALF_WORLD + ((s * 0.5698402909) % 1) * WORLD_SIZE;

      // Exactly the lookup the vertex shader does: UV to texel centres, then
      // bilinear. Anything else here would measure a field nobody reads.
      const fx = ((x + HALF_WORLD) / WORLD_SIZE) * size - 0.5;
      const fz = ((z + HALF_WORLD) / WORLD_SIZE) * size - 0.5;
      const i0 = Math.floor(fx);
      const j0 = Math.floor(fz);
      const tx = fx - i0;
      const tz = fz - j0;
      const at = (i: number, j: number) =>
        height[
          Math.min(size - 1, Math.max(0, j)) * size +
            Math.min(size - 1, Math.max(0, i))
        ];
      const sampled =
        at(i0, j0) * (1 - tx) * (1 - tz) +
        at(i0 + 1, j0) * tx * (1 - tz) +
        at(i0, j0 + 1) * (1 - tx) * tz +
        at(i0 + 1, j0 + 1) * tx * tz;

      const error = sampled - drawnHeightAt(x, z);
      sum += Math.abs(error);
      if (Math.abs(error) > worst) worst = Math.abs(error);
      if (error > worstAbove) worstAbove = error;
    }
    console.info(
      `[punaab] grass footing: lattice ${size}² over ${WORLD_SIZE}m ` +
        `(${(WORLD_SIZE / size).toFixed(2)}m/texel) — ` +
        `mean |error| ${(sum / SAMPLES).toFixed(3)}m, worst ${worst.toFixed(3)}m, ` +
        `worst float ${worstAbove.toFixed(3)}m (blades are planted 0.11m down)`
    );
  }

  // --- the coarse biome fields ---
  const coarse = Math.max(4, size >> 3);
  const nodes = coarse + 1;
  const coarseStep = WORLD_SIZE / coarse;
  const biomeGrass = new Float32Array(nodes * nodes);
  const biomeDry = new Float32Array(nodes * nodes);
  const biomeTall = new Float32Array(nodes * nodes);

  for (let j = 0; j < nodes; j++) {
    const z = -HALF_WORLD + j * coarseStep;
    for (let i = 0; i < nodes; i++) {
      const x = -HALF_WORLD + i * coarseStep;
      const weights = biomeWeights(x, z);
      let g = 0;
      let dry = 0;
      let tall = 0;
      for (const key of Object.keys(weights) as BiomeId[]) {
        const share = weights[key] as number;
        g += share * (GRASS_BIOME[key] ?? 0.3);
        dry += share * (GRASS_DRY[key] ?? 0.3);
        tall += share * (GRASS_TALL[key] ?? 0.7);
      }
      const node = j * nodes + i;
      biomeGrass[node] = g;
      biomeDry[node] = dry;
      biomeTall[node] = tall;
    }
  }

  const sampleCoarse = (field: Float32Array, x: number, z: number) => {
    const u = clamp01((x + HALF_WORLD) / WORLD_SIZE) * coarse;
    const v = clamp01((z + HALF_WORLD) / WORLD_SIZE) * coarse;
    const i0 = Math.min(coarse - 1, Math.floor(u));
    const j0 = Math.min(coarse - 1, Math.floor(v));
    const fx = u - i0;
    const fz = v - j0;
    const a = field[j0 * nodes + i0];
    const b = field[j0 * nodes + i0 + 1];
    const c = field[(j0 + 1) * nodes + i0];
    const d = field[(j0 + 1) * nodes + i0 + 1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };

  // Keep the carriageway clear, but plant the verge hard against it — the
  // camera follows the bard on the road, so grass that only begins two metres
  // out never reads as a meadow around him.
  const roadKill = ROAD_HALF_WIDTH * 0.72;
  const roadFree = ROAD_HALF_WIDTH + 0.55;

  for (let j = 0; j < size; j++) {
    const z = -HALF_WORLD + (j + 0.5) * step;
    for (let i = 0; i < size; i++) {
      const index = j * size + i;
      const x = -HALF_WORLD + (i + 0.5) * step;
      const y = height[index];

      // Gradient from the field we already have, rather than four more
      // `heightAt` calls. Expressed as `slopeAt` expresses it — one minus the
      // normal's Y — so the thresholds mean what they mean elsewhere.
      const left = height[j * size + Math.max(0, i - 1)];
      const right = height[j * size + Math.min(size - 1, i + 1)];
      const down = height[Math.max(0, j - 1) * size + i];
      const up = height[Math.min(size - 1, j + 1) * size + i];
      const gradient = Math.hypot(
        (right - left) / (2 * step),
        (up - down) / (2 * step)
      );
      const slope = 1 - 1 / Math.sqrt(1 + gradient * gradient);

      // A one-texel skirt of nothing, so the texture's clamp-to-edge hands the
      // shader bare ground outside the valley instead of smearing the border.
      const edge = i === 0 || j === 0 || i === size - 1 || j === size - 1;

      let cover = edge ? 0 : sampleCoarse(biomeGrass, x, z);
      if (cover > 0) {
        // No grass in the water, on the road surface, up in the scree, on a
        // cliff, or inside a building.
        cover *= smoothstep(WATER_LEVEL + 0.15, WATER_LEVEL + 1, y);
        cover *= smoothstep(0.3, 2.2, distanceToWater(x, z));
        cover *= smoothstep(roadKill, roadFree, distanceToRoad(x, z));
        cover *= 1 - smoothstep(0.48, 0.72, slope);
        cover *= 1 - smoothstep(TREE_LINE + 16, TREE_LINE + 48, y);
        if (cover > 0.004 && isBlocked(x, z, 0.75)) cover = 0;
      }

      // Patchiness. A meadow of one colour reads as a billiard table however
      // dense it is; two octaves at forty and eleven metres is enough to give
      // it grazing, damp hollows and sun-bleached ridges.
      const lush = clamp01(0.5 + fbm(x * 0.025, z * 0.025, 2) * 0.9);
      const dry = clamp01(
        sampleCoarse(biomeDry, x, z) * (0.55 + (1 - lush) * 0.9) + slope * 0.35
      );
      const tall = clamp01(sampleCoarse(biomeTall, x, z) * (0.55 + lush * 0.7));

      mask[index * 4] = Math.round(clamp01(cover) * 255);
      mask[index * 4 + 1] = Math.round(dry * 255);
      mask[index * 4 + 2] = Math.round(tall * 255);
      mask[index * 4 + 3] = Math.round(lush * 255);
    }
  }

  return { size, step, height, mask, minHeight, maxHeight };
}

// ---------------------------------------------------------------------------
// The chunk grid
// ---------------------------------------------------------------------------

export type GrassChunkSlot = {
  ring: number;
  /** Chunk coordinates in chunk units. NaN until the slot has been filled. */
  cx: number;
  cz: number;
  originX: number;
  originZ: number;
  /** Vertical extent of the ground beneath the chunk, for the bounding sphere. */
  minY: number;
  maxY: number;
  /** The most grass anywhere in the footprint. Zero means the chunk is bare. */
  cover: number;
  /** True on the update that moved this slot onto new ground. */
  moved: boolean;
  /** Instances to draw. Zero hides the chunk. */
  count: number;
};

export type GrassStats = {
  /** Chunks with anything to draw. One draw call each, before frustum culling. */
  chunks: number;
  /** Blade instances handed to the GPU. The shader thins further, per blade. */
  instances: number;
};

/**
 * Four rings of chunks that follow the camera.
 *
 * Slots are addressed toroidally: slot `((cx % N) + N) % N` always holds chunk
 * `cx`, so walking one chunk east recycles one column and leaves the rest
 * alone. Nothing is rebuilt — a recycled chunk gets a new origin, a new
 * bounding sphere and a rescan of the ground beneath it, and goes on drawing
 * the same shared blade buffer.
 */
export class GrassChunkGrid {
  readonly slots: GrassChunkSlot[][] = [];
  readonly gridPerSide: number[] = [];
  readonly stats: GrassStats = { chunks: 0, instances: 0 };

  private readonly ground: GrassGround;
  private readonly density: number[];
  private readonly radius: number;

  constructor(ground: GrassGround, tierIndex: number, radius = Infinity) {
    this.ground = ground;
    const quality = GRASS_QUALITY[tierIndex] ?? GRASS_QUALITY[2];
    this.density = [...quality.grass];
    this.radius = radius > 0 ? radius : Infinity;

    for (let r = 0; r < GRASS_RINGS.length; r++) {
      const side = ringGridPerSide(r);
      this.gridPerSide.push(side);
      const list: GrassChunkSlot[] = [];
      for (let i = 0; i < side * side; i++) {
        list.push({
          ring: r,
          cx: Number.NaN,
          cz: Number.NaN,
          originX: 0,
          originZ: 0,
          minY: 0,
          maxY: 0,
          cover: 0,
          moved: false,
          count: 0,
        });
      }
      this.slots.push(list);
    }
  }

  /**
   * Measures the ground under a chunk that has just been recycled.
   *
   * Cheap because it reads the baked field rather than the terrain: a
   * nine-metre chunk is eighty-one texels, and the 250-metre ones are strided
   * down to a few hundred samples. The vertical extent feeds the bounding
   * sphere; the peak cover lets a chunk that is entirely lake or entirely
   * rooftop drop out of the frame altogether.
   */
  private scan(slot: GrassChunkSlot, chunk: number): void {
    const ground = this.ground;
    const size = ground.size;
    const toTexel = (world: number) =>
      Math.floor((world + HALF_WORLD) / ground.step);

    const i0 = Math.max(0, toTexel(slot.originX));
    const i1 = Math.min(size - 1, toTexel(slot.originX + chunk));
    const j0 = Math.max(0, toTexel(slot.originZ));
    const j1 = Math.min(size - 1, toTexel(slot.originZ + chunk));

    if (i1 < i0 || j1 < j0) {
      // Entirely outside the valley.
      slot.cover = 0;
      slot.minY = 0;
      slot.maxY = 0;
      return;
    }

    const stride = Math.max(1, Math.ceil(Math.max(i1 - i0, j1 - j0) / 24));
    let minY = Infinity;
    let maxY = -Infinity;
    let cover = 0;

    for (let j = j0; j <= j1; j += stride) {
      const row = j * size;
      for (let i = i0; i <= i1; i += stride) {
        const y = ground.height[row + i];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const c = ground.mask[(row + i) * 4];
        if (c > cover) cover = c;
      }
    }

    slot.minY = minY;
    slot.maxY = maxY;
    slot.cover = cover / 255;
  }

  /**
   * Recycles every ring around a camera position and sets each chunk's count.
   *
   * The count is the coarse half of the thinning. It uses the chunk's *nearest*
   * corner, which over-states the density for every blade behind that corner —
   * deliberately, because the shader's job is to remove and it must never be
   * asked to invent. Scaling by the chunk's peak cover is the same trick: a
   * chunk half under water still uploads as if it were all meadow, and the
   * shader takes the water half out.
   */
  update(cameraX: number, cameraZ: number): void {
    let chunks = 0;
    let instances = 0;

    for (let r = 0; r < GRASS_RINGS.length; r++) {
      const ring = GRASS_RINGS[r];
      const slots = this.slots[r];
      const side = this.gridPerSide[r];
      const half = Math.floor(side / 2);
      const baseX = Math.floor(cameraX / ring.chunk) - half;
      const baseZ = Math.floor(cameraZ / ring.chunk) - half;
      const quality = this.density[r];
      const farSq = ring.far * ring.far;
      const nearSq = ring.near * ring.near;

      for (let gz = 0; gz < side; gz++) {
        const cz = baseZ + gz;
        const sz = ((cz % side) + side) % side;
        for (let gx = 0; gx < side; gx++) {
          const cx = baseX + gx;
          const sx = ((cx % side) + side) % side;
          const slot = slots[sz * side + sx];

          slot.moved = false;
          if (slot.cx !== cx || slot.cz !== cz) {
            slot.cx = cx;
            slot.cz = cz;
            slot.originX = cx * ring.chunk;
            slot.originZ = cz * ring.chunk;
            slot.moved = true;

            const outside =
              slot.originX + ring.chunk <= -HALF_WORLD ||
              slot.originX >= HALF_WORLD ||
              slot.originZ + ring.chunk <= -HALF_WORLD ||
              slot.originZ >= HALF_WORLD;
            if (outside) {
              slot.cover = 0;
              slot.minY = 0;
              slot.maxY = 0;
            } else {
              this.scan(slot, ring.chunk);
            }
          }

          if (slot.cover <= 0) {
            slot.count = 0;
            continue;
          }

          // Nearest and furthest corner of the chunk footprint, in plan.
          const dx = Math.max(
            slot.originX - cameraX,
            0,
            cameraX - (slot.originX + ring.chunk)
          );
          const dz = Math.max(
            slot.originZ - cameraZ,
            0,
            cameraZ - (slot.originZ + ring.chunk)
          );
          const nearestSq = dx * dx + dz * dz;
          if (nearestSq >= farSq) {
            slot.count = 0;
            continue;
          }

          const fx = Math.max(
            Math.abs(slot.originX - cameraX),
            Math.abs(slot.originX + ring.chunk - cameraX)
          );
          const fz = Math.max(
            Math.abs(slot.originZ - cameraZ),
            Math.abs(slot.originZ + ring.chunk - cameraZ)
          );
          // A chunk that lies entirely inside this ring's inner edge is drawn
          // by the ring inside it. Skipping it here is what keeps ring 3 from
          // uploading a quarter of a million blades for ground that ring 0 has
          // already covered at three hundred times the density.
          if (fx * fx + fz * fz <= nearSq) {
            slot.count = 0;
            continue;
          }

          const nearest = Math.sqrt(nearestSq);
          const ratio = nearest <= ring.dn ? 1 : ring.dn / nearest;
          let keep = quality * Math.pow(ratio, GRASS_DENSITY_POW) * slot.cover;

          // --- The tier's grass radius -----------------------------------
          //
          // The rings carry the reference's own extents, which run to 1250
          // metres — tuned for a world nearly four times the size of this one.
          // A phone drawing blades a kilometre out is spending its whole vertex
          // budget on ground it has already fogged to nothing.
          //
          // Tapered rather than cut. A hard edge at the radius is a line across
          // the meadow where grass simply stops, and at these distances there is
          // almost no fog to hide it — which is exactly why this knob sat unused
          // rather than being wired up as its name suggests. Fading the density
          // out over the last stretch lets the sward thin into bare ground the
          // way it would anyway, and the eye reads it as the field ending rather
          // than as a clipping plane.
          if (nearest >= this.radius) {
            slot.count = 0;
            continue;
          }
          const fadeFrom = this.radius * GRASS_RADIUS_FADE;
          if (nearest > fadeFrom) {
            const t = (nearest - fadeFrom) / (this.radius - fadeFrom);
            keep *= 1 - t * t * (3 - 2 * t);
          }

          const count = Math.min(ring.blades, Math.ceil(ring.blades * keep));
          slot.count = count;
          if (count > 0) {
            chunks++;
            instances += count;
          }
        }
      }
    }

    this.stats.chunks = chunks;
    this.stats.instances = instances;
  }
}

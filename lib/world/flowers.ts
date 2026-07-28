/**
 * Flowers, and where they drift.
 *
 * A meadow in late summer is not evenly flowered. It is bare sward for twenty
 * paces and then a hundred buttercups at once, because a flower spreads from
 * where its parent stood — by root, by seed dropped a metre away, into whatever
 * damp hollow or sheltered lee suited the parent in the first place. Scatter the
 * same number of flowers uniformly and the eye reads confetti on a lawn
 * immediately, at any density: the giveaway is the *absence* of bare ground.
 *
 * So placement here is two-scale. A low-frequency field decides where a drift
 * exists at all and which single species owns it; inside the drift, plants are
 * packed at meadow density with a mid-frequency field eating ragged bites out of
 * the edge, so no patch has a circular outline. Between drifts there is nothing,
 * and the nothing is the point.
 *
 * The ground rules are not this file's own opinion. `bakeGrassGround` in
 * `./grass.ts` already decides where anything grows — out of the water, off the
 * carriageway, off cliffs, out of building footprints, below the scree — and a
 * second disagreeing opinion is how you end up with a poppy standing in a lake.
 * `groundCover()` below is that same chain of masks with the same thresholds,
 * evaluated per drift rather than per texel.
 *
 * The geometry is here too, and deliberately three.js-free: it emits plain typed
 * arrays that `components/world/Flora.tsx` wraps in a `BufferGeometry`. That is
 * what makes a flower measurable — triangle counts, drift counts and per-tier
 * populations can be run in a plain node process against exactly the code the
 * browser runs, rather than estimated.
 */

import {
  WORLD_SIZE,
  WATER_LEVEL,
  TREE_LINE,
  ROAD_HALF_WIDTH,
  WATERS,
  distanceToRoad,
  heightAt,
  fbm,
} from "./terrain";
import { biomeWeights, type BiomeId } from "./regions";
import { isBlocked } from "./collision";
import { GHIBLI } from "./ghibli-palette";

// ---------------------------------------------------------------------------
// Determinism and colour
// ---------------------------------------------------------------------------

/**
 * Integer hash -> [0, 1). The same one `terrain.ts` and `grass.ts` use, because
 * every scatter in the world must agree and the world must be identical on
 * every machine.
 *
 * `Math.imul` is load-bearing: a plain `*` on these constants runs past 2^53,
 * the float silently drops its low bits, and the low bits are the entire output
 * of the hash. That bug shipped here once and pulled every scattered prop into
 * one corner of the map.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export type Rgb = [number, number, number];

/**
 * sRGB hex -> the renderer's working colour space.
 *
 * The same transfer function `THREE.Color.setStyle(hex, SRGBColorSpace)` applies
 * with colour management on, done longhand so this module owes nothing to
 * three.js. Get it wrong and the flowers sit in a different film from the grass,
 * which is the one thing they are not allowed to do.
 */
function channel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [
    channel((value >> 16) & 255),
    channel((value >> 8) & 255),
    channel(value & 255),
  ];
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function shade(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

// ---------------------------------------------------------------------------
// The species table
// ---------------------------------------------------------------------------

/**
 * How a head is put together. Each of these is a different *silhouette* at two
 * metres, which is the only distance at which any of this is decided: a flat
 * white plate, a five-petal cup, a nodding bell and a one-sided spire are
 * recognisable from across a verge, and no amount of petal detail rescues a head
 * whose outline is wrong.
 */
export type HeadForm =
  | "umbel"
  | "composite"
  | "poppy"
  | "ray"
  | "bell"
  | "raceme"
  | "spire"
  | "pompom"
  | "cotton"
  | "iris"
  | "fallen";

export type FlowerSpec = {
  id: string;
  /** The plant it is meant to read as. Not shown anywhere; it is here so the
   *  next person to touch a number knows what they are tuning. */
  plant: string;
  head: HeadForm;

  /** Petal colours: lit face, shaded base, and the eye / throat / boss. */
  petal: string;
  petalShade: string;
  heart: string;
  stem: string;
  leaf: string;

  /** Stem height in metres at scale 1. */
  height: number;
  /** Flowering stems per plant at the near level of detail. */
  heads: number;
  /** Petals, rays or florets per head. */
  petals: number;
  /** Petal length / head radius, metres. */
  headRadius: number;
  /** How far the head nods over, 0 = face to the sky, 1 = hanging. */
  droop: number;
  leaves: number;
  leafLength: number;
  leafWidth: number;

  scale: [number, number];
  /** Which wind material: a short stem nods, a spire sways from the base. */
  sway: "stem" | "spire";

  // --- where it grows ---
  biomes: Partial<Record<BiomeId, number>>;
  /** Preference for damp hollows (+) or dry exposed ground (-). */
  damp: number;
  /** Extra weight in the road verge, where mowing and light favour flowers. */
  verge: number;
  /** Drift radius range in metres. */
  drift: [number, number];
  /** Plants per square metre in the heart of a drift. */
  density: number;
  /** Plants per rosette. One root throws several stems. */
  clump: number;

  maxSlope: number;
  minHeight: number;
  maxHeight: number;
  minRoadDistance: number;
  minWaterDistance: number;
};

/**
 * Colours are the one place in the valley saturation is allowed, but they still
 * come out of the same film stock: every petal is a step off a `GHIBLI` entry
 * rather than a fresh hue, the whites are the cream and mist the clouds are
 * painted in, and every stem is one of the two meadow greens. A pure #FF0000
 * poppy would be the only thing on screen not lit by the same afternoon.
 */
const STEM = GHIBLI.gMid;
const STEM_DARK = GHIBLI.gLow;
const LEAF = GHIBLI.cMid;

export const FLOWERS: FlowerSpec[] = [
  {
    id: "cowparsley",
    plant: "cow parsley",
    head: "umbel",
    petal: GHIBLI.cream,
    petalShade: GHIBLI.mist,
    heart: GHIBLI.warm,
    stem: STEM,
    leaf: LEAF,
    height: 0.78,
    heads: 3,
    petals: 11,
    headRadius: 0.1,
    droop: 0.05,
    leaves: 4,
    leafLength: 0.2,
    leafWidth: 0.05,
    scale: [0.75, 1.25],
    sway: "spire",
    // The classic hedge-bank and verge plant: it wants shelter and a bit of
    // shade, and it lines every lane in the valley.
    biomes: { meadow: 1, broadleaf: 0.9, orchard: 0.75, farmland: 0.5, marsh: 0.2 },
    damp: 0.35,
    verge: 1,
    drift: [2.6, 6],
    density: 2.1,
    clump: 2,
    maxSlope: 0.45,
    minHeight: WATER_LEVEL + 0.6,
    maxHeight: TREE_LINE - 6,
    minRoadDistance: 2.3,
    minWaterDistance: 1.2,
  },
  {
    id: "buttercup",
    plant: "meadow buttercup",
    head: "composite",
    petal: "#F0C243",
    petalShade: "#B8842A",
    heart: "#8E6A20",
    stem: STEM,
    leaf: LEAF,
    height: 0.32,
    heads: 4,
    petals: 5,
    headRadius: 0.028,
    droop: 0.12,
    leaves: 5,
    leafLength: 0.13,
    leafWidth: 0.045,
    scale: [0.8, 1.35],
    sway: "stem",
    biomes: { meadow: 1, farmland: 0.55, orchard: 0.62, broadleaf: 0.24, marsh: 0.2 },
    damp: 0.5,
    verge: 0.7,
    drift: [3, 7.5],
    density: 3.4,
    clump: 3,
    maxSlope: 0.5,
    minHeight: WATER_LEVEL + 0.4,
    maxHeight: TREE_LINE - 4,
    minRoadDistance: 1.6,
    minWaterDistance: 0.8,
  },
  {
    id: "poppy",
    plant: "field poppy",
    head: "poppy",
    petal: "#D0472F",
    petalShade: "#7E2A22",
    heart: "#2A211E",
    stem: "#7E8E4E",
    leaf: "#6E8248",
    height: 0.46,
    heads: 2,
    petals: 4,
    headRadius: 0.052,
    droop: 0.2,
    leaves: 3,
    leafLength: 0.14,
    leafWidth: 0.03,
    scale: [0.8, 1.3],
    sway: "stem",
    // Poppies are a plant of broken ground: the ploughed edge of a field, never
    // the middle of an old pasture.
    biomes: { farmland: 1, meadow: 0.3, badlands: 0.12, shore: 0.1 },
    damp: -0.4,
    verge: 0.9,
    drift: [2.4, 6],
    density: 2.8,
    clump: 2,
    maxSlope: 0.42,
    minHeight: WATER_LEVEL + 1,
    maxHeight: 44,
    minRoadDistance: 2,
    minWaterDistance: 2,
  },
  {
    id: "cornflower",
    plant: "cornflower",
    head: "ray",
    petal: "#3F6BC0",
    petalShade: "#274785",
    heart: "#5B4E8C",
    stem: "#8A9A66",
    leaf: "#7E9059",
    height: 0.4,
    heads: 3,
    petals: 8,
    headRadius: 0.034,
    droop: 0.1,
    leaves: 3,
    leafLength: 0.12,
    leafWidth: 0.016,
    scale: [0.8, 1.25],
    sway: "stem",
    biomes: { farmland: 1, meadow: 0.34, heath: 0.12 },
    damp: -0.25,
    verge: 0.85,
    drift: [2.2, 5.5],
    density: 2.4,
    clump: 2,
    maxSlope: 0.42,
    minHeight: WATER_LEVEL + 1,
    maxHeight: 44,
    minRoadDistance: 2,
    minWaterDistance: 1.8,
  },
  {
    id: "harebell",
    plant: "harebell",
    head: "bell",
    petal: "#7C9BD2",
    petalShade: "#48679F",
    heart: "#D6DDD4",
    stem: "#8E9C6A",
    leaf: "#7A8C55",
    height: 0.26,
    heads: 3,
    petals: 6,
    headRadius: 0.022,
    droop: 0.92,
    leaves: 3,
    leafLength: 0.07,
    leafWidth: 0.012,
    scale: [0.75, 1.2],
    sway: "stem",
    // Thin dry turf: the top of a bank, a heath edge, the short grass of a
    // hillside — never in the lush stuff, where it is simply out-grown.
    biomes: { heath: 1, highland: 0.7, meadow: 0.4, shore: 0.3, pine: 0.2 },
    damp: -0.6,
    verge: 0.5,
    drift: [2, 5],
    density: 2.6,
    clump: 3,
    maxSlope: 0.55,
    minHeight: WATER_LEVEL + 0.8,
    maxHeight: TREE_LINE + 6,
    minRoadDistance: 1.8,
    minWaterDistance: 1.5,
  },
  {
    id: "bellheather",
    plant: "bell heather",
    head: "raceme",
    petal: "#A9749C",
    petalShade: "#5A3A54",
    heart: "#D9B7CE",
    stem: "#6E6248",
    leaf: "#4E5E3C",
    height: 0.24,
    heads: 4,
    petals: 7,
    headRadius: 0.012,
    droop: 0.35,
    leaves: 0,
    leafLength: 0,
    leafWidth: 0,
    scale: [0.8, 1.5],
    sway: "stem",
    biomes: { heath: 1, highland: 0.55, pine: 0.22, marsh: 0.14 },
    damp: -0.2,
    verge: 0.25,
    // Heather does not drift, it carpets: the widest patches in the valley and
    // the whole look of the Hollowmoor. Held back from the ten-metre drifts it
    // asked for, because at that size it won half the valley's entire flower
    // budget and the meadow species were left with the crumbs.
    drift: [3, 7],
    density: 3,
    clump: 3,
    maxSlope: 0.6,
    minHeight: WATER_LEVEL + 0.6,
    maxHeight: TREE_LINE + 14,
    minRoadDistance: 2,
    minWaterDistance: 1.5,
  },
  {
    id: "foxglove",
    plant: "foxglove",
    head: "spire",
    petal: "#BE5F9C",
    petalShade: "#75355F",
    heart: "#F1E2E6",
    stem: "#77864E",
    leaf: "#5E7442",
    height: 1.02,
    heads: 2,
    petals: 9,
    headRadius: 0.028,
    droop: 1,
    leaves: 4,
    leafLength: 0.22,
    leafWidth: 0.08,
    scale: [0.7, 1.3],
    sway: "spire",
    // A plant of clearings and cut banks: it appears where a wood has been
    // opened up and is gone again in three summers.
    biomes: { broadleaf: 1, pine: 0.6, heath: 0.45, meadow: 0.16 },
    damp: 0.2,
    verge: 0.8,
    drift: [1.8, 4.5],
    density: 1.1,
    clump: 2,
    maxSlope: 0.5,
    minHeight: WATER_LEVEL + 0.8,
    maxHeight: TREE_LINE - 2,
    minRoadDistance: 2.6,
    minWaterDistance: 1.5,
  },
  {
    id: "cottongrass",
    plant: "cotton grass",
    head: "cotton",
    petal: "#F1EDE0",
    petalShade: "#C6C3B4",
    heart: "#CFCBBD",
    stem: "#8A9059",
    leaf: "#78864C",
    height: 0.36,
    heads: 4,
    petals: 9,
    headRadius: 0.03,
    droop: 0.5,
    leaves: 4,
    leafLength: 0.24,
    leafWidth: 0.008,
    scale: [0.8, 1.4],
    sway: "stem",
    biomes: { marsh: 1, shore: 0.2, highland: 0.14 },
    damp: 1,
    verge: 0.3,
    drift: [3, 8],
    density: 3,
    clump: 3,
    maxSlope: 0.25,
    // Bog cotton stands in the wet. It is allowed nearer the water than
    // anything else here, and only just above the waterline.
    minHeight: WATER_LEVEL + 0.05,
    maxHeight: 16,
    minRoadDistance: 2,
    minWaterDistance: 0.2,
  },
  {
    id: "flagiris",
    plant: "yellow flag iris",
    head: "iris",
    petal: "#E7BE43",
    petalShade: "#A87C26",
    heart: "#8C6A1E",
    stem: "#6E8A48",
    leaf: "#5F7C42",
    height: 0.7,
    heads: 2,
    petals: 3,
    headRadius: 0.075,
    droop: 0.3,
    leaves: 5,
    leafLength: 0.62,
    leafWidth: 0.026,
    scale: [0.8, 1.25],
    sway: "spire",
    biomes: { marsh: 1, shore: 0.35 },
    damp: 1,
    verge: 0.2,
    drift: [2, 5],
    density: 1.8,
    clump: 2,
    maxSlope: 0.2,
    minHeight: WATER_LEVEL + 0.05,
    maxHeight: 14,
    minRoadDistance: 2.2,
    minWaterDistance: 0.1,
  },
  {
    id: "clover",
    plant: "white clover",
    head: "pompom",
    petal: "#EFE6E8",
    petalShade: "#B8AAAE",
    heart: "#C58FAE",
    stem: STEM_DARK,
    leaf: LEAF,
    height: 0.14,
    heads: 5,
    petals: 10,
    headRadius: 0.022,
    droop: 0.2,
    leaves: 4,
    leafLength: 0.07,
    leafWidth: 0.035,
    scale: [0.85, 1.3],
    sway: "stem",
    // Clover is the sward's own flower — it grows *through* grazed grass, so it
    // takes the mown verge and the pasture that everything taller loses.
    biomes: { meadow: 1, orchard: 0.8, farmland: 0.66, broadleaf: 0.3, shore: 0.12 },
    damp: 0.1,
    verge: 1.1,
    drift: [3.5, 9],
    density: 4.6,
    clump: 4,
    maxSlope: 0.52,
    minHeight: WATER_LEVEL + 0.3,
    maxHeight: TREE_LINE - 4,
    minRoadDistance: 1.4,
    minWaterDistance: 0.8,
  },
  {
    id: "thrift",
    plant: "sea thrift",
    head: "pompom",
    petal: "#DC8CA6",
    petalShade: "#96566E",
    heart: "#E9C3CE",
    stem: "#7E8A62",
    leaf: "#5E7050",
    height: 0.16,
    heads: 5,
    petals: 10,
    headRadius: 0.024,
    droop: 0.1,
    leaves: 5,
    leafLength: 0.08,
    leafWidth: 0.008,
    scale: [0.8, 1.35],
    sway: "stem",
    biomes: { shore: 1, heath: 0.2, highland: 0.12 },
    damp: -0.7,
    verge: 0.8,
    drift: [2.4, 6],
    density: 3.6,
    clump: 4,
    maxSlope: 0.6,
    minHeight: WATER_LEVEL + 0.2,
    maxHeight: 20,
    minRoadDistance: 1.6,
    minWaterDistance: 0.6,
  },
  {
    id: "seacampion",
    plant: "sea campion",
    head: "composite",
    petal: "#F2EDE0",
    petalShade: "#C4CBC0",
    heart: "#9FAE96",
    stem: "#8A9679",
    leaf: "#78876C",
    height: 0.2,
    heads: 4,
    petals: 5,
    headRadius: 0.026,
    droop: 0.35,
    leaves: 4,
    leafLength: 0.08,
    leafWidth: 0.022,
    scale: [0.8, 1.3],
    sway: "stem",
    biomes: { shore: 1, badlands: 0.14, highland: 0.16 },
    damp: -0.8,
    verge: 0.35,
    drift: [2, 5],
    density: 3,
    clump: 3,
    maxSlope: 0.62,
    minHeight: WATER_LEVEL + 0.2,
    maxHeight: 30,
    minRoadDistance: 1.6,
    minWaterDistance: 0.5,
  },
  {
    id: "blossomfall",
    plant: "orchard blossom fall",
    head: "fallen",
    petal: "#F2DCE0",
    petalShade: "#CFAFB8",
    heart: "#E8C98A",
    stem: STEM,
    leaf: LEAF,
    height: 0.012,
    heads: 1,
    petals: 9,
    headRadius: 0.026,
    droop: 0,
    leaves: 0,
    leafLength: 0,
    leafWidth: 0,
    scale: [0.9, 1.6],
    sway: "stem",
    // Not a plant at all — the petals off the trees above, lying where the wind
    // put them. It is the cheapest thing in this file and the one that makes
    // Cidergarth read as an orchard rather than a wood with fruit trees in it.
    // Over-weighted against a biome nothing else is shut out of: clover and cow
    // parsley both grow happily in an orchard and both out-competed the blossom
    // in the lottery, leaving Cidergarth with one drift of the one thing that
    // makes it an orchard.
    biomes: { orchard: 1.7 },
    damp: 0.2,
    verge: 0.8,
    drift: [2.5, 7],
    density: 3.2,
    clump: 3,
    maxSlope: 0.4,
    minHeight: WATER_LEVEL + 0.5,
    maxHeight: 40,
    minRoadDistance: 1.2,
    minWaterDistance: 1,
  },
];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type FlowerMesh = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
  /** Published because the whole point of building here is to be able to count. */
  triangles: number;
  vertices: number;
};

/**
 * A scratch pad with a frame on it.
 *
 * Every head is authored once, upright, about its own origin, and the frame
 * rotates it into place — which is what makes a nodding harebell and a
 * sky-facing buttercup the same twenty lines of petal code with one angle
 * changed.
 */
/** Ry(yaw) · Rx(tilt), row-major. */
function rotation(yaw: number, tilt: number): number[] {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return [ca, sa * st, sa * ct, 0, ct, -st, -sa, ca * st, ca * ct];
}

class FlowerBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  private ox = 0;
  private oy = 0;
  private oz = 0;
  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private bx = 0;
  private by = 0;
  private bz = 0;
  private base = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  /** Ry(yaw) · Rx(tilt), about a point. Reset with `frame(0, 0, 0, 0, 0)`. */
  frame(ox: number, oy: number, oz: number, yaw: number, tilt: number): void {
    const m = rotation(yaw, tilt);
    this.bx = this.ox = ox;
    this.by = this.oy = oy;
    this.bz = this.oz = oz;
    this.base = m;
    this.m = m;
  }

  /**
   * A frame inside the current one, without disturbing it.
   *
   * A raceme is twenty little bells each with its own hang, all of them living
   * in the head's frame, which is itself nodding off the top of a stem. Every
   * call composes against the *base* rather than the last sub-frame, so the
   * bells cannot accumulate each other's rotations.
   */
  subFrame(ox: number, oy: number, oz: number, yaw: number, tilt: number): void {
    const b = this.base;
    const l = rotation(yaw, tilt);
    this.ox = this.bx + b[0] * ox + b[1] * oy + b[2] * oz;
    this.oy = this.by + b[3] * ox + b[4] * oy + b[5] * oz;
    this.oz = this.bz + b[6] * ox + b[7] * oy + b[8] * oz;
    this.m = [
      b[0] * l[0] + b[1] * l[3] + b[2] * l[6],
      b[0] * l[1] + b[1] * l[4] + b[2] * l[7],
      b[0] * l[2] + b[1] * l[5] + b[2] * l[8],
      b[3] * l[0] + b[4] * l[3] + b[5] * l[6],
      b[3] * l[1] + b[4] * l[4] + b[5] * l[7],
      b[3] * l[2] + b[4] * l[5] + b[5] * l[8],
      b[6] * l[0] + b[7] * l[3] + b[8] * l[6],
      b[6] * l[1] + b[7] * l[4] + b[8] * l[7],
      b[6] * l[2] + b[7] * l[5] + b[8] * l[8],
    ];
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    colour: Rgb
  ): number {
    const m = this.m;
    const index = this.positions.length / 3;
    this.positions.push(
      this.ox + m[0] * x + m[1] * y + m[2] * z,
      this.oy + m[3] * x + m[4] * y + m[5] * z,
      this.oz + m[6] * x + m[7] * y + m[8] * z
    );
    this.normals.push(
      m[0] * nx + m[1] * ny + m[2] * nz,
      m[3] * nx + m[4] * ny + m[5] * nz,
      m[6] * nx + m[7] * ny + m[8] * nz
    );
    this.uvs.push(u, v);
    this.colors.push(colour[0], colour[1], colour[2]);
    return index;
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  build(): FlowerMesh {
    return {
      positions: Float32Array.from(this.positions),
      normals: Float32Array.from(this.normals),
      uvs: Float32Array.from(this.uvs),
      colors: Float32Array.from(this.colors),
      indices: Uint16Array.from(this.indices),
      triangles: this.indices.length / 3,
      vertices: this.positions.length / 3,
    };
  }
}

type PetalOptions = {
  /** Attachment point in the current frame. */
  ox: number;
  oy: number;
  oz: number;
  /** Which way round the head it points, and how far above / below horizontal. */
  spin: number;
  pitch: number;
  length: number;
  width: number;
  /** Midrib lift as a fraction of width — the difference between a petal and a
   *  flake of paper. */
  cup: number;
  /** Tip fall as a fraction of length. */
  sag: number;
  /** Lengthwise segments. Two near, one at the middle level of detail. */
  rows: number;
  base: Rgb;
  tip: Rgb;
  /** Depth of the cleft in the tip, as a fraction of length. Cornflower, campion. */
  notch: number;
};

/**
 * One petal: a cupped, drooping, three-column strip.
 *
 * The three columns are the whole reason this is not a quad. A flat quad lit
 * from a low afternoon sun is a single flat tone whichever way it faces, and a
 * flower made of them reads as coloured litter; the raised midrib gives every
 * petal a lit half and a shaded half from any angle, which is what makes a
 * buttercup look like it has a cup in it at two metres.
 */
function addPetal(b: FlowerBuilder, o: PetalOptions): void {
  const cy = Math.cos(o.pitch);
  const sy = Math.sin(o.pitch);
  const ca = Math.cos(o.spin);
  const sa = Math.sin(o.spin);

  // Forward along the petal, sideways across it, up out of its face.
  const fx = ca * cy;
  const fy = sy;
  const fz = sa * cy;
  const sx = -sa;
  const sz = ca;
  const ux = -sy * ca;
  const uy = cy;
  const uz = -sy * sa;

  const rows: number[][] = [];
  for (let r = 0; r <= o.rows; r++) {
    const t = r / o.rows;
    const w =
      o.width * Math.pow(Math.sin(Math.PI * (0.06 + 0.9 * t)), 0.75);
    const colour = mixRgb(o.base, o.tip, t * 0.9 + 0.08);
    const row: number[] = [];
    for (let k = -1; k <= 1; k++) {
      // The cleft is a pulled-back centre vertex on the last row: two lobes for
      // the price of nothing, which is how a cornflower gets its ragged edge.
      const along =
        o.length * t - (r === o.rows && k === 0 ? o.notch * o.length : 0);
      const lift = o.cup * o.width * (1 - k * k) - o.sag * o.length * t * t;
      const across = k * w;
      const px = o.ox + fx * along + ux * lift + sx * across;
      const py = o.oy + fy * along + uy * lift;
      const pz = o.oz + fz * along + uz * lift + sz * across;
      // Normals tilt off the cup and forward with the sag, so a curled petal
      // shades along its length instead of flashing one flat value.
      let nx = ux + sx * (k * o.cup * 1.5) + fx * (o.sag * t * 1.3);
      let ny = uy + fy * (o.sag * t * 1.3);
      let nz = uz + sz * (k * o.cup * 1.5) + fz * (o.sag * t * 1.3);
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      row.push(
        b.vertex(
          px,
          py,
          pz,
          nx,
          ny,
          nz,
          (k + 1) * 0.5,
          t,
          k === 0 ? colour : shade(colour, 0.93)
        )
      );
    }
    rows.push(row);
  }

  for (let r = 0; r < o.rows; r++) {
    b.quad(rows[r][0], rows[r][1], rows[r + 1][1], rows[r + 1][0]);
    b.quad(rows[r][1], rows[r][2], rows[r + 1][2], rows[r + 1][1]);
  }
}

/** A domed disc: composite eye, poppy boss, floret. `segments` triangles. */
function addDisc(
  b: FlowerBuilder,
  ox: number,
  oy: number,
  oz: number,
  radius: number,
  rise: number,
  segments: number,
  rim: Rgb,
  core: Rgb
): void {
  // A negative rise is a cup — the mouth of a bell — and its face points the
  // other way. Getting this wrong lights every hanging flower from underneath.
  const up = rise >= 0 ? 1 : -1;
  const centre = b.vertex(ox, oy + rise, oz, 0, up, 0, 0.5, 0.5, core);
  const ring: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    ring.push(
      b.vertex(
        ox + dx * radius,
        oy,
        oz + dz * radius,
        dx * 0.5,
        0.86 * up,
        dz * 0.5,
        0.5 + dx * 0.5,
        0.5 + dz * 0.5,
        rim
      )
    );
  }
  for (let i = 0; i < segments; i++) {
    b.tri(centre, ring[i], ring[(i + 1) % segments]);
  }
}

/** A flat tapered ribbon between two points — umbel ray, cotton filament. */
function addRibbon(
  b: FlowerBuilder,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  halfWidth: number,
  base: Rgb,
  tip: Rgb
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const length = Math.hypot(dx, dz) || 1;
  const px = (-dz / length) * halfWidth;
  const pz = (dx / length) * halfWidth;
  const a = b.vertex(x0 - px, y0, z0 - pz, 0, 1, 0, 0, 0, base);
  const c = b.vertex(x0 + px, y0, z0 + pz, 0, 1, 0, 1, 0, base);
  const d = b.vertex(x1 + px * 0.35, y1, z1 + pz * 0.35, 0, 1, 0, 1, 1, tip);
  const e = b.vertex(x1 - px * 0.35, y1, z1 - pz * 0.35, 0, 1, 0, 0, 1, tip);
  b.quad(a, c, d, e);
}

/** A tapered n-gon tube along a bent path: stems, and the tube of a bell. */
function addTube(
  b: FlowerBuilder,
  points: number[][],
  radii: number[],
  sides: number,
  base: Rgb,
  tip: Rgb
): void {
  const rings: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    const t = i / Math.max(1, points.length - 1);
    const colour = mixRgb(base, tip, t);
    const ring: number[] = [];
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      ring.push(
        b.vertex(
          points[i][0] + nx * radii[i],
          points[i][1],
          points[i][2] + nz * radii[i],
          nx * 0.97,
          0.243,
          nz * 0.97,
          s / sides,
          t,
          colour
        )
      );
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const n = (s + 1) % sides;
      b.quad(rings[i][s], rings[i + 1][s], rings[i + 1][n], rings[i][n]);
    }
  }
}

/**
 * A flowering stem, bent over toward the head it carries.
 *
 * Three sides. A stem is two millimetres across; the silhouette of a triangle
 * and a cylinder are the same thing at any distance a flower is ever seen from,
 * and the difference is a third of the triangles in the plant.
 */
function addStem(
  b: FlowerBuilder,
  yaw: number,
  reach: number,
  height: number,
  radius: number,
  segments: number,
  base: Rgb,
  tip: Rgb
): void {
  const points: number[][] = [];
  const radii: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Quadratic lean, so the base stands up out of the ground and the bend
    // gathers under the weight of the head.
    const out = reach * t * t;
    points.push([Math.cos(yaw) * out, height * t, Math.sin(yaw) * out]);
    radii.push(radius * (1 - t * 0.45));
  }
  addTube(b, points, radii, 3, base, tip);
}

/** A basal leaf: the petal builder, in green, lying along the ground. */
function addLeaf(
  b: FlowerBuilder,
  spin: number,
  length: number,
  width: number,
  rows: number,
  base: Rgb,
  tip: Rgb
): void {
  addPetal(b, {
    ox: 0,
    oy: 0.012,
    oz: 0,
    spin,
    pitch: 0.55,
    length,
    width,
    cup: 0.4,
    sag: 0.7,
    rows,
    base,
    tip,
    notch: 0,
  });
}

type Palette = {
  petal: Rgb;
  petalShade: Rgb;
  heart: Rgb;
  stem: Rgb;
  stemDark: Rgb;
  leaf: Rgb;
};

/**
 * One head, authored upright about the origin of the current frame.
 *
 * `detail` halves the petal count and the lengthwise segments rather than
 * swapping in a different shape — a flower that changes silhouette between
 * levels of detail pops, and the outline is the only thing carrying it at the
 * distance the swap happens.
 */
function addHead(
  b: FlowerBuilder,
  spec: FlowerSpec,
  p: Palette,
  detail: boolean,
  seed: number
): void {
  const r = spec.headRadius;
  const rows = detail ? 2 : 1;
  const petals = detail ? spec.petals : Math.max(3, Math.round(spec.petals * 0.6));

  switch (spec.head) {
    case "umbel": {
      // A cow parsley plate: rays out to a rim, a floret on each. Flat, white
      // and lacy — read from above at knee height, it is a doily on a stick.
      for (let i = 0; i < petals; i++) {
        const angle = i * 2.39996 + seed;
        const reach = r * (0.62 + hash2(i + seed, 3) * 0.42);
        const lift = r * 0.12 * (1 - hash2(i, seed) * 0.5);
        const ex = Math.cos(angle) * reach;
        const ez = Math.sin(angle) * reach;
        addRibbon(b, 0, 0, 0, ex, lift, ez, r * 0.035, p.stemDark, p.petalShade);
        addDisc(
          b,
          ex,
          lift,
          ez,
          r * 0.3,
          r * 0.05,
          detail ? 4 : 3,
          p.petal,
          p.heart
        );
      }
      break;
    }
    case "composite": {
      for (let i = 0; i < petals; i++) {
        const angle = (i / petals) * Math.PI * 2 + seed;
        addPetal(b, {
          ox: 0,
          oy: 0,
          oz: 0,
          spin: angle,
          pitch: 0.42,
          length: r,
          width: r * 0.72,
          cup: 0.5,
          sag: 0.22,
          rows,
          base: p.petalShade,
          tip: p.petal,
          notch: spec.id === "seacampion" ? 0.16 : 0,
        });
      }
      addDisc(b, 0, r * 0.16, 0, r * 0.3, r * 0.12, detail ? 5 : 3, p.heart, p.heart);
      break;
    }
    case "poppy": {
      // Four big cupped petals and a black boss. The petals overlap and the
      // cup is deep — a poppy is a bowl, not a star.
      for (let i = 0; i < petals; i++) {
        const angle = (i / petals) * Math.PI * 2 + seed * 0.7;
        addPetal(b, {
          ox: 0,
          oy: 0,
          oz: 0,
          spin: angle,
          pitch: 0.75,
          length: r * 1.05,
          width: r * 1.1,
          cup: 0.65,
          sag: 0.12,
          rows: rows + 1,
          base: p.petalShade,
          tip: p.petal,
          notch: 0,
        });
      }
      addDisc(b, 0, r * 0.42, 0, r * 0.28, r * 0.14, detail ? 6 : 4, p.heart, p.heart);
      break;
    }
    case "ray": {
      // Cornflower: narrow ray florets, each cleft at the tip, splayed out of a
      // tight cup. The notch is what stops the head reading as a daisy.
      for (let i = 0; i < petals; i++) {
        const angle = (i / petals) * Math.PI * 2 + seed;
        addPetal(b, {
          ox: 0,
          oy: r * 0.3,
          oz: 0,
          spin: angle,
          pitch: 0.5 + hash2(i, seed) * 0.35,
          length: r * 1.15,
          width: r * 0.38,
          cup: 0.55,
          sag: 0.1,
          rows,
          base: p.petalShade,
          tip: p.petal,
          notch: 0.22,
        });
      }
      addTube(
        b,
        [
          [0, 0, 0],
          [0, r * 0.34, 0],
        ],
        [r * 0.34, r * 0.26],
        5,
        p.leaf,
        p.heart
      );
      break;
    }
    case "bell": {
      // Harebell: a flared tube hanging off the frame's tilt, with a scalloped
      // rim of short reflexed lobes.
      const sides = detail ? 6 : 4;
      addTube(
        b,
        [
          [0, 0, 0],
          [0, -r * 0.7, 0],
          [0, -r * 1.5, 0],
        ],
        [r * 0.14, r * 0.62, r * 0.9],
        sides,
        p.petalShade,
        p.petal
      );
      if (detail) {
        for (let i = 0; i < sides; i++) {
          const angle = (i / sides) * Math.PI * 2;
          addPetal(b, {
            ox: Math.cos(angle) * r * 0.9,
            oy: -r * 1.5,
            oz: Math.sin(angle) * r * 0.9,
            spin: angle,
            pitch: -0.9,
            length: r * 0.5,
            width: r * 0.4,
            cup: 0.3,
            sag: 0.1,
            rows: 1,
            base: p.petal,
            tip: p.petalShade,
            notch: 0,
          });
        }
      }
      break;
    }
    case "raceme": {
      // Bell heather: a stack of tiny urns up the last third of the shoot. Each
      // is four triangles; the colour comes from having twenty of them.
      const bells = detail ? petals : Math.max(4, Math.round(petals * 0.6));
      for (let i = 0; i < bells; i++) {
        const t = i / bells;
        const y = -t * spec.height * 0.42;
        const angle = i * 2.39996;
        const size = r * (1.2 - t * 0.45);
        b.subFrame(
          Math.cos(angle) * size * 1.5,
          y,
          Math.sin(angle) * size * 1.5,
          angle,
          1.1
        );
        addTube(
          b,
          [
            [0, 0, 0],
            [0, -size * 2.2, 0],
          ],
          [size * 0.45, size * 1.15],
          3,
          p.petalShade,
          p.petal
        );
        addDisc(b, 0, -size * 2.2, 0, size * 1.15, -size * 0.3, 3, p.petal, p.heart);
      }
      break;
    }
    case "spire": {
      // Foxglove: bells hanging one side of the stem, biggest at the bottom,
      // unopened buds at the tip. That gradient is the plant's whole signature.
      const bells = detail ? petals : Math.max(4, Math.round(petals * 0.55));
      const face = seed * 1.7;
      for (let i = 0; i < bells; i++) {
        const t = i / bells;
        const y = -t * spec.height * 0.4;
        const size = r * (1 - t * 0.55);
        const angle = face + (i % 2 === 0 ? 0.42 : -0.42) + t * 0.5;
        b.subFrame(
          Math.cos(angle) * size * 0.9,
          y,
          Math.sin(angle) * size * 0.9,
          angle,
          1.35
        );
        if (t > 0.72) {
          addDisc(b, 0, 0, 0, size * 0.8, -size * 1.1, 4, p.petalShade, p.petalShade);
        } else {
          addTube(
            b,
            [
              [0, 0, 0],
              [0, -size * 1.4, 0],
              [0, -size * 2.6, 0],
            ],
            [size * 0.5, size * 1.0, size * 0.92],
            detail ? 5 : 4,
            p.petalShade,
            p.petal
          );
          addDisc(b, 0, -size * 2.6, 0, size * 0.92, -size * 0.35, 4, p.petal, p.heart);
        }
      }
      break;
    }
    case "pompom": {
      // Clover and thrift: a dome of florets. Built as a ring of little discs
      // over a core disc, which at three centimetres is indistinguishable from
      // the forty individual florets actually up there.
      addDisc(b, 0, 0, 0, r, r * 0.5, detail ? 7 : 5, p.petalShade, p.petal);
      const florets = detail ? Math.round(petals * 0.6) : 3;
      for (let i = 0; i < florets; i++) {
        const angle = i * 2.39996 + seed;
        const spread = r * (0.35 + hash2(i, seed + 7) * 0.55);
        addDisc(
          b,
          Math.cos(angle) * spread,
          r * (0.3 + hash2(i + 3, seed) * 0.3),
          Math.sin(angle) * spread,
          r * 0.42,
          r * 0.2,
          3,
          p.petal,
          p.heart
        );
      }
      break;
    }
    case "cotton": {
      // Bog cotton: a nodding tuft of filaments. Ribbons hanging outward and
      // down, which catches the light as a white smudge exactly as the real
      // thing does across a fen.
      for (let i = 0; i < petals; i++) {
        const angle = i * 2.39996 + seed;
        const reach = r * (0.5 + hash2(i, seed) * 0.8);
        const drop = -r * (0.3 + hash2(i + 5, seed) * 0.9);
        addRibbon(
          b,
          0,
          0,
          0,
          Math.cos(angle) * reach,
          drop,
          Math.sin(angle) * reach,
          r * 0.16,
          p.petalShade,
          p.petal
        );
      }
      break;
    }
    case "iris": {
      // Three falls hanging out and down, three standards held up between them.
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * Math.PI * 2 + seed;
        addPetal(b, {
          ox: 0,
          oy: 0,
          oz: 0,
          spin: angle,
          pitch: 0.1,
          length: r * 1.15,
          width: r * 0.66,
          cup: 0.42,
          sag: 0.85,
          rows: rows + 1,
          base: p.heart,
          tip: p.petal,
          notch: 0,
        });
        if (!detail) continue;
        addPetal(b, {
          ox: 0,
          oy: r * 0.1,
          oz: 0,
          spin: angle + Math.PI / 3,
          pitch: 1.05,
          length: r * 0.7,
          width: r * 0.3,
          cup: 0.55,
          sag: 0.2,
          rows,
          base: p.petalShade,
          tip: p.petal,
          notch: 0,
        });
      }
      break;
    }
    case "fallen": {
      // Petals on the ground. Scattered flat, a few tipped on edge where they
      // have caught on a grass stem.
      for (let i = 0; i < petals; i++) {
        const angle = i * 2.39996 + seed;
        const spread = r * (1.2 + hash2(i, seed) * 6);
        b.subFrame(
          Math.cos(angle) * spread,
          0,
          Math.sin(angle) * spread,
          angle * 1.7,
          hash2(i + 9, seed) * 0.5
        );
        addPetal(b, {
          ox: 0,
          oy: 0.004,
          oz: 0,
          spin: hash2(i, seed + 2) * Math.PI * 2,
          pitch: 0,
          length: r * 1.1,
          width: r * 0.8,
          cup: 0.35,
          sag: 0,
          rows: 1,
          base: p.petalShade,
          tip: p.petal,
          notch: 0.1,
        });
      }
      break;
    }
  }
}

export type FlowerLod = 0 | 1 | 2;

/**
 * A whole plant at one level of detail.
 *
 * 0 — stems, leaves and real petals, for the two dozen metres you can actually
 *     see a petal in.
 * 1 — one stem, one head, half the petals.
 * 2 — crossed cards: a stem line and a lozenge of flower colour.
 */
export function buildFlowerMesh(spec: FlowerSpec, lod: FlowerLod): FlowerMesh {
  const b = new FlowerBuilder();
  const p: Palette = {
    petal: hexRgb(spec.petal),
    petalShade: hexRgb(spec.petalShade),
    heart: hexRgb(spec.heart),
    stem: hexRgb(spec.stem),
    stemDark: hexRgb(STEM_DARK),
    leaf: hexRgb(spec.leaf),
  };

  if (lod === 2) return buildCard(b, spec, p);

  const detail = lod === 0;
  const heads = detail ? spec.heads : Math.max(1, Math.round(spec.heads * 0.4));
  const leaves = detail ? spec.leaves : Math.min(spec.leaves, 2);
  // Two families of head, and `droop` means the opposite thing in each. A
  // buttercup is authored facing the sky and `droop` tips it over; a harebell
  // is authored hanging and `droop` is how *little* its stalk leans. Folding
  // both into one angle is what produced a first pass of harebells sticking
  // out sideways like trumpets.
  const hanging =
    spec.head === "bell" ||
    spec.head === "raceme" ||
    spec.head === "spire" ||
    spec.head === "cotton";
  const tilt = hanging ? (1 - spec.droop) * 0.6 : spec.droop * 1.25;

  for (let i = 0; i < leaves; i++) {
    b.frame(0, 0, 0, 0, 0);
    addLeaf(
      b,
      i * 2.39996 + 0.6,
      spec.leafLength * (0.7 + hash2(i, 11) * 0.6),
      spec.leafWidth,
      detail ? 2 : 1,
      shade(p.leaf, 0.62),
      p.leaf
    );
  }

  for (let i = 0; i < heads; i++) {
    const yaw = i * 2.39996 + hash2(i, 23) * 0.7;
    const height = spec.height * (0.66 + hash2(i * 3, 5) * 0.5);
    const reach = spec.height * (0.06 + hash2(i, 31) * 0.22);
    b.frame(0, 0, 0, 0, 0);
    if (spec.head !== "fallen") {
      addStem(
        b,
        yaw,
        reach,
        height,
        spec.height * 0.014,
        detail ? 3 : 2,
        shade(p.stem, 0.7),
        p.stem
      );
    }
    b.frame(
      Math.cos(yaw) * reach,
      height,
      Math.sin(yaw) * reach,
      yaw,
      tilt
    );
    addHead(b, spec, p, detail, i * 1.7 + 0.3);
  }

  return b.build();
}

/**
 * The far card.
 *
 * Two crossed planes, each a stem line under a lozenge of petal colour, and no
 * texture at all — a flower is one or two pixels at the distance this takes
 * over, and an alpha map on a two-pixel sprite is a fetch, a bind and a
 * discard for nothing.
 *
 * The head is drawn at about twice life size on purpose. What has to survive to
 * sixty metres is not the flower, it is the *drift* — and a drift only reads
 * when each of its two hundred cards contributes a pixel of colour rather than a
 * third of one, which is the same reason the tree billboards overhang their
 * trunks.
 */
function buildCard(b: FlowerBuilder, spec: FlowerSpec, p: Palette): FlowerMesh {
  const height = spec.head === "fallen" ? 0.02 : spec.height * 0.92;
  const r = Math.max(spec.headRadius * 2.1, spec.height * 0.09);
  const stemHalf = Math.max(0.006, r * 0.12);
  const stemBase = shade(p.stem, 0.75);

  for (let i = 0; i < 2; i++) {
    const angle = i * Math.PI * 0.5;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    // Leaned well up, so a flat card still catches the sky rather than going
    // black whenever the sun is behind it.
    const nx = Math.sin(angle) * 0.4;
    const nz = -Math.cos(angle) * 0.4;
    b.frame(0, 0, 0, 0, 0);

    if (spec.head !== "fallen") {
      const top = height - r * 0.5;
      const a = b.vertex(-dx * stemHalf, 0, -dz * stemHalf, nx, 0.8, nz, 0, 0, stemBase);
      const c = b.vertex(dx * stemHalf, 0, dz * stemHalf, nx, 0.8, nz, 1, 0, stemBase);
      const d = b.vertex(dx * stemHalf, top, dz * stemHalf, nx, 0.8, nz, 1, 1, p.stem);
      const e = b.vertex(-dx * stemHalf, top, -dz * stemHalf, nx, 0.8, nz, 0, 1, p.stem);
      b.quad(a, c, d, e);
    }

    const cy = spec.head === "fallen" ? r * 0.35 : height;
    const bottom = b.vertex(0, cy - r, 0, nx, 0.8, nz, 0.5, 0, p.petalShade);
    const left = b.vertex(-dx * r, cy, -dz * r, nx, 0.8, nz, 0, 0.5, p.petal);
    const top2 = b.vertex(0, cy + r * 0.85, 0, nx, 0.8, nz, 0.5, 1, p.petal);
    const right = b.vertex(dx * r, cy, dz * r, nx, 0.8, nz, 1, 0.5, p.petal);
    b.quad(bottom, right, top2, left);
  }

  return b.build();
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export type FlowerPlacement = {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
};

export type FlowerField = {
  spec: FlowerSpec;
  items: FlowerPlacement[];
  /** Drifts this species ended up owning. Reported, because it is the thing
   *  that goes wrong: a species with plants but no drifts is confetti. */
  drifts: number;
};

export type FlowerStats = {
  /** Drift sites considered — one candidate per cell of the drift grid. */
  candidates: number;
  /** Drifts that survived the ground, the biome and the global thinning. */
  drifts: number;
  placed: number;
  /** Rosettes rejected by the fine ground checks after their drift was sited. */
  rejected: number;
};

const HALF_WORLD = WORLD_SIZE / 2;

/**
 * One candidate drift per twelve metres.
 *
 * The cell has to be a little larger than the drifts themselves or neighbouring
 * drifts merge into continuous cover and the bare ground between them — the
 * entire effect — disappears.
 */
const DRIFT_CELL = 12;

function distanceToWater(x: number, z: number): number {
  let best = Infinity;
  for (const water of WATERS) {
    const gap = Math.hypot(x - water.x, z - water.z) - water.radius;
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * How much of anything grows here, on `bakeGrassGround`'s terms.
 *
 * Identical masks and identical thresholds to the grass cover channel, because
 * two systems that disagree about where the ground is produce flowers standing
 * in the lake and buttercups on the carriageway. The species' own height band
 * and slope tolerance are applied on top of this, not instead of it.
 */
function groundCover(x: number, z: number, y: number, slope: number): number {
  let cover = smoothstep(WATER_LEVEL + 0.15, WATER_LEVEL + 1, y);
  if (cover <= 0) return 0;
  cover *= smoothstep(0.3, 2.2, distanceToWater(x, z));
  cover *= smoothstep(ROAD_HALF_WIDTH * 0.72, ROAD_HALF_WIDTH + 0.55, distanceToRoad(x, z));
  cover *= 1 - smoothstep(0.48, 0.72, slope);
  cover *= 1 - smoothstep(TREE_LINE + 16, TREE_LINE + 48, y);
  return cover;
}

type Ground = { y: number; dydx: number; dydz: number; slope: number };

/**
 * The ground under a rosette, sampled once for all of it. Three `heightAt`
 * calls instead of one per plant, and the gradient carries each plant in the
 * rosette to its own height — the same trade `Flora.tsx` makes for tufts.
 */
function sampleGround(x: number, z: number, out: Ground): void {
  const y = heightAt(x, z);
  const step = 1.2;
  out.y = y;
  out.dydx = (heightAt(x + step, z) - y) / step;
  out.dydz = (heightAt(x, z + step) - y) / step;
  const gradient = Math.hypot(out.dydx, out.dydz);
  out.slope = 1 - 1 / Math.sqrt(1 + gradient * gradient);
}

const scratch: Ground = { y: 0, dydx: 0, dydz: 0, slope: 0 };

/**
 * Sites every drift in the valley and fills it.
 *
 * Two passes over one grid. The first works out what each cell could support
 * and which species would win it; the second knows the total and can therefore
 * hit a population target. When the target is below what the world could carry
 * the thinning drops *whole drifts* rather than thinning every drift evenly —
 * a low-end machine should see fewer patches of flowers, not a uniform haze of
 * them, because a thinned drift stops being a drift.
 */
export function placeFlowers(options: {
  count: number;
  seed?: number;
}): { fields: FlowerField[]; stats: FlowerStats } {
  const seed = options.seed ?? 20260727;
  const cells = Math.ceil(WORLD_SIZE / DRIFT_CELL);
  const total = cells * cells;

  const cellX = new Float32Array(total);
  const cellZ = new Float32Array(total);
  const cellY = new Float32Array(total);
  const cellDydx = new Float32Array(total);
  const cellDydz = new Float32Array(total);
  const cellChance = new Float32Array(total);
  const cellRadius = new Float32Array(total);
  const cellSpecies = new Int16Array(total).fill(-1);

  let potential = 0;
  let candidates = 0;

  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const cell = j * cells + i;
      const jx = hash2(seed + cell * 3, cell * 7) - 0.5;
      const jz = hash2(cell * 11 + 5, seed + cell) - 0.5;
      const x = -HALF_WORLD + (i + 0.5 + jx * 0.85) * DRIFT_CELL;
      const z = -HALF_WORLD + (j + 0.5 + jz * 0.85) * DRIFT_CELL;

      sampleGround(x, z, scratch);
      const cover = groundCover(x, z, scratch.y, scratch.slope);
      if (cover <= 0.03) continue;
      candidates++;

      // Damp hollows and shelter. A ring of samples eighteen metres out: ground
      // that stands higher all round is a hollow that holds water and breaks the
      // wind, and that is where flowers actually mass. This is the "why" behind
      // the patch shape — drifts sit in the folds of the land, not on a grid.
      const relief =
        (heightAt(x + 18, z) +
          heightAt(x - 18, z) +
          heightAt(x, z + 18) +
          heightAt(x, z - 18)) *
          0.25 -
        scratch.y;
      const hollow = clamp01(relief * 0.35 + 0.5);

      // Where drifts are at all: a sixty-metre field, so the valley has flowery
      // quarters and plain ones rather than an even sprinkle.
      const bloom = clamp01((fbm(x * 0.017 + 31.7, z * 0.017 - 12.3, 2) - 0.34) * 2.6);
      if (bloom <= 0) continue;

      // The verge. Mown once a year, unploughed, and lit from the side — the
      // richest few metres in any farmed landscape, and by luck the only ground
      // the bard ever walks.
      const road = distanceToRoad(x, z);
      const verge = 1 - smoothstep(4, 17, road);

      const weights = biomeWeights(x, z);

      let bestScore = 0;
      let best = -1;
      for (let s = 0; s < FLOWERS.length; s++) {
        const spec = FLOWERS[s];
        if (scratch.slope > spec.maxSlope) continue;
        if (scratch.y < spec.minHeight || scratch.y > spec.maxHeight) continue;
        if (road < spec.minRoadDistance) continue;

        let suit = 0;
        for (const key of Object.keys(weights) as BiomeId[]) {
          const want = spec.biomes[key];
          if (want) suit += want * (weights[key] as number);
        }
        if (suit <= 0.02) continue;

        suit *= 1 + spec.damp * (hollow - 0.45);
        suit *= 1 + spec.verge * verge * 1.4;
        if (suit <= 0) continue;

        // Each species owns its own low-frequency field, so which flower wins
        // moves in patches thirty metres across. Without this the argmax is a
        // fixed function of biome and every drift in a region is the same
        // species — a valley of nothing but buttercups.
        const own = fbm(x * 0.03 + s * 41.3, z * 0.03 - s * 27.9, 2);
        const score = suit * (0.2 + own * 1.6);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (best < 0) continue;

      const spec = FLOWERS[best];
      const radius = lerp(
        spec.drift[0],
        spec.drift[1],
        hash2(cell * 17 + seed, cell * 5) * bloom
      );
      // Cover gates the *chance* of a drift, not its density: half-shaded,
      // half-blocked ground gets fewer patches, not thin ones.
      // Ashenreach is red stone and nothing grows on it. The species table
      // alone does not deliver that, because biomes blend over sixty metres and
      // the heath next door leaks its heather across the border — so the
      // badlands veto the drift outright rather than merely not voting for it.
      const barren = 1 - 0.92 * (weights.badlands ?? 0);
      const chance = clamp01(
        bloom * cover * barren * (0.35 + verge * 0.85) * (0.6 + bestScore)
      );

      cellX[cell] = x;
      cellZ[cell] = z;
      cellY[cell] = scratch.y;
      cellDydx[cell] = scratch.dydx;
      cellDydz[cell] = scratch.dydz;
      cellChance[cell] = chance;
      cellRadius[cell] = radius;
      cellSpecies[cell] = best;

      // 0.55 is the share of a drift's disc that survives the ragged-edge cut
      // below. Measured, not guessed — it is what makes the requested count and
      // the delivered count land within a few percent of each other.
      potential += chance * Math.PI * radius * radius * spec.density * 0.55;
    }
  }

  const fields: FlowerField[] = FLOWERS.map((spec) => ({
    spec,
    items: [],
    drifts: 0,
  }));
  const stats: FlowerStats = { candidates, drifts: 0, placed: 0, rejected: 0 };
  if (potential <= 0) return { fields, stats };

  const gain = options.count / potential;
  // Density moves a little, drift count carries the rest. Below 0.6 a drift
  // stops looking like one; above 1.9 the plants interpenetrate.
  const densityGain = Math.min(1.9, Math.max(0.6, gain));
  const driftKeep = clamp01(gain / densityGain);

  for (let cell = 0; cell < total; cell++) {
    const species = cellSpecies[cell];
    if (species < 0) continue;
    if (hash2(cell * 23 + seed * 3, cell + 91) >= cellChance[cell] * driftKeep) continue;

    const spec = FLOWERS[species];
    const field = fields[species];
    const cx = cellX[cell];
    const cz = cellZ[cell];
    const radius = cellRadius[cell];
    const rosettes = Math.max(
      1,
      Math.round(
        (Math.PI * radius * radius * spec.density * densityGain) / spec.clump
      )
    );

    let planted = 0;
    for (let k = 0; k < rosettes; k++) {
      const key = cell * 61 + k;
      const angle = hash2(seed + key * 3, key) * Math.PI * 2;
      // ^0.8 rather than a plain sqrt: slightly centre-heavy, so a drift has a
      // core and a thinning fringe instead of a hard rim.
      const spread =
        Math.pow(hash2(key * 5, seed + key * 7), 0.8) * radius;
      const px = cx + Math.cos(angle) * spread;
      const pz = cz + Math.sin(angle) * spread;

      // The ragged edge. A three-metre noise field eats bites out of the disc,
      // so no drift has a circular outline and two neighbouring drifts of the
      // same species run into each other in a lobed, natural way.
      const edge =
        (1 - spread / radius) * 1.25 +
        (fbm(px * 0.33, pz * 0.33, 2) - 0.5) * 1.15 -
        0.42;
      if (edge <= 0) continue;

      sampleGround(px, pz, scratch);
      if (scratch.slope > spec.maxSlope) {
        stats.rejected++;
        continue;
      }
      if (scratch.y < spec.minHeight || scratch.y > spec.maxHeight) {
        stats.rejected++;
        continue;
      }
      if (groundCover(px, pz, scratch.y, scratch.slope) <= 0.05) {
        stats.rejected++;
        continue;
      }
      if (distanceToRoad(px, pz) < spec.minRoadDistance) {
        stats.rejected++;
        continue;
      }
      if (distanceToWater(px, pz) < spec.minWaterDistance) {
        stats.rejected++;
        continue;
      }
      // Buildings, walls, carts and tree trunks, from the one registry
      // everything else in the world collides against.
      if (isBlocked(px, pz, 0.6)) {
        stats.rejected++;
        continue;
      }

      for (let n = 0; n < spec.clump; n++) {
        const sub = key * 13 + n;
        const a = hash2(sub * 3 + seed, sub) * Math.PI * 2;
        const r = Math.sqrt(hash2(sub * 9, sub + seed)) * 0.22;
        const ox = Math.cos(a) * r;
        const oz = Math.sin(a) * r;
        field.items.push({
          x: px + ox,
          // Sunk a touch, so plants meet the drawn level-of-detail mesh — which
          // sits below `heightAt` between its vertices — instead of hovering.
          y: scratch.y + scratch.dydx * ox + scratch.dydz * oz - 0.02,
          z: pz + oz,
          scale: lerp(
            spec.scale[0],
            spec.scale[1],
            hash2(seed * 7 + sub, sub * 17)
          ),
          yaw: hash2(sub, seed * 19 + sub) * Math.PI * 2,
          // Flowers stand up out of a slope far more than grass lies along it:
          // a stem is stiff and phototropic. A quarter of the ground gradient.
          tiltX: -scratch.dydz * 0.25,
          tiltZ: scratch.dydx * 0.25,
        });
        planted++;
      }
    }

    if (planted > 0) {
      field.drifts++;
      stats.drifts++;
      stats.placed += planted;
    }
  }

  return { fields, stats };
}

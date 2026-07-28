/**
 * Where people live.
 *
 * The terrain says where the ground is and the roads say where you can walk;
 * this decides where somebody decided to build. That ordering matters — a
 * settlement laid out before the landform exists ends up half in a river, and
 * one laid out without reference to the road ends up as a cluster of sheds in a
 * field that nobody could ever have reached.
 *
 * The hard rule, and the reason this file is a placement *pass* rather than a
 * table of coordinates: **nothing sits on a road.** A building whose footprint
 * touches the carriageway is the loudest tell there is that a world was
 * assembled rather than settled, and eyeballing a few hundred coordinates
 * against ten Catmull-Rom curves does not catch it. So every candidate position
 * is tested — road clearance, footprint overlap, freeboard above the waterline,
 * slope — and rejected until one passes or the budget runs out, in which case
 * the structure is simply dropped. A missing haystack costs nothing. A cottage
 * in the middle of the lane costs the whole illusion.
 *
 * The only two exemptions are bridges and gates, and they are exemptions in
 * name only: a bridge *is* the road for those few metres, and a town gate is
 * built to straddle one. Both keep their solid parts — parapets, gate towers —
 * outside the carriageway; see `structureColliders`.
 *
 * Everything here is deterministic. Same layout on every load, every machine,
 * every reload, which is what lets the NPC schedules, the bard's itinerary and
 * the collision registry all be authored against fixed positions.
 */

import * as THREE from "three";

import type { Collider } from "./collision";
import {
  ROADS,
  ROAD_HALF_WIDTH,
  WATERS,
  WATER_LEVEL,
  distanceToRoad,
  heightAt,
  nearestRoadPoint,
  roadHeight,
  slopeAt,
} from "./terrain";

export type StructureKind =
  | "cottage"
  | "longhouse"
  | "barn"
  | "windmill"
  | "watchtower"
  | "chapel"
  | "well"
  | "market_stall"
  | "forge"
  | "inn"
  | "dock"
  | "bridge"
  | "fence"
  | "shrine"
  | "ruin"
  | "camp"
  | "standing_stones"
  | "quarry"
  | "lighthouse"
  | "gate"
  | "haystack"
  | "woodpile"
  | "signpost"
  | "cart";

export type Structure = {
  id: string;
  kind: StructureKind;
  x: number;
  z: number;
  /**
   * The height the structure is built from. Ground level for everything that
   * stands on land; the waterline for docks, and the graded road surface for
   * bridges and gates, because those are the heights those things have to
   * agree with.
   */
  y: number;
  rotation: number;
  scale: number;
  /** Collision footprint: the circumscribed circle, already scaled. */
  radius: number;
  settlementId?: string;
};

export type Settlement = {
  id: string;
  name: string;
  kind: "village" | "hamlet" | "town" | "camp" | "ruin" | "holy" | "industry" | "port";
  x: number;
  z: number;
  radius: number;
  blurb: string;
};

/**
 * Stone circle layout, shared with `Architecture.tsx`.
 *
 * If one of the two changes, both change: the stones you can see and the stones
 * you can walk into are supposed to be the same stones. Exported rather than
 * copied for the same reason — a ring thirteen metres across cannot be one rigid
 * mesh on this terrain, so the renderer grounds each stone against the ground
 * under *that* stone and needs the same layout to do it from.
 */
export const STONE_RING_COUNT = 9;
export const STONE_RING_RADIUS = 6.5;
/** One stone has fallen. It always reads as more real than nine standing. */
export const STONE_FALLEN_INDEX = 4;

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * Integer hash -> [0, 1). Same implementation as `terrain.ts`, deliberately
 * duplicated rather than reached across a module boundary for.
 *
 * `Math.imul` is not decoration. A plain `*` on these constants runs past 2^53,
 * the float silently drops its low bits, and the low bits are the entire output
 * of a hash — the mean collapses to 0.25 with a third of the spread. This file
 * rejection-samples every position it places, so a biased hash does not degrade
 * gracefully: it crowds every candidate into one quadrant of every settlement
 * disc and the placer spends its whole budget failing.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

type Footprint = {
  /** Bounding circle at unit scale. For boxes, the circumscribed radius. */
  radius: number;
  /** Rectangular footprint, half-extents in the structure's own frame. */
  halfWidth?: number;
  halfDepth?: number;
  solid: boolean;
  /** Steepest ground this will be built on, measured as `slopeAt`. */
  maxSlope: number;
  /** Metres the ground must stand above the waterline. */
  freeboard: number;
  /** And, for the things that belong at the water's edge, no higher than this. */
  maxGround?: number;
  /** Breathing room left around the footprint when packing. */
  spacing: number;
  /**
   * Whether this may be built hard against its neighbours.
   *
   * Most things want elbow room, and the packing rule takes the *larger* of two
   * appetites so a cottage is never squeezed. But a fence runs up to a barn
   * wall, a woodpile is stacked against the gable, and a cart is left in the
   * yard — those are the arrangements that make a farmyard read as used rather
   * than as a showroom, and enforcing a cottage's clearance on them empties the
   * yard and starves the fence placer of anywhere to start.
   */
  hugs?: boolean;
  /** Deterministic size variation. Nothing in a village is a stock part. */
  scaleRange: [number, number];
};

/**
 * Real dimensions, in metres, for buildings people of this period actually put
 * up: a cottage is six metres by five, not the twelve-metre hall that "looks
 * about right" in a viewport with no human in it. The bard is 1.8m tall and
 * walks past all of them, so the difference is not subtle.
 */
const FOOTPRINTS: Record<StructureKind, Footprint> = {
  cottage: { radius: 4.0, halfWidth: 3.1, halfDepth: 2.5, solid: true, maxSlope: 0.26, freeboard: 1.2, spacing: 2.2, scaleRange: [0.9, 1.12] },
  longhouse: { radius: 7.3, halfWidth: 6.6, halfDepth: 3.1, solid: true, maxSlope: 0.2, freeboard: 1.4, spacing: 2.6, scaleRange: [0.94, 1.08] },
  barn: { radius: 6.4, halfWidth: 5.2, halfDepth: 3.7, solid: true, maxSlope: 0.22, freeboard: 1.2, spacing: 2.6, scaleRange: [0.92, 1.14] },
  windmill: { radius: 3.0, solid: true, maxSlope: 0.2, freeboard: 2.0, spacing: 6.0, scaleRange: [0.96, 1.06] },
  watchtower: { radius: 2.6, solid: true, maxSlope: 0.34, freeboard: 1.0, spacing: 2.6, scaleRange: [0.92, 1.14] },
  chapel: { radius: 7.1, halfWidth: 3.4, halfDepth: 6.2, solid: true, maxSlope: 0.18, freeboard: 1.4, spacing: 3.0, scaleRange: [0.95, 1.08] },
  well: { radius: 1.3, solid: true, maxSlope: 0.3, freeboard: 1.0, spacing: 1.8, scaleRange: [0.92, 1.1] },
  market_stall: { radius: 2.1, halfWidth: 1.7, halfDepth: 1.2, solid: true, maxSlope: 0.22, freeboard: 1.0, spacing: 1.4, scaleRange: [0.9, 1.12] },
  forge: { radius: 4.7, halfWidth: 3.6, halfDepth: 3.0, solid: true, maxSlope: 0.22, freeboard: 1.2, spacing: 2.6, scaleRange: [0.95, 1.08] },
  inn: { radius: 7.0, halfWidth: 5.6, halfDepth: 4.2, solid: true, maxSlope: 0.2, freeboard: 1.3, spacing: 3.0, scaleRange: [0.96, 1.06] },
  // A dock walks out over the water on piles, so it is held to the opposite
  // test from everything else: the ground under it has to be at the waterline,
  // not safely above it.
  dock: { radius: 6.7, halfWidth: 1.5, halfDepth: 6.5, solid: false, maxSlope: 0.85, freeboard: -1.5, maxGround: WATER_LEVEL + 1.1, spacing: 3.0, scaleRange: [0.9, 1.15] },
  bridge: { radius: 6.3, halfWidth: 3.0, halfDepth: 5.5, solid: false, maxSlope: 1.5, freeboard: -20, spacing: 4.0, scaleRange: [1, 1] },
  // A hurdle panel: four paces long, a hand thick. Sized honestly rather than
  // generously, because the overlap test works on bounding circles and an
  // over-long panel sterilises a disc of yard it does not actually occupy.
  fence: { radius: 1.92, halfWidth: 1.9, halfDepth: 0.14, solid: true, maxSlope: 0.42, freeboard: 0.6, spacing: 0.05, hugs: true, scaleRange: [0.94, 1.06] },
  shrine: { radius: 1.4, solid: true, maxSlope: 0.3, freeboard: 0.8, spacing: 1.6, scaleRange: [0.9, 1.15] },
  ruin: { radius: 6.5, solid: true, maxSlope: 0.35, freeboard: 1.0, spacing: 4.0, scaleRange: [0.85, 1.2] },
  camp: { radius: 2.6, solid: true, maxSlope: 0.28, freeboard: 0.8, spacing: 2.4, scaleRange: [0.9, 1.15] },
  standing_stones: { radius: 8.6, solid: false, maxSlope: 0.28, freeboard: 1.0, spacing: 5.0, scaleRange: [0.9, 1.15] },
  quarry: { radius: 8.0, solid: true, maxSlope: 0.85, freeboard: 1.0, spacing: 5.0, scaleRange: [0.9, 1.2] },
  lighthouse: { radius: 2.4, solid: true, maxSlope: 0.35, freeboard: 0.8, spacing: 3.0, scaleRange: [0.96, 1.08] },
  gate: { radius: 5.2, halfWidth: 5.0, halfDepth: 1.4, solid: true, maxSlope: 0.3, freeboard: 1.0, spacing: 2.0, scaleRange: [1, 1] },
  haystack: { radius: 1.8, solid: true, maxSlope: 0.3, freeboard: 0.8, spacing: 1.2, hugs: true, scaleRange: [0.78, 1.3] },
  woodpile: { radius: 1.9, halfWidth: 1.7, halfDepth: 0.8, solid: true, maxSlope: 0.3, freeboard: 0.8, spacing: 1.0, hugs: true, scaleRange: [0.82, 1.2] },
  signpost: { radius: 0.45, solid: true, maxSlope: 0.4, freeboard: 0.6, spacing: 1.2, scaleRange: [0.94, 1.08] },
  cart: { radius: 1.8, halfWidth: 1.5, halfDepth: 0.9, solid: true, maxSlope: 0.25, freeboard: 0.8, spacing: 1.2, hugs: true, scaleRange: [0.9, 1.1] },
};

// ---------------------------------------------------------------------------
// What actually touches the ground
// ---------------------------------------------------------------------------

/**
 * The part of a structure that rests on the earth.
 *
 * This is not the table above. That one is a packing rule — how much elbow room
 * a cottage needs from its neighbours — and it is drawn tight around the walls
 * on purpose. Grounding needs the opposite question answered: where does the
 * *geometry* in `architecture-kinds.ts` meet its own y = 0? A cottage plinth
 * oversails its walls by a quarter of a metre. A barn stands a lean-to on four
 * posts two metres clear of its gable. A woodpile has a chopping block a metre
 * off its end, and a cart touches the ground on two wheels and nothing else —
 * its shafts are up in the air, so the two-and-a-half metres of shaft that the
 * packing footprint reserves are two and a half metres of ground it must not be
 * levelled to.
 *
 * Level a building against the wrong rectangle and the lowest ground under the
 * right one is still in mid-air. That was most of what was left.
 *
 * Half-extents are in the structure's own frame at unit scale: X is what the
 * generators call `width`, Z is `depth`. `offsetX`/`offsetZ` shift the rectangle
 * for the kinds whose ground contact is lopsided, so a barn's lean-to does not
 * cost it two metres of phantom sampling off the blind gable as well.
 *
 * This has to be kept in step with `architecture-kinds.ts`. If a generator
 * grows a porch, the porch belongs here.
 */
export type GroundFootprint = {
  halfWidth: number;
  halfDepth: number;
  offsetX?: number;
  offsetZ?: number;
  /** Round in plan: the corners of the rectangle are ground it never stands on. */
  round?: boolean;
  /**
   * How far the uphill side may be cut into the bank, and how high the downhill
   * side may be carried on a footing, before the other one has to give.
   *
   * Levelling everything to the lowest ground under it is the right rule and it
   * has one failure: `siteIsGood` measures steepness with `slopeAt`, which is
   * `1 - normal.y` and not a gradient — a cottage's limit of 0.26 passes ground
   * at forty degrees. On those sites the ground under a six-metre plinth moves
   * by several metres, and a floor pinned to the lowest corner puts the eaves
   * inside the hill.
   *
   * So the floor is allowed to ride up off the lowest point, as far as `lift`,
   * and `Architecture.tsx` runs a foundation course down from it to close the
   * daylight. Cut in at the back, built up at the front, which is how anybody
   * has ever put a building on a slope. `lift` stays 0 for anything with no
   * foundation to build: a haystack cannot stand on masonry.
   */
  cut?: number;
  lift?: number;
};

export const GROUND_FOOTPRINTS: Record<StructureKind, GroundFootprint> = {
  // 6.2 x 5.0 walls on a plinth that projects 0.25 all round.
  cottage: { halfWidth: 3.35, halfDepth: 2.75, cut: 0.55, lift: 0.35 },
  longhouse: { halfWidth: 6.88, halfDepth: 3.38, cut: 0.55, lift: 0.35 },
  // The lean-to along one gable puts four posts out at x = +7.7, and nothing
  // at all at -7.7.
  barn: { halfWidth: 6.54, halfDepth: 3.85, offsetX: 1.19, cut: 0.5, lift: 0.35 },
  // A battered masonry shaft can stand on as much footing as it likes.
  windmill: { halfWidth: 2.55, halfDepth: 2.55, round: true, cut: 0.7, lift: 0.5 },
  watchtower: { halfWidth: 2.6, halfDepth: 2.6, round: true, cut: 0.7, lift: 0.5 },
  // Nave plinth plus buttresses, and the tower standing against the west front.
  chapel: { halfWidth: 3.8, halfDepth: 6.88, cut: 0.55, lift: 0.35 },
  well: { halfWidth: 1.25, halfDepth: 1.25, round: true, cut: 0.35, lift: 0.25 },
  market_stall: { halfWidth: 1.89, halfDepth: 1.15, offsetX: -0.21 },
  forge: { halfWidth: 3.8, halfDepth: 3.2, cut: 0.55, lift: 0.35 },
  // The barrels and the bench outside the door are on the ground too.
  inn: { halfWidth: 5.9, halfDepth: 4.88, offsetZ: 0.38, cut: 0.55, lift: 0.35 },
  dock: { halfWidth: 1.4, halfDepth: 6.2 },
  bridge: { halfWidth: 2.6, halfDepth: 6.7 },
  fence: { halfWidth: 1.9, halfDepth: 0.16 },
  shrine: { halfWidth: 0.85, halfDepth: 0.6 },
  // The shaft, and the rubble banked against its foot. The loose stone further
  // out rides the ground on its own — burying a six-metre tower to catch a
  // block the size of a loaf is the wrong trade.
  ruin: { halfWidth: 3.4, halfDepth: 3.4, round: true, cut: 0.65, lift: 0.4 },
  // The fire ring and the two tents pitched a couple of paces off it.
  camp: { halfWidth: 2.9, halfDepth: 2.9, round: true },
  // Every stone is grounded on its own, so the ring itself only needs an
  // anchor. See the run builder in `Architecture.tsx`.
  standing_stones: { halfWidth: 2.2, halfDepth: 2.2, round: true },
  // Bottom bench at z = -4.4, spoil and cut blocks out to z = +6.5.
  quarry: { halfWidth: 6.6, halfDepth: 5.55, offsetZ: 1.05, cut: 0.9, lift: 0.55 },
  lighthouse: { halfWidth: 2.3, halfDepth: 2.3, round: true, cut: 0.7, lift: 0.5 },
  // Both towers and both palisade wings. `ROAD_HALF_WIDTH + 1.5` to the tower
  // centre, 1.25 of tower, then five wing posts.
  gate: { halfWidth: 6.95, halfDepth: 1.9 },
  haystack: { halfWidth: 2.1, halfDepth: 2.1, round: true },
  // Stack, chopping block, and the chips around it — all off one end.
  woodpile: { halfWidth: 2.5, halfDepth: 0.98, offsetX: 0.8, offsetZ: 0.12 },
  signpost: { halfWidth: 0.2, halfDepth: 0.2, round: true },
  // Two wheels. The shafts are in the air and the bed is above them.
  cart: { halfWidth: 1.06, halfDepth: 0.72, offsetZ: 0.1 },
};

/**
 * The margin the brief is built around: a footprint must clear the carriageway
 * edge by this much before it is allowed to exist.
 *
 * `distanceToRoad` is a proximity test with a 30m horizon, which is comfortably
 * beyond `ROAD_HALF_WIDTH + 8.6 + 1.5`, so every rejection here happens inside
 * the range where its answer is exact.
 */
const ROAD_MARGIN = 1.5;

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

/**
 * Eleven inhabited places, sited by hand and then built by machine.
 *
 * Each centre was chosen against the actual height field rather than a sketch:
 * every one sits on ground that is at least 60% flat, dry and clear of the
 * carriageway inside its own radius, and every one is on or beside a road,
 * because a settlement nobody can reach is a diorama. The Kestrel March and the
 * Tarnwild are deliberately left empty — they are the wild quarters, and the
 * height field would not support a village there anyway.
 */
export const SETTLEMENTS: Settlement[] = [
  {
    id: "wealdmoot",
    name: "Wealdmoot",
    kind: "town",
    x: 4,
    z: 42,
    radius: 46,
    blurb:
      "The only place in the valley with a market, a magistrate, and an opinion about both.",
  },
  {
    id: "barleyhearth-town",
    name: "Barleyhearth",
    kind: "village",
    x: -98,
    z: 58,
    radius: 38,
    blurb:
      "Twelve families, four hundred acres, and one very long-running argument about a hedge.",
  },
  {
    id: "cidergarth-town",
    name: "Cidergarth",
    kind: "village",
    x: -57,
    z: 212,
    radius: 34,
    blurb: "They press in October and are insufferable about it until March.",
  },
  {
    id: "skarnfoot",
    name: "Skarnfoot",
    kind: "village",
    x: 8,
    z: -190,
    radius: 28,
    blurb:
      "Last roof before the pass, and they will tell you so before you have your cloak off.",
  },
  {
    id: "saltmere-quay",
    name: "Saltmere Quay",
    kind: "port",
    x: -150,
    z: 182,
    radius: 30,
    blurb:
      "Nets on every fence, and a lamp kept burning for boats that stopped coming years ago.",
  },
  {
    id: "elderloom-stile",
    name: "Elderloom Stile",
    kind: "hamlet",
    x: 56,
    z: 204,
    radius: 22,
    blurb: "Four houses under the canopy, and everyone here is somebody's cousin.",
  },
  {
    id: "fenreed",
    name: "Fenreed",
    kind: "hamlet",
    x: 156,
    z: 136,
    radius: 32,
    blurb:
      "Built on the only firm ground for a mile, and they check that it still is every spring.",
  },
  {
    id: "greyneedle-priory",
    name: "Greyneedle Priory",
    kind: "holy",
    x: 58,
    z: -168,
    radius: 26,
    blurb:
      "Nine brothers, one bell, and a rule of silence they keep about as well as anyone would.",
  },
  {
    id: "ashenreach-delve",
    name: "Ashenreach Delve",
    kind: "industry",
    x: 196,
    z: -108,
    radius: 26,
    blurb:
      "Red stone comes out, water goes in, and the pit has been winning since the old king died.",
  },
  {
    id: "hollowmoor-camp",
    name: "The Hollowmoor Camp",
    kind: "camp",
    x: -132,
    z: -178,
    radius: 18,
    blurb:
      "Fires that go out whenever anyone comes up the road, and go straight back on after.",
  },
  {
    id: "bracken-keep",
    name: "Bracken Keep",
    kind: "ruin",
    x: 118,
    z: 28,
    radius: 22,
    blurb: "Somebody held this hollow once. Nobody local will say against whom.",
  },
];

// ---------------------------------------------------------------------------
// The placement pass
// ---------------------------------------------------------------------------

type Recipe = {
  kind: StructureKind;
  count: number;
  /** Placement annulus, as a fraction of the cluster radius. */
  band?: [number, number];
  /** Keep at least this far from the nearest carriageway. */
  roadMin?: number;
  /** And no further, so a village lines its lane instead of drifting off it. */
  roadMax?: number;
  /** Fences are laid in runs; everything else is placed one at a time. */
  run?: boolean;
};

type Cluster = {
  id: string;
  x: number;
  z: number;
  radius: number;
  /** Present for real settlements, absent for outlying farms and watchposts. */
  settlementId?: string;
  recipes: Recipe[];
};

const structures: Structure[] = [];

/**
 * Overlap index. A uniform grid rather than a linear scan: the placer runs tens
 * of thousands of candidates against a few hundred footprints at module load,
 * and load time on the hero scene is the budget everything else competes for.
 */
const OVERLAP_CELL = 14;
const overlapCells = new Map<number, number[]>();

function cellKey(cx: number, cz: number): number {
  return (cx + 2048) * 4096 + (cz + 2048);
}

/**
 * Footprints are tested as bounding circles even for rectangular buildings.
 * That is deliberately conservative — two barns at right angles could in
 * principle be packed tighter — but a false rejection costs one dropped
 * haystack, while a false accept puts a cottage through a barn wall, and there
 * is no version of this where the second trade is the better one.
 */
function overlapsPlaced(x: number, z: number, reach: number, kind: StructureKind): boolean {
  const spec = FOOTPRINTS[kind];
  const bound = reach + 12;
  const minX = Math.floor((x - bound) / OVERLAP_CELL);
  const maxX = Math.floor((x + bound) / OVERLAP_CELL);
  const minZ = Math.floor((z - bound) / OVERLAP_CELL);
  const maxZ = Math.floor((z + bound) / OVERLAP_CELL);

  for (let cx = minX; cx <= maxX; cx++) {
    for (let cz = minZ; cz <= maxZ; cz++) {
      const bucket = overlapCells.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const other = structures[bucket[i]];
        const otherSpec = FOOTPRINTS[other.kind];
        // The larger of the two appetites normally wins, so a cottage is never
        // squeezed by whatever went up next to it. Yard clutter is the
        // exception, and takes the smaller: a woodpile is *supposed* to be
        // stacked against the wall.
        const gap =
          spec.hugs || otherSpec.hugs
            ? Math.min(spec.spacing, otherSpec.spacing)
            : Math.max(spec.spacing, otherSpec.spacing);
        const need = other.radius + reach + gap;
        const dx = other.x - x;
        const dz = other.z - z;
        if (dx * dx + dz * dz < need * need) return true;
      }
    }
  }
  return false;
}

/** Distance out to open water, negative inside it. */
function distanceToWater(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < WATERS.length; i++) {
    const water = WATERS[i];
    const gap = Math.hypot(x - water.x, z - water.z) - water.radius;
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * The one test this whole file exists for, plus everything else a site has to
 * satisfy.
 *
 * Ordered cheapest-first. The road query is a single bucket lookup and the
 * overlap test reads a handful of cells; only a candidate that has survived
 * both is worth paying for `heightAt`, and `slopeAt` is four more of those.
 */
function siteIsGood(
  kind: StructureKind,
  x: number,
  z: number,
  reach: number,
  roadMin: number,
  roadMax: number
): boolean {
  const road = distanceToRoad(x, z);

  // NOTHING SITS ON A ROAD. The footprint's own reach is in the sum, so a
  // longhouse has to stand further back than a well does.
  if (road <= ROAD_HALF_WIDTH + reach + ROAD_MARGIN) return false;
  if (road < roadMin) return false;
  if (road > roadMax) return false;

  const spec = FOOTPRINTS[kind];
  if (overlapsPlaced(x, z, reach, kind)) return false;

  // Dry-land buildings keep clear of open water entirely. Docks skip this and
  // are pinned to the waterline by `maxGround` instead.
  if (spec.maxGround === undefined && distanceToWater(x, z) < reach + 2) return false;

  const ground = heightAt(x, z);
  if (ground < WATER_LEVEL + spec.freeboard) return false;
  if (spec.maxGround !== undefined && ground > spec.maxGround) return false;
  if (slopeAt(x, z) > spec.maxSlope) return false;

  return true;
}

/**
 * Which way a building looks.
 *
 * Buildings address the road. That is not decoration — a door on the blind side
 * of a house is the fastest way to make a village read as scenery somebody
 * dropped rather than as a place people arrive at. Anything too far from a lane
 * to have been built facing one turns to face its own settlement instead, and a
 * couple of degrees of deterministic wobble goes on top, because a row of
 * buildings in exact parallel is its own kind of tell.
 */
function facing(x: number, z: number, towardX: number, towardZ: number, seed: number): number {
  const near = nearestRoadPoint(x, z);
  let dx = near.x - x;
  let dz = near.z - z;
  if (Math.hypot(dx, dz) > 48) {
    dx = towardX - x;
    dz = towardZ - z;
  }
  if (Math.abs(dx) < 1e-4 && Math.abs(dz) < 1e-4) dz = 1;
  // Local +Z is a building's front, and a Y rotation carries (0, 0, 1) to
  // (sin, 0, cos) — so this is the angle that puts the door toward the road.
  return Math.atan2(dx, dz) + (hash2(seed * 61 + 7, seed * 13) - 0.5) * 0.19;
}

function scaleFor(kind: StructureKind, seed: number): number {
  const [lo, hi] = FOOTPRINTS[kind].scaleRange;
  return lo + hash2(seed * 97 + 3, seed * 29 + 11) * (hi - lo);
}

/**
 * How finely a footprint is sampled, in metres.
 *
 * A fixed lattice — five by five, whatever the building — is the trap here. It
 * is dense for a cart and it is four-metre spacing under a quarry, and a
 * quarry is allowed onto ground with a slope of 0.85, where four metres of
 * horizontal is three metres of vertical. The lowest point of the footprint was
 * simply never sampled. Spacing has to be a length, not a count.
 */
const GROUND_SAMPLE_STEP = 0.4;
/** Even so, a fifty-metre run of anything is not worth ten thousand samples. */
const GROUND_SAMPLE_MAX = 40;

/**
 * How far a floor sinks below the lowest ground under its footprint.
 *
 * The height field and the drawn terrain mesh are not the same surface — the
 * mesh interpolates between its vertices and so dips below the function inside
 * every triangle — and the sampler above walks a lattice rather than reading a
 * continuous minimum. A floor laid exactly on the lowest *sample* still shows a
 * hairline of daylight along one edge. This is the margin that covers both, and
 * it costs nothing: the bedded courses are underground.
 */
export const BEDDING = 0.5;

/**
 * The lowest ground anywhere under a structure's true rotated footprint.
 *
 * The rectangle is the one the geometry stands on (`GROUND_FOOTPRINTS`), turned
 * by the instance's own rotation, at the instance's own scale. The rotation
 * convention is three.js': a Y rotation of θ carries local +X to
 * (cos θ, −sin θ) in the XZ plane, which is the same convention
 * `Architecture.tsx` composes its instance matrices with and the same one
 * `structureColliders` places gate towers with. Sampling the mirrored rectangle
 * instead — the easy sign slip, since the naive matrix looks symmetric — misses
 * the real downhill corner of every building that is longer than it is wide,
 * which in this world is most of them.
 *
 * `pad` widens the rectangle, for callers asking about a footing rather than a
 * wall.
 */
export function lowestGroundUnder(
  kind: StructureKind,
  x: number,
  z: number,
  rotation: number,
  scale: number,
  pad = 0
): number {
  sampleGround(kind, x, z, rotation, scale, pad);
  return groundSpan.low;
}

/**
 * Written rather than returned: this runs a few hundred thousand times at
 * module load and the highest point is only wanted by one caller.
 */
const groundSpan = { low: 0, high: 0 };

function sampleGround(
  kind: StructureKind,
  x: number,
  z: number,
  rotation: number,
  scale: number,
  pad: number
): void {
  const spec = GROUND_FOOTPRINTS[kind];
  const halfWidth = spec.halfWidth * scale + pad;
  const halfDepth = spec.halfDepth * scale + pad;
  const centreX = x + (spec.offsetX ?? 0) * scale * Math.cos(rotation)
    + (spec.offsetZ ?? 0) * scale * Math.sin(rotation);
  const centreZ = z - (spec.offsetX ?? 0) * scale * Math.sin(rotation)
    + (spec.offsetZ ?? 0) * scale * Math.cos(rotation);

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const steps = (half: number): number =>
    Math.min(GROUND_SAMPLE_MAX, Math.max(2, Math.ceil((half * 2) / GROUND_SAMPLE_STEP)));
  const nu = steps(halfWidth);
  const nv = steps(halfDepth);

  let lowest = heightAt(centreX, centreZ);
  let highest = lowest;
  for (let i = 0; i <= nu; i++) {
    const u = (i / nu - 0.5) * 2 * halfWidth;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv - 0.5) * 2 * halfDepth;
      // A round tower is not a square one. Sampling its corners reaches 40%
      // further out than it stands, and on a slope that is enough to sink the
      // whole thing to ground it never touches.
      if (spec.round) {
        const ru = u / halfWidth;
        const rv = v / halfDepth;
        if (ru * ru + rv * rv > 1) continue;
      }
      const h = heightAt(centreX + u * cos + v * sin, centreZ - u * sin + v * cos);
      if (h < lowest) lowest = h;
      else if (h > highest) highest = h;
    }
  }

  groundSpan.low = lowest;
  groundSpan.high = highest;
}

/**
 * Where a structure's floor sits.
 *
 * Sampling `heightAt` at the centre point — the obvious implementation — is
 * what leaves buildings floating. A cottage is eight metres across, and on any
 * slope at all the ground under its downhill corner is well below the ground
 * under its middle, so a building levelled to its centre hangs in the air along
 * one whole side. On a 1-in-6 slope that gap is over half a metre.
 *
 * So the floor goes to the LOWEST ground under the footprint, not the average
 * and not the centre. That buries the uphill side, which is both correct and
 * free: real buildings are cut into slopes, and `Architecture.tsx` runs a
 * foundation course down from this plane to the earth so the cut reads as
 * deliberate masonry rather than as a building sinking. Floating is glaring; a
 * sunk plinth with a footing under it is architecture.
 *
 * Two kinds are levelled against something other than the ground, and both for
 * the same reason: they have to agree with a surface that is not the ground. A
 * dock's deck meets the waterline. A bridge deck and a gate arch meet the
 * graded carriageway, to the centimetre — a gate lowered to the earth beside an
 * embanked road would have the road running through its open leaves. Those get
 * their daylight closed by a footing instead of by moving.
 */
function baseHeight(
  kind: StructureKind,
  x: number,
  z: number,
  rotation: number,
  scale: number
): number {
  if (kind === "dock") return WATER_LEVEL;

  // Always the lowest corner under the footprint. Slope lift looked correct on
  // paper with a matching footing, but on the live stage the daylight under
  // walls was still obvious — pin the floor to the earth and let Architecture
  // show a short base course instead.
  return lowestGroundUnder(kind, x, z, rotation, scale) - BEDDING;
}

function commit(structure: Structure): void {
  const index = structures.length;
  const reach = structure.radius;
  const minX = Math.floor((structure.x - reach) / OVERLAP_CELL);
  const maxX = Math.floor((structure.x + reach) / OVERLAP_CELL);
  const minZ = Math.floor((structure.z - reach) / OVERLAP_CELL);
  const maxZ = Math.floor((structure.z + reach) / OVERLAP_CELL);
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cz = minZ; cz <= maxZ; cz++) {
      const key = cellKey(cx, cz);
      const bucket = overlapCells.get(key);
      if (bucket) bucket.push(index);
      else overlapCells.set(key, [index]);
    }
  }
  structures.push(structure);
}

/** Attempts per structure. Generous, because a rejected candidate is cheap. */
const ATTEMPTS = 110;

function placeOne(
  cluster: Cluster,
  recipe: Recipe,
  ordinal: number,
  seed: number
): Structure | null {
  const spec = FOOTPRINTS[recipe.kind];
  const [lo, hi] = recipe.band ?? [0.1, 0.95];
  const roadMin = recipe.roadMin ?? 0;
  const roadMax = recipe.roadMax ?? 999;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const a = hash2(seed + attempt * 7919, seed * 31 + attempt);
    const b = hash2(seed * 131 + attempt, seed + attempt * 5417);

    const angle = a * Math.PI * 2;
    // Uniform over the annulus rather than over the radius, or every cluster
    // grows a bullseye at the centre and thins toward the edge.
    const radius = cluster.radius * Math.sqrt(lo * lo + b * (hi * hi - lo * lo));
    const x = cluster.x + Math.cos(angle) * radius;
    const z = cluster.z + Math.sin(angle) * radius;

    const scale = scaleFor(recipe.kind, seed + attempt);
    const reach = spec.radius * scale;
    if (!siteIsGood(recipe.kind, x, z, reach, roadMin, roadMax)) continue;

    return {
      id: `${cluster.id}-${recipe.kind}-${ordinal}`,
      kind: recipe.kind,
      x,
      z,
      y: baseHeight(
        recipe.kind,
        x,
        z,
        facing(x, z, cluster.x, cluster.z, seed + attempt),
        scale
      ),
      rotation: facing(x, z, cluster.x, cluster.z, seed + attempt),
      scale,
      radius: reach,
      settlementId: cluster.settlementId,
    };
  }

  // Out of attempts. Dropping the structure is the correct outcome here: the
  // alternative is shipping an overlap, and one fewer woodpile is invisible.
  return null;
}

/**
 * One line of fence, walked panel by panel from a start point along a bearing.
 *
 * Nothing is committed here. A run that manages a single panel is a gatepost
 * with no gate, so the caller gets the candidates back and decides whether the
 * line was worth building — which also means the panels of a run never have to
 * be tested against each other, since the step below guarantees they butt.
 */
function walkFence(
  cluster: Cluster,
  startX: number,
  startZ: number,
  bearingX: number,
  bearingZ: number,
  panels: number,
  budget: number,
  seed: number,
  roadMin: number,
  roadMax: number
): Structure[] {
  const spec = FOOTPRINTS.fence;
  const pending: Structure[] = [];

  let x = startX;
  let z = startZ;
  let dirX = bearingX;
  let dirZ = bearingZ;
  let previousReach = 0;

  for (let p = 0; p < panels && pending.length < budget; p++) {
    const scale = scaleFor("fence", seed + p * 31);
    const reach = spec.radius * scale;

    if (p > 0) {
      // Panels butt end to end with the joint kinked a little, because a dead
      // straight fence a hundred metres long is a wall in a video game.
      const kink = (hash2(seed + p, seed * 41 + p) - 0.5) * 0.16;
      const cos = Math.cos(kink);
      const sin = Math.sin(kink);
      const rotatedX = dirX * cos - dirZ * sin;
      dirZ = dirX * sin + dirZ * cos;
      dirX = rotatedX;
      // Half of each panel, plus a joint. Using the new panel's length twice
      // is the obvious version and it is wrong: panels vary in length, so a
      // short one following a long one ends up inside it.
      const step = previousReach + reach + 0.14;
      x += dirX * step;
      z += dirZ * step;
    }

    if (!siteIsGood("fence", x, z, reach, roadMin, roadMax)) break;
    previousReach = reach;

    pending.push({
      id: "",
      kind: "fence",
      x,
      z,
      y: baseHeight("fence", x, z, Math.atan2(-dirZ, dirX), scale),
      // Local +X runs along a panel, so this lays it on the line rather than
      // across it.
      rotation: Math.atan2(-dirZ, dirX),
      scale,
      radius: reach,
      settlementId: cluster.settlementId,
    });
  }

  return pending;
}

/**
 * Fences laid in lines, which is the only way they read as enclosure rather
 * than as sticks dropped in a field.
 *
 * Bearings come off the road tangent — along the lane or square to it, and
 * nothing else, because those are the two directions field boundaries actually
 * run. All four are tried from each start before the start is abandoned; a
 * single blocked bearing is extremely common in a village and says nothing
 * about whether there is a hedge line there.
 */
function placeRun(cluster: Cluster, recipe: Recipe, budget: number, seed: number): void {
  const roadMin = recipe.roadMin ?? 0;
  const roadMax = recipe.roadMax ?? 999;
  const [lo, hi] = recipe.band ?? [0.35, 1];

  let placed = 0;

  for (let run = 0; run < 64 && placed < budget; run++) {
    const a = hash2(seed + run * 3301, seed * 17 + run);
    const b = hash2(seed * 211 + run, seed + run * 6151);

    const angle = a * Math.PI * 2;
    const start = cluster.radius * Math.sqrt(lo * lo + b * (hi * hi - lo * lo));
    const x = cluster.x + Math.cos(angle) * start;
    const z = cluster.z + Math.sin(angle) * start;

    const near = nearestRoadPoint(x, z);
    let ux = near.x - x;
    let uz = near.z - z;
    const distance = Math.hypot(ux, uz) || 1;
    ux /= distance;
    uz /= distance;

    const bearings: Array<[number, number]> = [
      [-uz, ux],
      [uz, -ux],
      [ux, uz],
      [-ux, -uz],
    ];
    // Half the starts prefer the along-the-lane pair, half the square-on pair,
    // so the enclosure pattern isn't one bearing everywhere.
    const first = hash2(seed * 7 + run, run * 97) < 0.5 ? 0 : 2;
    const panels = 4 + Math.floor(hash2(seed + run * 13, run * 29) * 8);

    let line: Structure[] = [];
    for (let o = 0; o < 4 && line.length < 2; o++) {
      const bearing = bearings[(first + o) % 4];
      line = walkFence(
        cluster,
        x,
        z,
        bearing[0],
        bearing[1],
        panels,
        budget - placed,
        seed + run * 907 + o * 61,
        roadMin,
        roadMax
      );
    }

    if (line.length < 2) continue;
    for (let i = 0; i < line.length; i++) {
      line[i].id = `${cluster.id}-fence-${placed + i}`;
      commit(line[i]);
    }
    placed += line.length;
  }
}

function buildCluster(cluster: Cluster, clusterSeed: number): void {
  for (let r = 0; r < cluster.recipes.length; r++) {
    const recipe = cluster.recipes[r];
    const seedBase = clusterSeed + r * 104729;

    if (recipe.run) {
      placeRun(cluster, recipe, recipe.count, seedBase);
      continue;
    }

    for (let i = 0; i < recipe.count; i++) {
      const structure = placeOne(cluster, recipe, i, seedBase + i * 7907);
      if (structure) commit(structure);
    }
  }
}

// ---------------------------------------------------------------------------
// Bridges — the road, for five spans of it
// ---------------------------------------------------------------------------

const scratchPoint = new THREE.Vector3();
const scratchTangent = new THREE.Vector3();

/**
 * Where a road crosses a river.
 *
 * The terrain builds these as causeways: the road corridor is applied after the
 * channel and wins, so the water currently runs straight through a bank of
 * graded earth. Sited on the road centre line rather than the river's — a
 * bridge carries the carriageway, so its deck has to be where the carriageway
 * is, and a few metres of error leaves an abutment in mid-air.
 *
 * Found by walking every road against every river once, offline, and pasted in
 * here: that search is a few million distance tests, and there is no reason to
 * pay for it on every page load to rediscover five constants.
 *
 * Placed before anything else, because a bridge cannot move and everything else
 * can — laying them down first means the settlement placer treats them as
 * fixed obstacles rather than discovering a cottage already sitting on one.
 */
const CROSSINGS: Array<{ x: number; z: number; span: number }> = [
  { x: -38, z: -144, span: 1.0 }, // Long Circuit over the Sildwater, up in the glen
  { x: -112, z: -108, span: 0.92 }, // Long Circuit over the Thistlebeck
  { x: -116, z: 51, span: 1.15 }, // Long Circuit over the Sildwater above the mere
  { x: -128, z: 64, span: 1.05 }, // Mere Road over the Sildwater
  { x: 154, z: -76, span: 0.95 }, // Ash Track over the Blackrun
];

for (let i = 0; i < CROSSINGS.length; i++) {
  const crossing = CROSSINGS[i];
  const near = nearestRoadPoint(crossing.x, crossing.z);
  const road = ROADS[near.road];
  road.getTangentAt(Math.min(0.9999, Math.max(0.0001, near.t)), scratchTangent);

  const spec = FOOTPRINTS.bridge;
  commit({
    id: `bridge-${i}`,
    kind: "bridge",
    x: near.x,
    z: near.z,
    // The graded road surface, which is the one height a deck has to agree
    // with to within a centimetre.
    y: roadHeight(near.x, near.z),
    // A bridge's local +Z runs with the road, so its deck lies along the
    // carriageway instead of across it.
    rotation: Math.atan2(scratchTangent.x, scratchTangent.z),
    scale: crossing.span,
    radius: spec.radius * crossing.span,
  });
}

// ---------------------------------------------------------------------------
// Gates — the other thing that is allowed over a road
// ---------------------------------------------------------------------------

/**
 * A gate stands across the lane it guards; that is what a gate is. It keeps the
 * same bargain a bridge does: the solid parts are the two flanking towers, and
 * `structureColliders` sets those outside the carriageway so the arch between
 * them stays walkable.
 *
 * Sited by walking the road out from the settlement centre until it leaves the
 * built-up area, in both directions, which puts a gate at each approach without
 * anybody having to name a coordinate.
 */
function placeGates(settlementId: string): void {
  const settlement = SETTLEMENTS.find((s) => s.id === settlementId);
  if (!settlement) return;

  const near = nearestRoadPoint(settlement.x, settlement.z);
  const road = ROADS[near.road];
  const length = road.getLength();
  const target = settlement.radius * 0.86;
  const spec = FOOTPRINTS.gate;

  for (let side = 0; side < 2; side++) {
    const direction = side === 0 ? 1 : -1;
    let found: { x: number; z: number; t: number } | null = null;

    for (let step = 1; step <= 160; step++) {
      let t = near.t + (direction * step * 3) / length;
      if (road.closed) t -= Math.floor(t);
      else if (t < 0 || t > 1) break;

      road.getPointAt(t, scratchPoint);
      const away = Math.hypot(scratchPoint.x - settlement.x, scratchPoint.z - settlement.z);
      if (away >= target) {
        found = { x: scratchPoint.x, z: scratchPoint.z, t };
        break;
      }
    }
    if (!found) continue;

    // The road rule does not apply to a structure whose entire job is to span
    // one, but the ground still has to behave and the site still has to be free.
    if (heightAt(found.x, found.z) < WATER_LEVEL + spec.freeboard) continue;
    if (overlapsPlaced(found.x, found.z, spec.radius, "gate")) continue;

    road.getTangentAt(Math.min(0.9999, Math.max(0.0001, found.t)), scratchTangent);
    commit({
      id: `${settlementId}-gate-${side}`,
      kind: "gate",
      x: found.x,
      z: found.z,
      y: roadHeight(found.x, found.z),
      // Same convention as a bridge: local +Z runs with the road, which puts
      // local +X square across it. The towers sit at ±X and the arch between
      // them opens along the carriageway.
      rotation: Math.atan2(scratchTangent.x, scratchTangent.z),
      scale: 1,
      radius: spec.radius,
      settlementId,
    });
  }
}

placeGates("wealdmoot");
placeGates("greyneedle-priory");

// ---------------------------------------------------------------------------
// What each place is made of
// ---------------------------------------------------------------------------

/**
 * Recipes, ordered largest-first inside each cluster.
 *
 * The order is load-bearing: the placer is greedy, so whatever is listed first
 * gets the good ground. Put the fences before the inn and the inn never finds
 * anywhere to stand.
 */
const CLUSTERS: Cluster[] = [
  {
    id: "wealdmoot",
    settlementId: "wealdmoot",
    x: 4,
    z: 42,
    radius: 46,
    recipes: [
      { kind: "inn", count: 1, band: [0.06, 0.3], roadMax: 20 },
      { kind: "chapel", count: 1, band: [0.22, 0.52], roadMax: 26 },
      { kind: "forge", count: 1, band: [0.16, 0.46], roadMax: 22 },
      { kind: "longhouse", count: 3, band: [0.12, 0.55], roadMax: 26 },
      { kind: "barn", count: 2, band: [0.6, 1], roadMax: 40 },
      { kind: "watchtower", count: 2, band: [0.7, 1], roadMax: 40 },
      { kind: "cottage", count: 16, band: [0.12, 0.92], roadMax: 34 },
      { kind: "market_stall", count: 7, band: [0.04, 0.46], roadMax: 20 },
      { kind: "well", count: 2, band: [0.05, 0.42], roadMax: 22 },
      { kind: "cart", count: 4, band: [0.05, 0.6], roadMax: 20 },
      { kind: "woodpile", count: 6, band: [0.2, 0.85] },
      { kind: "haystack", count: 4, band: [0.6, 1] },
      { kind: "shrine", count: 1, band: [0.3, 0.8], roadMax: 20 },
      { kind: "signpost", count: 2, band: [0.55, 0.95], roadMax: 12 },
      { kind: "fence", count: 44, band: [0.42, 1], run: true },
    ],
  },
  {
    id: "barleyhearth",
    settlementId: "barleyhearth-town",
    x: -98,
    z: 58,
    radius: 38,
    recipes: [
      { kind: "windmill", count: 1, band: [0.55, 0.95], roadMax: 44 },
      { kind: "longhouse", count: 2, band: [0.1, 0.5], roadMax: 24 },
      { kind: "barn", count: 3, band: [0.35, 0.9], roadMax: 40 },
      { kind: "cottage", count: 10, band: [0.1, 0.95], roadMax: 34 },
      { kind: "market_stall", count: 2, band: [0.05, 0.4], roadMax: 18 },
      { kind: "well", count: 1, band: [0.06, 0.4], roadMax: 20 },
      { kind: "cart", count: 3, band: [0.1, 0.7] },
      { kind: "woodpile", count: 3, band: [0.2, 0.8] },
      { kind: "haystack", count: 10, band: [0.4, 1] },
      { kind: "shrine", count: 1, band: [0.3, 0.8], roadMax: 18 },
      { kind: "signpost", count: 1, band: [0.6, 1], roadMax: 11 },
      { kind: "fence", count: 48, band: [0.35, 1], run: true },
    ],
  },
  {
    id: "cidergarth",
    settlementId: "cidergarth-town",
    x: -57,
    z: 212,
    radius: 34,
    recipes: [
      { kind: "longhouse", count: 1, band: [0.1, 0.45], roadMax: 22 },
      { kind: "barn", count: 2, band: [0.35, 0.9], roadMax: 36 },
      { kind: "cottage", count: 8, band: [0.1, 0.82], roadMax: 28 },
      { kind: "well", count: 1, band: [0.06, 0.4], roadMax: 20 },
      { kind: "market_stall", count: 1, band: [0.05, 0.3], roadMax: 14 },
      { kind: "cart", count: 3, band: [0.1, 0.7] },
      { kind: "woodpile", count: 3, band: [0.2, 0.8] },
      { kind: "haystack", count: 4, band: [0.4, 1] },
      { kind: "shrine", count: 1, band: [0.3, 0.8], roadMax: 18 },
      { kind: "fence", count: 34, band: [0.35, 1], run: true },
    ],
  },
  {
    id: "skarnfoot",
    settlementId: "skarnfoot",
    x: 8,
    z: -190,
    radius: 28,
    recipes: [
      { kind: "longhouse", count: 1, band: [0.1, 0.5], roadMax: 22 },
      { kind: "barn", count: 1, band: [0.4, 0.9], roadMax: 32 },
      { kind: "forge", count: 1, band: [0.15, 0.5], roadMax: 20 },
      { kind: "watchtower", count: 1, band: [0.6, 1], roadMax: 34 },
      { kind: "cottage", count: 7, band: [0.12, 0.85], roadMax: 26 },
      { kind: "well", count: 1, band: [0.06, 0.42], roadMax: 18 },
      { kind: "cart", count: 2, band: [0.1, 0.7] },
      { kind: "woodpile", count: 4, band: [0.2, 0.85] },
      { kind: "shrine", count: 1, band: [0.3, 0.85], roadMax: 16 },
      { kind: "signpost", count: 1, band: [0.6, 1], roadMax: 11 },
      { kind: "fence", count: 22, band: [0.35, 1], run: true },
    ],
  },
  {
    id: "saltmere",
    settlementId: "saltmere-quay",
    x: -150,
    z: 182,
    radius: 30,
    recipes: [
      { kind: "lighthouse", count: 1, band: [0.5, 0.95] },
      { kind: "longhouse", count: 1, band: [0.1, 0.5], roadMax: 24 },
      { kind: "dock", count: 4, band: [0.3, 1] },
      { kind: "cottage", count: 9, band: [0.1, 0.95], roadMax: 34 },
      { kind: "market_stall", count: 2, band: [0.05, 0.45], roadMax: 18 },
      { kind: "well", count: 1, band: [0.06, 0.42], roadMax: 20 },
      { kind: "cart", count: 2, band: [0.1, 0.7] },
      { kind: "woodpile", count: 3, band: [0.2, 0.85] },
      { kind: "haystack", count: 2, band: [0.5, 1] },
      { kind: "shrine", count: 1, band: [0.3, 0.85], roadMax: 18 },
      { kind: "fence", count: 20, band: [0.35, 1], run: true },
    ],
  },
  {
    id: "elderloom",
    settlementId: "elderloom-stile",
    x: 56,
    z: 204,
    radius: 22,
    recipes: [
      { kind: "barn", count: 1, band: [0.4, 0.95], roadMax: 30 },
      { kind: "cottage", count: 6, band: [0.12, 0.95], roadMax: 30 },
      { kind: "well", count: 1, band: [0.06, 0.45], roadMax: 18 },
      { kind: "cart", count: 1, band: [0.1, 0.7] },
      { kind: "woodpile", count: 3, band: [0.2, 0.85] },
      { kind: "haystack", count: 2, band: [0.45, 1] },
      { kind: "shrine", count: 1, band: [0.3, 0.9], roadMax: 16 },
      { kind: "fence", count: 18, band: [0.35, 1], run: true },
    ],
  },
  {
    id: "fenreed",
    settlementId: "fenreed",
    x: 156,
    z: 136,
    radius: 32,
    recipes: [
      { kind: "longhouse", count: 1, band: [0.05, 0.4], roadMax: 22 },
      // Out over the fen, where the ground gives up and the reed cutters keep
      // their punts. `maxGround` pins these to the waterline; the band just
      // points them east, which is the only direction that is wet.
      { kind: "dock", count: 3, band: [0.6, 1] },
      { kind: "cottage", count: 5, band: [0.1, 0.7], roadMax: 26 },
      { kind: "well", count: 1, band: [0.05, 0.4], roadMax: 18 },
      { kind: "cart", count: 2, band: [0.1, 0.6] },
      { kind: "woodpile", count: 3, band: [0.15, 0.7] },
      { kind: "shrine", count: 1, band: [0.25, 0.7], roadMax: 16 },
      { kind: "fence", count: 18, band: [0.3, 0.8], run: true },
    ],
  },
  {
    id: "priory",
    settlementId: "greyneedle-priory",
    x: 58,
    z: -168,
    radius: 26,
    recipes: [
      { kind: "chapel", count: 1, band: [0.08, 0.4], roadMax: 26 },
      { kind: "longhouse", count: 2, band: [0.25, 0.65], roadMax: 30 },
      { kind: "cottage", count: 2, band: [0.3, 0.85], roadMax: 30 },
      { kind: "well", count: 1, band: [0.1, 0.45], roadMax: 22 },
      { kind: "shrine", count: 3, band: [0.3, 0.95] },
      { kind: "cart", count: 1, band: [0.15, 0.7] },
      { kind: "woodpile", count: 3, band: [0.25, 0.9] },
      { kind: "fence", count: 22, band: [0.4, 1], run: true },
    ],
  },
  {
    id: "delve",
    settlementId: "ashenreach-delve",
    x: 196,
    z: -108,
    radius: 26,
    recipes: [
      { kind: "quarry", count: 3, band: [0.25, 0.95] },
      { kind: "forge", count: 1, band: [0.1, 0.6], roadMax: 26 },
      { kind: "longhouse", count: 1, band: [0.12, 0.65], roadMax: 28 },
      { kind: "watchtower", count: 1, band: [0.5, 1] },
      { kind: "cottage", count: 4, band: [0.15, 0.95], roadMax: 30 },
      { kind: "well", count: 1, band: [0.1, 0.6], roadMax: 24 },
      { kind: "cart", count: 4, band: [0.15, 0.9] },
      { kind: "woodpile", count: 4, band: [0.2, 0.95] },
      { kind: "fence", count: 14, band: [0.4, 1], run: true },
    ],
  },
  {
    id: "hollowmoor",
    settlementId: "hollowmoor-camp",
    x: -132,
    z: -178,
    radius: 18,
    // Off the road on purpose: people who camp here would rather not be seen
    // from it, and `roadMin` is the whole characterisation.
    recipes: [
      { kind: "camp", count: 3, band: [0.1, 0.8], roadMin: 16 },
      { kind: "watchtower", count: 1, band: [0.5, 1], roadMin: 16 },
      { kind: "cottage", count: 1, band: [0.3, 0.95], roadMin: 16 },
      { kind: "cart", count: 2, band: [0.2, 0.95], roadMin: 16 },
      { kind: "woodpile", count: 3, band: [0.2, 0.95], roadMin: 16 },
      { kind: "fence", count: 12, band: [0.4, 1], roadMin: 16, run: true },
    ],
  },
  {
    id: "brackenkeep",
    settlementId: "bracken-keep",
    x: 118,
    z: 28,
    radius: 22,
    recipes: [
      { kind: "ruin", count: 4, band: [0.1, 0.8] },
      { kind: "camp", count: 1, band: [0.35, 0.9] },
      { kind: "shrine", count: 1, band: [0.4, 0.95] },
      { kind: "cart", count: 1, band: [0.3, 0.9] },
      { kind: "woodpile", count: 1, band: [0.3, 0.9] },
      { kind: "fence", count: 9, band: [0.5, 1], run: true },
    ],
  },

  // --- Outlying places, with no settlement to belong to ---------------------

  {
    id: "hollowmoor-stones",
    x: -128,
    z: -122,
    radius: 12,
    recipes: [
      { kind: "standing_stones", count: 1, band: [0, 0.5], roadMin: 14 },
      { kind: "shrine", count: 1, band: [0.6, 1] },
    ],
  },
  {
    id: "green-stones",
    x: 62,
    z: -46,
    radius: 12,
    recipes: [
      { kind: "standing_stones", count: 1, band: [0, 0.5], roadMin: 12 },
      { kind: "shrine", count: 1, band: [0.6, 1] },
    ],
  },
  {
    id: "farm-hearthwick",
    x: -66,
    z: 88,
    radius: 24,
    recipes: [
      { kind: "barn", count: 1, band: [0.2, 0.7], roadMax: 34 },
      { kind: "cottage", count: 1, band: [0.05, 0.45], roadMax: 30 },
      { kind: "well", count: 1, band: [0.1, 0.5] },
      { kind: "haystack", count: 4, band: [0.3, 1] },
      { kind: "cart", count: 1, band: [0.2, 0.8] },
      { kind: "woodpile", count: 2, band: [0.2, 0.9] },
      { kind: "fence", count: 28, band: [0.3, 1], run: true },
    ],
  },
  {
    id: "farm-oxleaze",
    x: -124,
    z: 14,
    radius: 24,
    recipes: [
      { kind: "barn", count: 1, band: [0.2, 0.7], roadMax: 34 },
      { kind: "cottage", count: 1, band: [0.05, 0.45], roadMax: 30 },
      { kind: "haystack", count: 4, band: [0.3, 1] },
      { kind: "cart", count: 1, band: [0.2, 0.8] },
      { kind: "woodpile", count: 2, band: [0.2, 0.9] },
      { kind: "fence", count: 26, band: [0.3, 1], run: true },
    ],
  },
  {
    id: "farm-longmead",
    x: 44,
    z: 96,
    radius: 24,
    recipes: [
      { kind: "windmill", count: 1, band: [0.4, 0.9] },
      { kind: "barn", count: 1, band: [0.2, 0.7], roadMax: 40 },
      { kind: "cottage", count: 1, band: [0.05, 0.5], roadMax: 34 },
      { kind: "haystack", count: 5, band: [0.3, 1] },
      { kind: "cart", count: 1, band: [0.2, 0.8] },
      { kind: "fence", count: 26, band: [0.3, 1], run: true },
    ],
  },
  {
    id: "farm-appleyard",
    x: -34,
    z: 236,
    radius: 22,
    recipes: [
      { kind: "barn", count: 1, band: [0.2, 0.7], roadMax: 34 },
      { kind: "cottage", count: 1, band: [0.05, 0.5], roadMax: 30 },
      { kind: "haystack", count: 3, band: [0.3, 1] },
      { kind: "woodpile", count: 2, band: [0.2, 0.9] },
      { kind: "fence", count: 22, band: [0.3, 1], run: true },
    ],
  },
  {
    id: "farm-crowfoot",
    x: 96,
    z: 4,
    radius: 22,
    recipes: [
      { kind: "barn", count: 1, band: [0.2, 0.75], roadMax: 34 },
      { kind: "cottage", count: 1, band: [0.05, 0.5], roadMax: 30 },
      { kind: "haystack", count: 3, band: [0.3, 1] },
      { kind: "cart", count: 1, band: [0.2, 0.8] },
      { kind: "fence", count: 20, band: [0.3, 1], run: true },
    ],
  },
  {
    id: "watch-ashgate",
    x: 226,
    z: -134,
    radius: 16,
    recipes: [
      { kind: "watchtower", count: 1, band: [0.1, 0.7] },
      { kind: "camp", count: 1, band: [0.4, 0.95] },
      { kind: "woodpile", count: 1, band: [0.4, 1] },
    ],
  },
  {
    id: "watch-skarnpass",
    x: -8,
    z: -252,
    radius: 18,
    recipes: [
      { kind: "watchtower", count: 1, band: [0.1, 0.7] },
      { kind: "shrine", count: 1, band: [0.4, 0.95] },
      { kind: "camp", count: 1, band: [0.4, 0.95] },
    ],
  },
  {
    id: "watch-sunder",
    x: 216,
    z: 200,
    radius: 18,
    recipes: [
      { kind: "ruin", count: 2, band: [0.1, 0.7] },
      { kind: "camp", count: 1, band: [0.4, 0.95] },
    ],
  },
  {
    id: "tarnwild-shrine",
    x: -196,
    z: -66,
    radius: 16,
    recipes: [
      { kind: "shrine", count: 2, band: [0.1, 0.8] },
      { kind: "ruin", count: 1, band: [0.3, 0.9] },
    ],
  },
];

for (let i = 0; i < CLUSTERS.length; i++) {
  buildCluster(CLUSTERS[i], 9001 + i * 65537);
}

// ---------------------------------------------------------------------------
// Road furniture
// ---------------------------------------------------------------------------

/**
 * Signposts, shrines, wells and the odd abandoned cart, along the verge of the
 * whole network.
 *
 * Placed by walking the roads rather than by sampling discs, because these are
 * the only structures whose entire purpose is to be seen from the carriageway.
 * The offset is measured from the centre line, but the *test* is still
 * `distanceToRoad` — on the inside of a bend, a perpendicular offset taken at
 * one sample can still land inside the corridor of the next one, and that is
 * exactly the near-miss that ends with a signpost in the middle of a lane.
 */
function placeRoadFurniture(): void {
  const KINDS: StructureKind[] = ["signpost", "shrine", "well", "woodpile", "cart"];
  let ordinal = 0;

  for (let r = 0; r < ROADS.length; r++) {
    const road = ROADS[r];
    const stations = Math.max(2, Math.floor(road.getLength() / 58));

    for (let s = 0; s < stations; s++) {
      const seed = 4700 + r * 8191 + s * 131;
      const kind = KINDS[Math.floor(hash2(seed, seed * 3) * KINDS.length) % KINDS.length];
      const spec = FOOTPRINTS[kind];

      const t = Math.min(
        0.9995,
        (s + 0.5) / stations + (hash2(seed * 5, seed) - 0.5) * 0.01
      );
      road.getPointAt(t, scratchPoint);
      road.getTangentAt(t, scratchTangent);

      const perpX = scratchTangent.z;
      const perpZ = -scratchTangent.x;
      const originX = scratchPoint.x;
      const originZ = scratchPoint.z;

      // Try both verges, at a few set-backs each, before giving up on this
      // station entirely.
      for (let attempt = 0; attempt < 6; attempt++) {
        const scale = scaleFor(kind, seed + attempt);
        const reach = spec.radius * scale;
        const side = attempt % 2 === 0 ? 1 : -1;
        const back =
          ROAD_HALF_WIDTH +
          reach +
          ROAD_MARGIN +
          0.6 +
          Math.floor(attempt / 2) * 1.9 +
          hash2(seed + attempt * 17, attempt) * 1.4;

        const x = originX + perpX * side * back;
        const z = originZ + perpZ * side * back;
        if (!siteIsGood(kind, x, z, reach, 0, 24)) continue;

        commit({
          id: `verge-${kind}-${ordinal++}`,
          kind,
          x,
          z,
          y: baseHeight(
            kind,
            x,
            z,
            facing(x, z, originX, originZ, seed + attempt),
            scale
          ),
          rotation: facing(x, z, originX, originZ, seed + attempt),
          scale,
          radius: reach,
        });
        break;
      }
    }
  }
}

placeRoadFurniture();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const STRUCTURES: Structure[] = structures;

export function structuresIn(settlementId: string): Structure[] {
  return STRUCTURES.filter((structure) => structure.settlementId === settlementId);
}

/**
 * Footprints, as everything that walks has to deal with them.
 *
 * Not one collider per structure. A stone circle is nine uprights with gaps you
 * can walk through, a bridge is a walkable deck between two parapets, and a
 * gate is an opening between two towers — modelling any of those as a single
 * disc would either wall off a route the player is meant to take or let them
 * stroll through solid masonry.
 */
export function structureColliders(): Collider[] {
  const list: Collider[] = [];

  const nameOf = (settlementId: string | undefined): string | undefined => {
    if (!settlementId) return undefined;
    return SETTLEMENTS.find((s) => s.id === settlementId)?.name;
  };

  for (let i = 0; i < STRUCTURES.length; i++) {
    const structure = STRUCTURES[i];
    const spec = FOOTPRINTS[structure.kind];
    // Local +X in world space, for the pieces that sit either side of a span.
    const sideX = Math.cos(structure.rotation);
    const sideZ = -Math.sin(structure.rotation);

    if (structure.kind === "bridge") {
      // The deck is walkable; the parapets are not. Set outside the carriageway
      // so nothing ever has to squeeze between them.
      const offset = ROAD_HALF_WIDTH + 0.55;
      const halfDepth = spec.halfDepth! * structure.scale;
      for (let s = -1; s <= 1; s += 2) {
        list.push({
          id: `${structure.id}-parapet${s}`,
          x: structure.x + sideX * offset * s,
          z: structure.z + sideZ * offset * s,
          radius: Math.hypot(0.35, halfDepth),
          box: { halfWidth: 0.35, halfDepth, rotation: structure.rotation },
          solid: true,
          kind: "bridge",
        });
      }
      continue;
    }

    if (structure.kind === "gate") {
      const offset = ROAD_HALF_WIDTH + 1.5;
      for (let s = -1; s <= 1; s += 2) {
        list.push({
          id: `${structure.id}-tower${s}`,
          x: structure.x + sideX * offset * s,
          z: structure.z + sideZ * offset * s,
          radius: Math.hypot(1.25, 1.25),
          box: { halfWidth: 1.25, halfDepth: 1.25, rotation: structure.rotation },
          solid: true,
          kind: "gate",
          label: nameOf(structure.settlementId),
        });
      }
      continue;
    }

    if (structure.kind === "standing_stones") {
      const ring = STONE_RING_RADIUS * structure.scale;
      for (let s = 0; s < STONE_RING_COUNT; s++) {
        if (s === STONE_FALLEN_INDEX) continue;
        const angle = (s / STONE_RING_COUNT) * Math.PI * 2;
        const wobble = Math.sin(s * 3.7) * 0.4 * structure.scale;
        list.push({
          id: `${structure.id}-stone${s}`,
          x: structure.x + Math.cos(angle) * (ring + wobble),
          z: structure.z + Math.sin(angle) * (ring + wobble),
          radius: 0.72 * structure.scale,
          solid: true,
          kind: "standing_stones",
        });
      }
      list.push({
        id: `${structure.id}-altar`,
        x: structure.x,
        z: structure.z,
        radius: Math.hypot(1.2, 0.7) * structure.scale,
        box: {
          halfWidth: 1.2 * structure.scale,
          halfDepth: 0.7 * structure.scale,
          rotation: structure.rotation,
        },
        solid: true,
        kind: "standing_stones",
        label: "Standing Stones",
      });
      continue;
    }

    if (structure.kind === "ruin") {
      // The shaft is solid; the rubble skirt out to `radius` is not, because
      // walking through a ruin is most of the point of a ruin.
      list.push({
        id: structure.id,
        x: structure.x,
        z: structure.z,
        radius: 3.1 * structure.scale,
        solid: true,
        kind: "ruin",
        label: nameOf(structure.settlementId),
      });
      continue;
    }

    const box =
      spec.halfWidth !== undefined && spec.halfDepth !== undefined
        ? {
            halfWidth: spec.halfWidth * structure.scale,
            halfDepth: spec.halfDepth * structure.scale,
            rotation: structure.rotation,
          }
        : undefined;

    list.push({
      id: structure.id,
      x: structure.x,
      z: structure.z,
      radius: structure.radius,
      box,
      solid: spec.solid,
      kind: structure.kind,
      label: nameOf(structure.settlementId),
    });
  }

  return list;
}

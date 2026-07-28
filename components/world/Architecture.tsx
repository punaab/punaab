"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  Build,
  PALETTE,
  hash2,
  type PartKey,
} from "./architecture-parts";
import {
  KIND_RECIPES,
  PART_MATERIAL,
  buildSails,
  bridgeFor,
} from "./architecture-kinds";
import {
  BEDDING,
  GROUND_FOOTPRINTS,
  STONE_FALLEN_INDEX,
  STONE_RING_COUNT,
  STONE_RING_RADIUS,
  STRUCTURES,
  lowestGroundUnder,
  type Structure,
  type StructureKind,
} from "@/lib/world/settlements";
import { ROAD_HALF_WIDTH, WATER_LEVEL, heightAt } from "@/lib/world/terrain";
import { makeCloudTexture } from "@/lib/world/textures";
import type { QualityBudget } from "@/lib/world/quality";

/**
 * Everything anybody built.
 *
 * `settlements.ts` decides where six hundred structures stand and which way
 * they face; this turns that list into geometry. The rule the whole component
 * is shaped around is that a building kind costs the same whether the world has
 * one of it or sixty: each kind is generated once per variant, split by
 * material, and instanced. Six hundred buildings come out as roughly a hundred
 * and thirty draw calls, and the cottage that costs two hundred primitives to
 * describe costs them once.
 *
 * That economy has a price, and it is the reason this file now has a section
 * about the ground. An instance is rigid. It gets one position, one rotation
 * and one scale, and the terrain under it gets no say — so anything whose parts
 * are spread over more than a couple of metres of a valley like this one cannot
 * be a single instance *and* be in contact with the earth. There are three
 * answers here, in ascending order of how much the ground moves underneath:
 *
 *  1. Buildings are levelled by `settlements.ts` and given a **footing**: a
 *     foundation course, stretched per instance, deep enough to reach the
 *     lowest ground under their walls. On the flat it is a plinth. Under the
 *     downhill corner of a house on a bank it is an undercroft. Same three
 *     hundred triangles either way, and no daylight under a wall in either.
 *  2. Fences and stone circles are **runs**, and are not instanced whole at
 *     all. Every post and every stone is sampled and set against the ground
 *     beneath *it*, and the panels are chorded from post to post, so a hundred
 *     metres of fence walks down a hillside instead of hanging off it.
 *  3. Everything else has a footprint small enough to be flat.
 *
 * Three things move — windmill sails, chimney smoke, and firelight — and all
 * three are driven from refs inside `useFrame`. Nothing here ever calls
 * `setState`: the scene graph is built on mount and mutated per frame, which is
 * the model react-three-fiber is designed around and the reason the lint rules
 * for this directory are relaxed.
 */

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * One material per part key, shared by every building in the world.
 *
 * They are all white and read their colour from the vertex attribute. That is
 * what lets a single stone material carry a hundred different shades of rubble
 * out of one draw call, and it leaves the per-instance colour free to tint a
 * whole cottage warmer or greyer than its neighbour.
 */
function makeMaterials(): Map<PartKey, THREE.MeshStandardMaterial> {
  const materials = new Map<PartKey, THREE.MeshStandardMaterial>();
  for (const key of Object.keys(PART_MATERIAL) as PartKey[]) {
    const spec = PART_MATERIAL[key];
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: spec.roughness,
      metalness: spec.metalness,
      flatShading: spec.flat,
    });
    if (spec.emissive) {
      material.emissive = spec.emissive.clone();
      // Above the bloom threshold, so lit windows and forge hearths are the
      // only things in the valley that actually glow.
      material.emissiveIntensity = 2.1;
    }
    materials.set(key, material);
  }
  return materials;
}

// ---------------------------------------------------------------------------
// Scratch and shared helpers
// ---------------------------------------------------------------------------

const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchLocalQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchScale = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();
const scratchSpin = new THREE.Quaternion();
const SPIN_AXIS = new THREE.Vector3(0, 0, 1);

/** A stable integer seed per kind name, so two kinds never build alike. */
function kindSeed(kind: string): number {
  let h = 2166136261;
  for (let i = 0; i < kind.length; i++) {
    h = Math.imul(h ^ kind.charCodeAt(i), 16777619);
  }
  return (h >>> 8) & 0x7fffff;
}

/** Deterministic variant for one structure, from its position in the list. */
function variantFor(index: number, variants: number): number {
  if (variants <= 1) return 0;
  return Math.floor(hash2(index * 2654435761, index * 40503 + 17) * variants) % variants;
}

/**
 * The per-building tint. Two identical cottages side by side is the one thing
 * instancing gets blamed for, and one multiply fixes it. Keyed on the
 * structure's index so every part of a building — walls, roof, footing —
 * lands on the same shade.
 */
function tintFor(index: number, into: THREE.Color): THREE.Color {
  const warm = 0.9 + hash2(index * 6151, index * 97 + 3) * 0.2;
  const cool = 0.92 + hash2(index * 1543, index * 71 + 11) * 0.16;
  return into.setRGB(warm, (warm + cool) * 0.5, cool);
}

/** World position of a point given in a structure's own frame. */
function localToWorld(
  structure: Structure,
  localX: number,
  localZ: number,
  into: { x: number; z: number }
): void {
  const cos = Math.cos(structure.rotation);
  const sin = Math.sin(structure.rotation);
  into.x = structure.x + (localX * cos + localZ * sin) * structure.scale;
  into.z = structure.z + (-localX * sin + localZ * cos) * structure.scale;
}

const scratchLocal = { x: 0, z: 0 };

/**
 * The lowest ground under a small round thing standing on its own.
 *
 * `lowestGroundUnder` answers for a whole structure and is keyed by kind; this
 * is for the parts of a run, where the thing being grounded is one megalith out
 * of nine. A two-metre stone on a bank is wide enough to matter — sampled at
 * its centre alone, the downhill half of its base hangs a metre in the air.
 */
function lowestAround(x: number, z: number, radius: number): number {
  let lowest = heightAt(x, z);
  const ring = 8;
  for (let i = 0; i < ring; i++) {
    const angle = (i / ring) * Math.PI * 2;
    const h = heightAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
    if (h < lowest) lowest = h;
  }
  return lowest;
}

// ---------------------------------------------------------------------------
// Footings
// ---------------------------------------------------------------------------

/**
 * How far a footing stands proud of the wall it carries, and how far it laps up
 * past the floor plane.
 *
 * Both are small and both are load-bearing. The lap is what stops the top face
 * of the footing and the underside of the plinth landing on exactly the same
 * plane and z-fighting all the way round the building. The pad is what turns
 * the result into a base course you can read rather than a seam you can see.
 */
const FOOTING_PAD = 0.12;
const FOOTING_LAP = 0.08;
/** And how far past the lowest ground it reaches, for the reason floors do. */
const FOOTING_BED = 0.55;
/** This deep even on a lawn: a building with no visible base looks planted. */
const FOOTING_MIN = 1.15;

/**
 * Live floor height for a structure.
 *
 * Settlements bake `structure.y` once at module load. Hot reload can leave that
 * number stale while the footing math moves on — and a stale Y is exactly the
 * floating cottage. Re-sample here so the mesh always meets the terrain the
 * player can see. Bridges and gates still keep their road height.
 */
function groundedY(structure: Structure): number {
  if (structure.kind === "dock") return WATER_LEVEL;
  if (structure.kind === "bridge" || structure.kind === "gate") {
    return structure.y;
  }
  // Extra sink on top of BEDDING: the terrain mesh interpolates below the
  // height samples between vertices, and on a slope that hairline becomes a
  // visible strip of daylight under a flat floor.
  return (
    lowestGroundUnder(
      structure.kind,
      structure.x,
      structure.z,
      structure.rotation,
      structure.scale,
      0.35
    ) -
    BEDDING -
    0.35
  );
}

type Footing = {
  /** Half-extents of the course at unit scale, measured to the wall face. */
  halfWidth: number;
  halfDepth: number;
  offsetX?: number;
  offsetZ?: number;
  round?: boolean;
  /**
   * Leave the middle open out to this half-width and build what is left as two
   * banks. A gate's footing has a lane running through it.
   */
  split?: number;
  /** Where it stops reaching. Past this the site was a cliff and lost. */
  maxDepth: number;
};

/**
 * Which kinds have something a foundation could be built under.
 *
 * Not a stylistic list — it answers to `GROUND_FOOTPRINTS`. Those are the kinds
 * `settlements.ts` allows to ride up off the lowest ground beneath them (their
 * `lift`), on the promise that the gap gets closed here, plus the two that
 * cannot be levelled to the earth at all because they have to meet the graded
 * road instead. A haystack is in neither list: there is no such thing as a
 * haystack on a plinth, so a haystack is levelled to the lowest straw and needs
 * nothing from this section.
 */
const FOOTINGS: Partial<Record<StructureKind, Footing>> = {
  cottage: { halfWidth: 3.35, halfDepth: 2.75, maxDepth: 2.6 },
  longhouse: { halfWidth: 6.88, halfDepth: 3.38, maxDepth: 2.6 },
  // The barn only, not its lean-to. Four posts standing in a yard do not want
  // a masonry raft under them.
  barn: { halfWidth: 5.35, halfDepth: 3.85, maxDepth: 2.6 },
  inn: { halfWidth: 5.9, halfDepth: 4.5, maxDepth: 2.6 },
  // Nave, and most of the west tower. The last half metre of the tower
  // oversails the course, which is what the buttress under it is for.
  chapel: { halfWidth: 3.8, halfDepth: 6.6, offsetZ: -0.3, maxDepth: 2.6 },
  forge: { halfWidth: 3.8, halfDepth: 3.2, maxDepth: 2.6 },
  // Under the bottom bench, which is the only part of a quarry that is worked
  // stone rather than spoil.
  quarry: { halfWidth: 6.6, halfDepth: 1.5, offsetZ: -3.0, maxDepth: 3.4 },
  // Both gate towers and both palisade wings, on two banks with the carriageway
  // between them. A gate is levelled to the graded road and to nothing else —
  // it is built to straddle one, and lowering it to the earth beside an
  // embankment would put the road through its open leaves — so on an embankment
  // this course is the whole of what stands between a tower and the daylight
  // under it.
  gate: {
    halfWidth: 6.95,
    halfDepth: 1.9,
    split: ROAD_HALF_WIDTH + 0.45,
    maxDepth: 4.0,
  },
  windmill: { halfWidth: 2.55, halfDepth: 2.55, round: true, maxDepth: 3.0 },
  watchtower: { halfWidth: 2.6, halfDepth: 2.6, round: true, maxDepth: 3.0 },
  lighthouse: { halfWidth: 2.3, halfDepth: 2.3, round: true, maxDepth: 3.0 },
  well: { halfWidth: 1.25, halfDepth: 1.25, round: true, maxDepth: 1.2 },
  ruin: { halfWidth: 3.1, halfDepth: 3.1, round: true, maxDepth: 2.6 },
};

/**
 * The course itself, as one unit block: X and Z across ±0.5, Y from −1 to 0.
 *
 * One geometry for every rectangular footing in the world, stretched per
 * instance to that building's plan and to whatever depth its ground demands.
 * Stretching is why it is built out of *vertical* slabs with no horizontal
 * joint anywhere: a course line stretched from thirty centimetres to three
 * metres reads as a smeared texture, while a vertical joint stretched by ten
 * reads as a taller stone — which is what a deep footing is actually made of.
 *
 * The lower half is set wider than the upper. A foundation that steps out on
 * the way down is how one spreads its load, and it is the whole difference
 * between a base course and a building standing on a box.
 */
function footingBox(seed: number, lod: number): Build {
  const b = new Build(seed, lod);
  // Bright warm masonry so the course reads against green turf — dark rubble
  // was disappearing into its own shadow and looking like a float gap.
  const stone = PALETTE.rubbleWarm;

  b.box("stone", b.shade(stone, 0.08), [1.08, 0.52, 1.08], [0, -0.26, 0]);
  b.box("stone", b.shade(stone, 0.08), [1.14, 0.5, 1.14], [0, -0.75, 0]);
  if (lod === 0) return b;

  const perSide = lod > 1 ? 7 : 5;
  for (const side of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      const t = (i + 0.5) / perSide - 0.5;
      b.box(
        "stone",
        b.shade(stone, 0.22),
        [(1 / perSide) * b.range(0.78, 0.97), 1, 0.16],
        [t, -0.5, side * (0.42 + FOOTING_PAD)]
      );
      b.box(
        "stone",
        b.shade(stone, 0.22),
        [0.16, 1, (1 / perSide) * b.range(0.78, 0.97)],
        [side * (0.42 + FOOTING_PAD), -0.5, t]
      );
    }
  }
  return b;
}

/** The same thing turned: a unit drum of radius 0.5, for the round towers. */
function footingRound(seed: number, lod: number): Build {
  const b = new Build(seed, lod);
  const stone = PALETTE.rubbleWarm;

  b.cylinder("stone", b.shade(stone, 0.08), 0.52, 0.56, 1, lod > 0 ? 14 : 8, [0, -0.5, 0]);
  if (lod === 0) return b;

  const blocks = lod > 1 ? 13 : 9;
  for (let i = 0; i < blocks; i++) {
    const angle = (i / blocks) * Math.PI * 2;
    b.box(
      "stone",
      b.shade(stone, 0.22),
      [((0.5 * 2 * Math.PI) / blocks) * b.range(0.8, 0.98), 1, 0.14],
      [
        Math.cos(angle) * (0.45 + FOOTING_PAD),
        -0.5,
        Math.sin(angle) * (0.45 + FOOTING_PAD),
      ],
      [0, -angle, 0]
    );
  }
  return b;
}

/**
 * One instance transform per footing, and two for a gate.
 *
 * The depth is the honest answer to "how far is it from this floor down to the
 * lowest earth under these walls", sampled over the footing's own plan rather
 * than the structure's, because a footing is only answerable for the wall it
 * carries — a barn's lean-to is somebody else's problem. `settlements.ts`
 * bounds how far a building may ride up off the ground, so this is bounded
 * too; `maxDepth` is the backstop for sites where the placer put a building on
 * the lip of something it should not have.
 */
function footingInstances(
  structure: Structure,
  spec: Footing,
  index: number,
  matrices: THREE.Matrix4[],
  owners: number[]
): void {
  const lowest = lowestGroundUnder(
    structure.kind,
    structure.x,
    structure.z,
    structure.rotation,
    structure.scale,
    FOOTING_PAD
  );
  const floorY = groundedY(structure);
  const depth = Math.min(
    spec.maxDepth,
    Math.max(FOOTING_MIN, floorY + FOOTING_LAP - (lowest - FOOTING_BED))
  );

  scratchEuler.set(0, structure.rotation, 0);
  scratchQuaternion.setFromEuler(scratchEuler);

  const place = (localX: number, localZ: number, width: number, breadth: number): void => {
    localToWorld(structure, localX, localZ, scratchLocal);
    scratchPosition.set(scratchLocal.x, floorY + FOOTING_LAP, scratchLocal.z);
    scratchScale.set(width * structure.scale, depth, breadth * structure.scale);
    matrices.push(
      new THREE.Matrix4().compose(scratchPosition, scratchQuaternion, scratchScale)
    );
    owners.push(index);
  };

  const offsetX = spec.offsetX ?? 0;
  const offsetZ = spec.offsetZ ?? 0;
  const breadth = (spec.halfDepth + FOOTING_PAD) * 2;

  if (spec.split !== undefined) {
    const width = spec.halfWidth + FOOTING_PAD - spec.split;
    for (const side of [-1, 1]) {
      place(offsetX + side * (spec.split + width / 2), offsetZ, width, breadth);
    }
    return;
  }

  place(offsetX, offsetZ, (spec.halfWidth + FOOTING_PAD) * 2, breadth);
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

/**
 * Kinds that are not instanced whole, because they are not rigid objects.
 *
 * A fence panel is nearly four metres long and the ground under this valley
 * moves half a metre in four on average — and by four metres in four at the
 * worst site in it. A stone circle is thirteen metres across and the ground
 * under one of the two in the world moves by six. There is no single Y for
 * either: take the low end and half of it is underground, take the high end and
 * half of it is in the air, take the middle and both. So they are drawn part by
 * part, each part set against the ground beneath itself.
 *
 * Anything else built as a long rigid run — a palisade, a boundary wall —
 * belongs in here rather than in `KIND_RECIPES`.
 */
const RUN_KINDS = new Set<StructureKind>(["fence", "standing_stones"]);

type Member = { structure: Structure; index: number };

/** One geometry, and every place in the world it is stamped. */
type RunPiece = {
  name: string;
  build: Build;
  matrices: THREE.Matrix4[];
  /** Which structure each instance belongs to, so the tint stays per building. */
  owners: number[];
  castShadow: boolean;
};

function makePiece(name: string, seed: number, lod: number, castShadow: boolean): RunPiece {
  return { name, build: new Build(seed, lod), matrices: [], owners: [], castShadow };
}

function pushInstance(piece: RunPiece, index: number): void {
  piece.matrices.push(
    new THREE.Matrix4().compose(scratchPosition, scratchQuaternion, scratchScale)
  );
  piece.owners.push(index);
}

/** A fence post or hurdle stake, dead upright: the lean goes on per instance. */
function fencePost(b: Build, variant: number): void {
  if (variant === 1) {
    b.cylinder("timber", b.shade(PALETTE.oakPale, 0.22), 0.035, 0.05, 1.55, 5, [0, 0.65, 0]);
    return;
  }
  b.box("timber", b.shade(PALETTE.oak, 0.2), [0.12, 1.5, 0.12], [0, 0.63, 0]);
}

/**
 * The rails between two posts: one unit long in X, so the instance scale can
 * stretch them to the exact span and the instance rotation can lay them on the
 * line between the two posts' feet.
 *
 * Nothing in here is rotated in its own geometry. A member that arrives already
 * turned gets sheared when the instance scales X and not Y, and a sheared rail
 * is more obvious than a straight one.
 */
function fenceBay(b: Build, variant: number, gapped: boolean): void {
  if (variant === 1) {
    // Woven hazel: the weave passes in front of one stake and behind the next.
    const rows = b.lod > 0 ? 8 : 4;
    for (let r = 0; r < rows; r++) {
      b.box(
        "plank",
        b.shade(PALETTE.plankPale, 0.24),
        [1, 0.09, 0.05],
        [0, 0.14 + r * (1.05 / rows), r % 2 === 0 ? 0.045 : -0.045]
      );
    }
    return;
  }

  for (let i = 0; i < 3; i++) {
    // One bay in six has lost its middle rail. A fence in perfect repair is a
    // fence nobody has ever put a cart through.
    if (i === 1 && gapped) continue;
    b.box("plank", b.shade(PALETTE.plank, 0.22), [1, 0.11, 0.06], [0, 0.32 + i * 0.36, 0]);
  }
}

/** Nodes per panel: two is a post at each end, more is a closer-fitting line. */
function fenceNodes(variant: number, lod: number): number {
  return variant === 1 && lod > 0 ? 4 : 2;
}

/**
 * Fences, walked post by post.
 *
 * Every panel keeps the x, z, rotation and scale the placer gave it — where a
 * fence line runs is that file's business, and it took road clearance and every
 * other footprint in the village into account to decide. What changes is that
 * the panel stops being one rigid object at one height: its posts are sampled
 * where they stand, and the bays are chorded between them.
 *
 * Posts are merged between neighbouring panels. A run is walked end to end with
 * a fourteen-centimetre joint between panels, so without the merge every joint
 * in the world grows a second post a hand's breadth from the first.
 */
function buildFenceRun(members: Member[], lod: number): RunPiece[] {
  const seed = kindSeed("fence");
  const posts = [
    makePiece("fence-post-0", seed + 11, lod, lod > 0),
    makePiece("fence-post-1", seed + 23, lod, lod > 0),
  ];
  const bays = [
    makePiece("fence-bay-0", seed + 37, lod, lod > 0),
    makePiece("fence-bay-0-gapped", seed + 53, lod, lod > 0),
    makePiece("fence-bay-1", seed + 71, lod, lod > 0),
  ];
  fencePost(posts[0].build, 0);
  fencePost(posts[1].build, 1);
  fenceBay(bays[0].build, 0, false);
  fenceBay(bays[1].build, 0, true);
  fenceBay(bays[2].build, 1, false);

  // Posts already standing, on a coarse grid. Deterministic, because the walk
  // over `STRUCTURES` is.
  const claimedPosts = new Set<number>();
  const nodeX: number[] = [];
  const nodeY: number[] = [];
  const nodeZ: number[] = [];

  for (const { structure, index } of members) {
    const variant = variantFor(index, 2);
    const half = GROUND_FOOTPRINTS.fence.halfWidth * structure.scale;
    const cos = Math.cos(structure.rotation);
    const sin = Math.sin(structure.rotation);
    const segments = fenceNodes(variant, lod);

    // The whole line first: a bay needs both of its ends before either is set.
    nodeX.length = 0;
    nodeY.length = 0;
    nodeZ.length = 0;
    for (let n = 0; n <= segments; n++) {
      const u = (n / segments - 0.5) * 2 * half;
      const x = structure.x + u * cos;
      const z = structure.z - u * sin;
      nodeX.push(x);
      nodeY.push(heightAt(x, z));
      nodeZ.push(z);
    }

    const post = posts[variant];
    for (let n = 0; n <= segments; n++) {
      // 0.45m cells. The joint between two panels is 0.14m, comfortably inside
      // one; the gap between two posts of the same panel is at least 0.9m.
      const key =
        (Math.round(nodeX[n] / 0.45) + 4096) * 16384 + (Math.round(nodeZ[n] / 0.45) + 4096);
      if (claimedPosts.has(key)) continue;
      claimedPosts.add(key);

      const wobble = hash2(index * 7919 + n * 131, index + n * 6151);
      const lean = hash2(index * 977 + n, index * 41 + n * 13);
      scratchEuler.set(
        (wobble - 0.5) * 0.1,
        structure.rotation + (lean - 0.5) * 0.22,
        (lean - 0.5) * 0.12,
        "YXZ"
      );
      scratchQuaternion.setFromEuler(scratchEuler);
      // Bedded, so a leaning post keeps its downhill corner in the soil.
      scratchPosition.set(nodeX[n], nodeY[n] - 0.13, nodeZ[n]);
      scratchScale.set(
        structure.scale,
        structure.scale * (0.92 + wobble * 0.16),
        structure.scale
      );
      pushInstance(post, index);
    }

    for (let n = 0; n < segments; n++) {
      const dx = nodeX[n + 1] - nodeX[n];
      const dz = nodeZ[n + 1] - nodeZ[n];
      const dy = nodeY[n + 1] - nodeY[n];
      const run = Math.hypot(dx, dz);
      const span = Math.hypot(run, dy);

      const gapped = variant === 0 && hash2(index * 3301 + n * 17, index * 79 + n) < 0.17;
      const bay = variant === 1 ? bays[2] : gapped ? bays[1] : bays[0];

      // Local +X runs along the line and local +Z is the axis it tilts about,
      // so yaw-then-tilt is exactly YZX.
      scratchEuler.set(0, Math.atan2(-dz, dx), Math.atan2(dy, run), "YZX");
      scratchQuaternion.setFromEuler(scratchEuler);
      scratchPosition.set(
        (nodeX[n] + nodeX[n + 1]) / 2,
        (nodeY[n] + nodeY[n + 1]) / 2 - 0.06,
        (nodeZ[n] + nodeZ[n + 1]) / 2
      );
      scratchScale.set(span, structure.scale, structure.scale);
      pushInstance(bay, index);
    }
  }

  return [...posts, ...bays];
}

/**
 * A stone circle, stone by stone.
 *
 * The layout is imported rather than copied: these are the same nine positions
 * `structureColliders` builds colliders from, and the stone you can see and the
 * stone you walk into have to be the same stone. One geometry serves all of
 * them — a tapered hexagonal shaft of unit height, scaled per stone — which is
 * how nine different megaliths cost one draw call.
 */
function buildStoneRun(members: Member[], lod: number): RunPiece[] {
  const seed = kindSeed("standing_stones");
  const uprights = makePiece("stone-upright", seed + 5, lod, true);
  const altars = makePiece("stone-altar", seed + 17, lod, true);
  const litter = makePiece("stone-litter", seed + 29, lod, lod > 0);

  // Unit shaft: base at 0, top at 1, narrowing the way weathering narrows one.
  // Faceted and tapered, because a smooth cylinder reads as a bollard.
  uprights.build.cylinder(
    "stone",
    uprights.build.shade(PALETTE.rubbleDark, 0.14),
    0.37,
    0.5,
    1,
    6,
    [0, 0.5, 0]
  );
  altars.build.box(
    "stone",
    altars.build.shade(PALETTE.rubbleDark, 0.1),
    [2.4, 0.68, 1.4],
    [0, 0.34, 0]
  );
  if (lod > 0) {
    litter.build.rock(
      "stone",
      litter.build.shade(PALETTE.rubbleDark, 0.2),
      [1, 0.4, 1],
      [0, 0.1, 0]
    );
  }

  for (const { structure, index } of members) {
    const place = (
      piece: RunPiece,
      localX: number,
      localZ: number,
      sink: number,
      rotX: number,
      rotY: number,
      rotZ: number,
      sizeX: number,
      sizeY: number,
      sizeZ: number
    ): void => {
      localToWorld(structure, localX, localZ, scratchLocal);
      scratchEuler.set(0, structure.rotation, 0);
      scratchQuaternion.setFromEuler(scratchEuler);
      scratchEuler.set(rotX, rotY, rotZ);
      scratchQuaternion.multiply(scratchLocalQuaternion.setFromEuler(scratchEuler));
      scratchPosition.set(
        scratchLocal.x,
        // Its own base, not the middle of it: these are wide enough that on the
        // bank one of the two circles stands on, a stone set by its centre
        // point would have half its foot in the air.
        lowestAround(
          scratchLocal.x,
          scratchLocal.z,
          Math.max(sizeX, sizeZ) * structure.scale * 0.5
        ) -
          sink * structure.scale,
        scratchLocal.z
      );
      scratchScale.set(
        sizeX * structure.scale,
        sizeY * structure.scale,
        sizeZ * structure.scale
      );
      pushInstance(piece, index);
    };

    for (let i = 0; i < STONE_RING_COUNT; i++) {
      const angle = (i / STONE_RING_COUNT) * Math.PI * 2;
      const radius = STONE_RING_RADIUS + Math.sin(i * 3.7) * 0.4;
      const height = 2.9 + Math.abs(Math.sin(i * 5.1)) * 2.3;
      const width = 0.72 + Math.abs(Math.cos(i * 4.4)) * 0.5;
      const fallen = i === STONE_FALLEN_INDEX;

      place(
        uprights,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        // A shaft tipped nearly flat pivots on its base, so it wants the ground
        // under its side rather than under its foot.
        fallen ? -width * 0.34 : 0.28,
        fallen ? Math.PI / 2.1 : Math.sin(i * 2.3) * 0.13,
        Math.cos(i * 1.9) * 0.9,
        fallen ? Math.sin(i * 2.3) * 0.14 : Math.sin(i * 2.3) * 0.08,
        width * 2,
        height,
        width * 2
      );
    }

    place(altars, 0, 0, 0.22, 0, 0, 0, 1, 1, 1);

    if (lod > 0) {
      for (let i = 0; i < 8; i++) {
        const angle = hash2(index * 8191 + i, i * 3301) * Math.PI * 2;
        const distance = 1.6 + hash2(i * 40503, index * 97 + i) * 3.4;
        const size = 0.2 + hash2(index + i * 613, i * 7919) * 0.2;
        place(
          litter,
          Math.cos(angle) * distance,
          Math.sin(angle) * distance,
          0.07,
          hash2(i, index) * 3,
          hash2(index, i) * 3,
          hash2(i * 31, index * 17) * 3,
          size,
          size * 0.8,
          size
        );
      }
    }
  }

  return [uprights, altars, litter];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

type Assembly = {
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  geometries: THREE.BufferGeometry[];
  materials: THREE.MeshStandardMaterial[];
  /** Windmill sail instances, respun every frame. */
  sails: {
    meshes: THREE.InstancedMesh[];
    hubs: Array<{ x: number; y: number; z: number; yaw: number; scale: number; phase: number }>;
  };
  /** Chimney tops in world space, for smoke. */
  chimneys: THREE.Vector3[];
  /** Hearths and campfires in world space, for the light pool. */
  fires: THREE.Vector3[];
};

/**
 * Which fire each light slot took this frame. Module scope rather than a ref
 * because it is written and read inside a single frame and never survives it —
 * a fresh array here would be sixty small allocations a second.
 */
const claimed: number[] = [];

/**
 * Kinds worth a shadow on a phone.
 *
 * Shadow casting is a second draw of every triangle, and at the low tier the
 * three hundred and twenty-six fence panels cost more in the shadow pass than
 * they are worth on screen — a knee-high shadow reads as noise from the camera
 * height this scene uses. Buildings keep theirs, because a building without a
 * shadow looks pasted on.
 */
const LOW_TIER_SHADOW_CASTERS = new Set<StructureKind>([
  "cottage",
  "longhouse",
  "barn",
  "windmill",
  "watchtower",
  "chapel",
  "forge",
  "inn",
  "ruin",
  "quarry",
  "lighthouse",
  "gate",
  "bridge",
  "standing_stones",
]);

function buildArchitecture(budget: QualityBudget): Assembly {
  // The budget's own word for it: 0 boxes and roofs, 1 adds timbering and
  // chimneys, 2 adds shutters, thatch courses and clutter.
  const lod = budget.structureDetail;
  const materials = makeMaterials();

  const group = new THREE.Group();
  group.name = "Architecture";

  const meshes: THREE.InstancedMesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const chimneys: THREE.Vector3[] = [];
  const fires: THREE.Vector3[] = [];
  const sailHubs: Assembly["sails"]["hubs"] = [];

  /** Every instanced mesh in this component is hung the same way. */
  const emit = (
    name: string,
    parts: Map<PartKey, THREE.BufferGeometry>,
    matrices: THREE.Matrix4[],
    owners: number[],
    castShadow: boolean
  ): void => {
    if (matrices.length === 0) return;
    for (const [key, geometry] of parts) {
      const material = materials.get(key);
      if (!material) continue;

      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      mesh.name = `${name}:${key}`;
      mesh.castShadow = key !== "glow" && castShadow;
      mesh.receiveShadow = true;

      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i]);
        mesh.setColorAt(i, tintFor(owners[i], scratchColor));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();

      group.add(mesh);
      meshes.push(mesh);
      geometries.push(geometry);
    }
  };

  // Group the world's structures by kind, keeping the global index so the
  // variant assignment stays stable no matter how the list is ordered.
  const byKind = new Map<StructureKind, Member[]>();
  for (let i = 0; i < STRUCTURES.length; i++) {
    const structure = STRUCTURES[i];
    const list = byKind.get(structure.kind);
    if (list) list.push({ structure, index: i });
    else byKind.set(structure.kind, [{ structure, index: i }]);
  }

  for (const [kind, all] of byKind) {
    // --- runs: not one instance, but one per part, each on its own ground ---
    if (RUN_KINDS.has(kind)) {
      const pieces = kind === "fence" ? buildFenceRun(all, lod) : buildStoneRun(all, lod);
      for (const piece of pieces) {
        emit(
          piece.name,
          piece.build.build(),
          piece.matrices,
          piece.owners,
          piece.castShadow || LOW_TIER_SHADOW_CASTERS.has(kind)
        );
      }
      continue;
    }

    const recipe = KIND_RECIPES[kind];
    if (!recipe) continue;

    // Bridges are built one at a time rather than instanced.
    //
    // Every other kind shares one geometry across all its instances, which is
    // what makes 628 structures affordable. A bridge cannot: its deck is an
    // arch pinned to the ground at *its own* two ends, and those differ from
    // bridge to bridge. Sharing a mesh would mean sharing one arch, which is
    // how the deck ended up disagreeing with the approach road in the first
    // place. There are five bridges in the valley, so five draw calls is a
    // rounding error against being able to walk onto them smoothly.
    if (kind === "bridge") {
      for (const { structure, index } of all) {
        const builder = new Build(kindSeed(kind) + index * 7919, lod);
        bridgeFor(builder, structure);
        scratchPosition.set(structure.x, structure.y, structure.z);
        scratchEuler.set(0, structure.rotation, 0);
        scratchQuaternion.setFromEuler(scratchEuler);
        scratchScale.setScalar(structure.scale);
        emit(
          `bridge:${structure.id}`,
          builder.build(),
          [
            new THREE.Matrix4().compose(
              scratchPosition,
              scratchQuaternion,
              scratchScale
            ),
          ],
          [index],
          true
        );
      }
      continue;
    }

    const variants = recipe.variants[lod];

    // Split by variant first: every instance of one mesh must share geometry.
    const groups: Member[][] = [];
    for (let v = 0; v < variants; v++) groups.push([]);
    for (const entry of all) groups[variantFor(entry.index, variants)].push(entry);

    for (let v = 0; v < variants; v++) {
      const members = groups[v];
      if (members.length === 0) continue;

      const builder = new Build(kindSeed(kind) + v * 7919, lod);
      recipe.build(builder, v, ROAD_HALF_WIDTH);

      // Instance transforms, shared by every part of this variant.
      const matrices = members.map(({ structure }) => {
        scratchPosition.set(structure.x, groundedY(structure), structure.z);
        scratchEuler.set(0, structure.rotation, 0);
        scratchQuaternion.setFromEuler(scratchEuler);
        scratchScale.setScalar(structure.scale);
        return new THREE.Matrix4().compose(
          scratchPosition,
          scratchQuaternion,
          scratchScale
        );
      });

      emit(
        `${kind}:${v}`,
        builder.build(),
        matrices,
        members.map((member) => member.index),
        lod > 0 || LOW_TIER_SHADOW_CASTERS.has(kind)
      );

      // Marks are local to the variant's geometry, so they have to ride the
      // same instance transform out into the world.
      const collect = (name: string, into: THREE.Vector3[]) => {
        const marks = builder.marks.get(name);
        if (!marks) return;
        for (let i = 0; i < members.length; i++) {
          for (const mark of marks) {
            const point = new THREE.Vector3(mark[0], mark[1], mark[2]).applyMatrix4(
              matrices[i]
            );
            into.push(point);
          }
        }
      };
      collect("chimney", chimneys);
      collect("fire", fires);

      if (kind === "windmill") {
        const hubs = builder.marks.get("sailHub");
        if (hubs) {
          for (let i = 0; i < members.length; i++) {
            const structure = members[i].structure;
            const local = hubs[0];
            scratchPosition
              .set(local[0], local[1], local[2])
              .applyMatrix4(matrices[i]);
            sailHubs.push({
              x: scratchPosition.x,
              y: scratchPosition.y,
              z: scratchPosition.z,
              yaw: structure.rotation,
              scale: structure.scale,
              // Two mills in the same valley turning in lockstep would be the
              // most obviously generated thing in the scene.
              phase: hash2(members[i].index * 8191, 13) * Math.PI * 2,
            });
          }
        }
      }
    }
  }

  // --- footings -------------------------------------------------------------
  // Two geometries carry every foundation in the world, one boxed and one
  // round. They are the only instances here whose scale is not uniform, and
  // that is the entire point of them.
  const boxed = { matrices: [] as THREE.Matrix4[], owners: [] as number[] };
  const round = { matrices: [] as THREE.Matrix4[], owners: [] as number[] };
  for (const [kind, all] of byKind) {
    const spec = FOOTINGS[kind];
    if (!spec) continue;
    const into = spec.round ? round : boxed;
    for (const { structure, index } of all) {
      footingInstances(structure, spec, index, into.matrices, into.owners);
    }
  }
  // No shadow: a footing is a base course, and every one of them is standing in
  // the shadow the building above it already casts.
  emit(
    "footing:box",
    footingBox(kindSeed("footing"), lod).build(),
    boxed.matrices,
    boxed.owners,
    false
  );
  emit(
    "footing:round",
    footingRound(kindSeed("footing") + 613, lod).build(),
    round.matrices,
    round.owners,
    false
  );

  // --- sails ----------------------------------------------------------------
  const sailMeshes: THREE.InstancedMesh[] = [];
  if (sailHubs.length > 0) {
    const sailBuild = buildSails(424242, lod);
    for (const [key, geometry] of sailBuild.build()) {
      const material = materials.get(key);
      if (!material) continue;
      const mesh = new THREE.InstancedMesh(geometry, material, sailHubs.length);
      mesh.name = `sails:${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // The sails sweep a 13m disc that the bounding sphere of a static frame
      // cannot describe, and they are two of the tallest things in the valley.
      // Culling them on a stale sphere pops them out at the worst moment.
      mesh.frustumCulled = false;
      group.add(mesh);
      sailMeshes.push(mesh);
      geometries.push(geometry);
    }
  }

  return {
    group,
    meshes,
    geometries,
    materials: [...materials.values()],
    sails: { meshes: sailMeshes, hubs: sailHubs },
    chimneys,
    fires,
  };
}

// ---------------------------------------------------------------------------
// Smoke
// ---------------------------------------------------------------------------

const SMOKE_PUFFS = 7;

type Smoke = {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
  texture: THREE.Texture;
  columns: THREE.Vector3[];
  /** Per-puff drift and rate, so no two columns rise the same way. */
  seeds: Float32Array;
};

/**
 * Chimney smoke, as camera-facing puffs.
 *
 * Instanced billboards rather than a particle library: one draw call for the
 * whole valley, no external dependency, and the alpha comes out of the instance
 * colour through a two-line shader patch — which is the only way to fade
 * individual instances of a shared material without writing a whole material.
 */
function makeSmoke(columns: THREE.Vector3[]): Smoke {
  const texture = makeCloudTexture(96, 11);
  const material = new THREE.MeshBasicMaterial({
    color: 0xb9b4ab,
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  // `color_fragment` would multiply the *colour* by the instance value, which
  // fades smoke to black instead of to nothing. Replacing the chunk outright
  // moves the instance value onto alpha, where it belongs.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      "diffuseColor.a *= vColor.r;"
    );
  };

  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    Math.max(1, columns.length * SMOKE_PUFFS)
  );
  mesh.name = "Smoke";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  // Instance colour is the fade channel, so it has to exist before the first
  // frame writes to it.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(mesh.count * 3),
    3
  );

  const seeds = new Float32Array(columns.length * SMOKE_PUFFS * 3);
  for (let i = 0; i < columns.length * SMOKE_PUFFS; i++) {
    seeds[i * 3] = hash2(i * 7919, 3);
    seeds[i * 3 + 1] = hash2(i * 104729, 7);
    seeds[i * 3 + 2] = hash2(i * 40503, 11);
  }

  return { mesh, geometry, material, texture, columns, seeds };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** How many point lights the tier can afford, and how far they reach. */
const FIRE_LIGHTS: Record<QualityBudget["tier"], number> = {
  low: 0,
  medium: 1,
  high: 3,
};

export function Architecture({ budget }: { budget: QualityBudget }) {
  // Structure Y is sampled at build time, so this memo holds geometry that
  // encodes where the ground was. `budget` is the only thing that can change
  // it at runtime. (A literal in the dependency list does nothing here — it is
  // constant, so React compares it equal on every render; editing it only
  // busts the memo because the edit itself triggers a Fast Refresh remount.)
  const built = useMemo(() => buildArchitecture(budget), [budget]);

  const smoke = useMemo(() => {
    if (budget.tier === "low" || built.chimneys.length === 0) return null;
    // Every chimney in the valley smoking at once is both expensive and wrong —
    // most houses are not cooking. Taking a deterministic stride through the
    // list keeps the ones that do smoke spread across the map.
    const wanted = budget.tier === "high" ? 16 : 8;
    const stride = Math.max(1, Math.floor(built.chimneys.length / wanted));
    const columns: THREE.Vector3[] = [];
    for (let i = 0; i < built.chimneys.length && columns.length < wanted; i += stride) {
      columns.push(built.chimneys[i]);
    }
    return makeSmoke(columns);
  }, [budget.tier, built.chimneys]);

  const lightCount = FIRE_LIGHTS[budget.tier];
  const lightRefs = useRef<Array<THREE.PointLight | null>>([]);

  useEffect(() => {
    return () => {
      for (const geometry of built.geometries) geometry.dispose();
      for (const material of built.materials) material.dispose();
      if (smoke) {
        smoke.geometry.dispose();
        smoke.material.dispose();
        smoke.texture.dispose();
      }
    };
  }, [built, smoke]);

  useFrame((state) => {
    const time = state.clock.elapsedTime;

    // --- windmill sails ---------------------------------------------------
    const { hubs, meshes } = built.sails;
    if (meshes.length > 0) {
      for (let i = 0; i < hubs.length; i++) {
        const hub = hubs[i];
        // Slow, and slightly uneven: a mill turning at a constant rate reads as
        // a machine, and this one is driven by weather.
        const spin =
          time * 0.42 + hub.phase + Math.sin(time * 0.23 + hub.phase) * 0.35;
        scratchPosition.set(hub.x, hub.y, hub.z);
        scratchEuler.set(0, hub.yaw, 0);
        scratchQuaternion.setFromEuler(scratchEuler);
        scratchQuaternion.multiply(scratchSpin.setFromAxisAngle(SPIN_AXIS, spin));
        scratchScale.setScalar(hub.scale);
        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
        for (const mesh of meshes) mesh.setMatrixAt(i, scratchMatrix);
      }
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    }

    // --- smoke ------------------------------------------------------------
    if (smoke) {
      const { mesh, columns, seeds } = smoke;
      // One quaternion for every puff: screen-aligned billboards, which is what
      // stops them shearing into flat slabs as the camera swings round.
      state.camera.getWorldQuaternion(scratchQuaternion);
      let instance = 0;
      for (let c = 0; c < columns.length; c++) {
        const column = columns[c];
        for (let p = 0; p < SMOKE_PUFFS; p++) {
          const s = instance * 3;
          const rate = 0.16 + seeds[s] * 0.09;
          const life = (time * rate + p / SMOKE_PUFFS + seeds[s + 1]) % 1;
          const rise = life * 7.5;
          const spread = 0.35 + life * 2.4;

          scratchPosition.set(
            column.x + Math.sin(time * 0.5 + seeds[s + 2] * 6.3) * life * 1.5,
            column.y + rise,
            column.z + Math.cos(time * 0.37 + seeds[s + 2] * 6.3) * life * 1.2
          );
          scratchScale.setScalar(spread);
          scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
          mesh.setMatrixAt(instance, scratchMatrix);

          // Fades in over the first tenth of its life and out over the rest.
          const alpha = Math.min(1, life * 9) * (1 - life) * 0.55;
          scratchColor.setRGB(alpha, alpha, alpha);
          mesh.setColorAt(instance, scratchColor);
          instance++;
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // --- firelight --------------------------------------------------------
    if (lightCount > 0 && built.fires.length > 0) {
      const camera = state.camera.position;
      // A pool of lights that snaps to whichever hearths are nearest, rather
      // than a light per fire. Ten point lights would cost more than the rest
      // of the scene put together, and you can only ever be near one or two.
      for (let slot = 0; slot < lightCount; slot++) {
        let best = -1;
        let bestDistance = Infinity;
        for (let i = 0; i < built.fires.length; i++) {
          // Skip anything a nearer slot already claimed.
          let taken = false;
          for (let j = 0; j < slot; j++) {
            if (claimed[j] === i) {
              taken = true;
              break;
            }
          }
          if (taken) continue;
          const distance = built.fires[i].distanceToSquared(camera);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        }
        claimed[slot] = best;

        const light = lightRefs.current[slot];
        if (!light) continue;
        if (best < 0 || bestDistance > 90 * 90) {
          light.intensity = 0;
          continue;
        }
        const fire = built.fires[best];
        light.position.copy(fire);
        // Layered sines at incommensurable rates never settle into a visible
        // pattern, which is what fire flicker needs.
        const flicker =
          0.74 +
          Math.sin(time * 11.3 + best) * 0.12 +
          Math.sin(time * 6.7 + best * 2.1) * 0.09 +
          Math.sin(time * 23.1 + best * 0.7) * 0.05;
        light.intensity = 26 * flicker;
      }
    }
  });

  return (
    <group name="ArchitectureRoot">
      <primitive object={built.group} />
      {smoke && <primitive object={smoke.mesh} />}
      {Array.from({ length: lightCount }, (_, i) => (
        <pointLight
          key={i}
          ref={(light: THREE.PointLight | null) => {
            lightRefs.current[i] = light;
          }}
          color="#ff9a44"
          intensity={0}
          distance={26}
          decay={2}
          castShadow={false}
        />
      ))}
    </group>
  );
}

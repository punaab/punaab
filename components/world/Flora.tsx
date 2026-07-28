"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  WORLD_SIZE,
  WATER_LEVEL,
  TREE_LINE,
  WATERS,
  ROADS,
  ROAD_HALF_WIDTH,
  distanceToRoad,
  heightAt,
} from "@/lib/world/terrain";
import { biomeWeights, type BiomeId } from "@/lib/world/regions";
import {
  barkFields,
  makeFoliageAlpha,
  makeRockNormalMap,
  makeTreeBillboard,
  type BillboardShape,
} from "@/lib/world/textures";
import type { QualityBudget } from "@/lib/world/quality";
import { GHIBLI, ghibliSunDirection } from "@/lib/world/ghibli-palette";
import {
  GRASS_BLADE_HEIGHT,
  GRASS_BLADE_WIDTH,
  GRASS_QUALITY,
  GRASS_RINGS,
  GrassChunkGrid,
  bakeGrassGround,
  buildRingBlades,
  grassTierIndex,
  ringBand,
  type GrassRing,
} from "@/lib/world/grass";

/**
 * Everything that grows.
 *
 * A 640-metre valley cannot be forested by scattering more trees at it. Five
 * thousand trees at full geometry is five million triangles, which is a
 * slideshow on any laptop; five hundred at full geometry is a park with gaps.
 * The way out is that a tree two hundred metres off is four pixels wide and
 * does not need to be a tree — so every species here exists at three levels of
 * detail, and the whole population is re-sorted into them a few times a second
 * by distance and against the view frustum. What reaches the GPU is a few
 * hundred detailed plants and a few thousand cards, no matter how large the
 * population behind them grows.
 *
 * Species come from `biomeWeights()` rather than one global scatter. Pines
 * belong in the pine belt and reeds belong in the fen, and a wood that changes
 * as you walk through it is most of what makes a place feel travelled rather
 * than generated.
 */

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * Integer hash -> [0, 1). Copied from `terrain.ts`, which is the point: every
 * scatter in the world must agree, and the world must be identical on every
 * load and every machine.
 *
 * `Math.imul` is load-bearing. A plain `*` on these constants runs past 2^53,
 * the float silently drops its low bits, and the low bits are the entire output
 * of a hash — this exact bug already shipped here once and pulled every
 * scattered prop into one corner of the map.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp01(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

type Rgb = [number, number, number];

/** sRGB bytes -> the renderer's working colour space. */
function srgb(r: number, g: number, b: number): Rgb {
  const colour = new THREE.Color().setRGB(
    r / 255,
    g / 255,
    b / 255,
    THREE.SRGBColorSpace
  );
  return [colour.r, colour.g, colour.b];
}

/** Hex from the Ghibli film stock → working colour. */
function hexRgb(hex: string): Rgb {
  const colour = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
  return [colour.r, colour.g, colour.b];
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function smooth01(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * CodePen meadow blade: teal at the root, yellow-green at the tip.
 * Same vertical hue path as Hoshi-no-Tani §6 — not a flat two-stop lerp.
 */
function meadowBladeColour(t: number): Rgb {
  let lit = mixRgb(G_LOW, G_MID, smooth01(0, 0.26, t));
  lit = mixRgb(lit, G_UPPER, smooth01(0.2, 0.66, t));
  lit = mixRgb(lit, G_TIP, smooth01(0.8, 1, t));
  const ao = mixRgb(G_BASE, lit, Math.pow(t, 0.55));
  return mixRgb(ao, lit, 0.72);
}

const G_TIP = hexRgb(GHIBLI.gTip);
const G_UPPER = hexRgb(GHIBLI.gUpper);
const G_MID = hexRgb(GHIBLI.gMid);
const G_LOW = hexRgb(GHIBLI.gLow);
const G_BASE = hexRgb(GHIBLI.gBase);
const C_LIT = hexRgb(GHIBLI.cLit);
const C_MID = hexRgb(GHIBLI.cMid);
const C_SHADE = hexRgb(GHIBLI.cShade);
const C_DEEP = hexRgb(GHIBLI.cDeep);
const TRUNK_LIT = hexRgb(GHIBLI.trunkLit);
const TRUNK_SHADE = hexRgb(GHIBLI.trunkShade);

// ---------------------------------------------------------------------------
// Geometry building
// ---------------------------------------------------------------------------

/**
 * A scratch pad for procedural meshes.
 *
 * Everything here accumulates into one of these and emits a single geometry at
 * the end, rather than merging a pile of primitives. It is faster, but mostly
 * it is what makes baked vertex colour practical — and baked vertex colour is
 * the whole difference between these plants and the last set. A tree only
 * convinces when its canopy is nearly black on the inside and its trunk is dark
 * at the root, and neither of those is expressible by translating a sphere.
 */
class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

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
    const index = this.positions.length / 3;
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    this.colors.push(colour[0], colour[1], colour[2]);
    return index;
  }

  tri(a: number, b: number, c: number) {
    this.indices.push(a, b, c);
  }

  /** Two triangles, wound so the face normal comes out of a, b, c, d. */
  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, b, c, a, c, d);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3)
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(this.normals, 3)
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(this.colors, 3)
    );
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Copies a geometry into a builder, offsetting its indices. */
function appendGeometry(b: MeshBuilder, geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const normal = geometry.attributes.normal as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const colour = geometry.attributes.color as THREE.BufferAttribute;
  const index = geometry.index!;
  const offset = b.positions.length / 3;

  for (let i = 0; i < position.count; i++) {
    b.positions.push(position.getX(i), position.getY(i), position.getZ(i));
    b.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    b.uvs.push(uv.getX(i), uv.getY(i));
    b.colors.push(colour.getX(i), colour.getY(i), colour.getZ(i));
  }
  for (let i = 0; i < index.count; i++) b.indices.push(offset + index.getX(i));
}

/** Icosphere topology, shared by every leaf mass and boulder in the world. */
const shellCache = new Map<number, { positions: Float32Array; index: Uint16Array }>();

function shellBase(subdivisions: number) {
  const hit = shellCache.get(subdivisions);
  if (hit) return hit;
  // Welded, because `IcosahedronGeometry` hands back one vertex per corner per
  // face — six times the vertices for the same eighty triangles, and every leaf
  // mass in the valley would pay for it.
  const source = new THREE.IcosahedronGeometry(1, subdivisions);
  source.deleteAttribute("uv");
  source.deleteAttribute("normal");
  const welded = mergeVertices(source, 1e-4);
  const made = {
    positions: Float32Array.from(
      (welded.attributes.position as THREE.BufferAttribute).array
    ),
    index: Uint16Array.from(welded.index!.array),
  };
  source.dispose();
  welded.dispose();
  shellCache.set(subdivisions, made);
  return made;
}

type ShellOptions = {
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  ry: number;
  rz: number;
  seed: number;
  subdivisions: number;
  /** How far the surface is allowed to wander in and out, as a fraction. */
  lumpiness: number;
  /** Colour on the sunlit outside. */
  lit: Rgb;
  /** Colour deep inside, where no light gets. */
  shaded: Rgb;
  crownBottom: number;
  crownTop: number;
  crownRadius: number;
  uvScale: number;
  /** Pull the underside of the shell down — pine needle droop / hanging willow. */
  droop?: number;
  /** Pinch the top toward a point (0 = sphere, 1 = hard cone). */
  tipPinch?: number;
};

/**
 * One mass of leaves.
 *
 * Two things do the work here. The radial displacement, which is what stops a
 * shell being a ball — the eye reads a silhouette long before it reads shading,
 * and a circular outline is the single loudest thing wrong with procedural
 * trees. And the baked occlusion, which is what stops a *cluster* of shells
 * being a cloud: a real canopy is nearly black in its middle and bright only on
 * its top and outer skin, and no runtime lighting will supply that for a shape
 * the size of a shrub.
 */
function addShell(b: MeshBuilder, options: ShellOptions) {
  const base = shellBase(options.subdivisions);
  const count = base.positions.length / 3;
  const first = b.positions.length / 3;
  const angle = hash2(options.seed, options.seed * 7) * Math.PI * 2;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const crownHeight = Math.max(0.001, options.crownTop - options.crownBottom);

  const droop = options.droop ?? 0;
  const tipPinch = options.tipPinch ?? 0;

  for (let i = 0; i < count; i++) {
    const dx = base.positions[i * 3];
    const dy = base.positions[i * 3 + 1];
    const dz = base.positions[i * 3 + 2];

    // Quantising the direction means two vertices sharing a position share a
    // displacement, so the shell can never tear open along a shared edge.
    const key = Math.round(dx * 64) * 9781 + Math.round(dy * 64) * 271;
    const lump =
      1 -
      options.lumpiness * 0.5 +
      hash2(key + options.seed * 131, Math.round(dz * 64) + options.seed) *
        options.lumpiness;

    // Cone the upper hemisphere in — a pine tip is a spire, not a ball.
    const upN = clamp01(dy * 0.5 + 0.5);
    const pinch = 1 - tipPinch * upN * upN;
    let sy = dy;
    if (droop > 0 && dy < 0) sy = dy * (1 + droop);

    const px = options.cx + dx * options.rx * lump * pinch;
    const py = options.cy + sy * options.ry * lump;
    const pz = options.cz + dz * options.rz * lump * pinch;

    // The ellipsoid's true normal, not the sphere direction — a crown flattened
    // to a third of its width lights completely wrong otherwise.
    let nx = dx / (options.rx * options.rx);
    let ny = dy / (options.ry * options.ry);
    let nz = dz / (options.rz * options.rz);
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;

    // Height in the crown supplies the key light, distance from the trunk axis
    // the rest. The interior of a canopy gets neither.
    const up = clamp01((py - options.crownBottom) / crownHeight);
    const out = clamp01(Math.hypot(px, pz) / Math.max(0.001, options.crownRadius));
    const exposure = clamp01(0.08 + up * 0.5 + out * 0.5);

    // A planar projection at a per-shell angle. A spherical unwrap would put a
    // seam down every leaf mass; rotating the projection instead means the
    // stretching runs a different way on each shell and reads as nothing.
    const u = (px * ca - pz * sa) * options.uvScale + options.seed * 0.37;
    const v =
      (py + (px * sa + pz * ca) * 0.5) * options.uvScale + options.seed * 0.19;

    b.vertex(px, py, pz, nx, ny, nz, u, v, mixRgb(options.shaded, options.lit, exposure));
  }

  for (let i = 0; i < base.index.length; i += 3) {
    b.tri(
      first + base.index[i],
      first + base.index[i + 1],
      first + base.index[i + 2]
    );
  }
}

const REF_A = new THREE.Vector3(0.37, 0.11, -0.92).normalize();
const REF_B = new THREE.Vector3(-0.86, 0.42, 0.28).normalize();

/**
 * A tapered tube along a path. Trunks, branches, stems, dead snags.
 *
 * The frame is rebuilt per ring from a fixed reference vector rather than
 * parallel-transported. Transport would twist less on a violently curving
 * branch, and matters not at all on something four pixels wide with bark
 * texture over it.
 */
function addTube(
  b: MeshBuilder,
  path: THREE.Vector3[],
  radii: number[],
  sides: number,
  colourAt: (t: number) => Rgb,
  uvScale = 1
) {
  const rings: number[][] = [];
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const forward = new THREE.Vector3();

  for (let i = 0; i < path.length; i++) {
    if (i < path.length - 1) direction.subVectors(path[i + 1], path[i]);
    else direction.subVectors(path[i], path[i - 1]);
    if (direction.lengthSq() < 1e-9) direction.set(0, 1, 0);
    direction.normalize();

    const reference = Math.abs(direction.dot(REF_A)) > 0.9 ? REF_B : REF_A;
    right.crossVectors(direction, reference).normalize();
    forward.crossVectors(right, direction).normalize();

    const colour = colourAt(i / Math.max(1, path.length - 1));
    const radius = radii[i];
    const ring: number[] = [];

    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const nx = right.x * ca + forward.x * sa;
      const ny = right.y * ca + forward.y * sa;
      const nz = right.z * ca + forward.z * sa;
      ring.push(
        b.vertex(
          path[i].x + nx * radius,
          path[i].y + ny * radius,
          path[i].z + nz * radius,
          nx,
          ny,
          nz,
          (s / sides) * uvScale,
          path[i].y * uvScale * 0.5,
          colour
        )
      );
    }
    rings.push(ring);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const next = (s + 1) % sides;
      b.quad(rings[i][s], rings[i + 1][s], rings[i + 1][next], rings[i][next]);
    }
  }
}

/**
 * A single tapered, forward-bent blade — grass, sedge, reed, barley.
 *
 * The width is tuned between two failure modes: much wider and a blade reads as
 * a yucca leaf; at a true-to-life centimetre it is thinner than a pixel at any
 * distance the camera actually sits, and the whole field disappears.
 */
function addBlade(
  b: MeshBuilder,
  yaw: number,
  lean: number,
  height: number,
  halfWidth: number,
  segments: number,
  base: Rgb,
  tip: Rgb,
  spread: number
) {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const ox = ca * spread;
  const oz = sa * spread;
  const rows: number[][] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * height * Math.cos(lean * t);
    // Bending increasingly toward the tip; a perfectly straight blade reads as
    // a spike.
    const reach = t * height * Math.sin(lean * t) + t * t * height * 0.16;
    const width = halfWidth * (1 - t) * (1 - t * 0.3);
    // Darker in the sward, lime at the tip — CodePen meadow path when using
    // the shared Ghibli stops (reference-equal), otherwise a two-stop lerp.
    const colour =
      base === G_BASE && tip === G_TIP
        ? meadowBladeColour(t)
        : mixRgb(base, tip, t * t * 0.85 + t * 0.15);

    const cx = ox + ca * reach;
    const cz = oz + sa * reach;
    const px = -sa * width;
    const pz = ca * width;

    rows.push([
      b.vertex(cx - px, y, cz - pz, sa * 0.4, 0.86, -ca * 0.4, 0, t, colour),
      b.vertex(cx + px, y, cz + pz, sa * 0.4, 0.86, -ca * 0.4, 1, t, colour),
    ]);
  }

  for (let i = 0; i < segments; i++) {
    b.quad(rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
  }
}

/**
 * A crown of blades from one root.
 *
 * The instance count is what costs draw time, not the vertices inside each
 * instance, so merging a dozen blades into one clump multiplies visible density
 * twelvefold for exactly the same number of draws. Single blades scattered
 * individually never look like grass anyway — they look like stubble. Real
 * grass grows in tufts from one crown.
 */
function bladeTuft(options: {
  blades: number;
  height: number;
  halfWidth: number;
  segments: number;
  lean: number;
  spread: number;
  base: Rgb;
  tip: Rgb;
  seed: number;
}): THREE.BufferGeometry {
  const b = new MeshBuilder();
  for (let i = 0; i < options.blades; i++) {
    // The golden angle, so the blades never line up into visible spokes.
    const yaw = i * 2.39996 + hash2(options.seed + i, i * 13) * 0.5;
    const wobble = hash2(i * 7 + options.seed, options.seed);
    addBlade(
      b,
      yaw,
      options.lean * (0.6 + wobble * 0.8),
      options.height * (0.62 + wobble * 0.58),
      options.halfWidth,
      options.segments,
      options.base,
      options.tip,
      options.spread * (0.2 + ((i * 5) % 7) / 7)
    );
  }
  return b.build();
}

/**
 * Two quads at right angles, for the far level of detail.
 *
 * Cheaper than a shader-billboarded card and, for a camera that stays near the
 * ground and never looks down on a forest, better: a true billboard rotates as
 * you walk past it and the whole wood swivels with you, where crossed cards
 * hold still and read as volume.
 */
function crossedCards(width: number, height: number): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const white: Rgb = [1, 1, 1];
  for (let i = 0; i < 2; i++) {
    const angle = i * Math.PI * 0.5;
    const dx = Math.cos(angle) * width * 0.5;
    const dz = Math.sin(angle) * width * 0.5;
    // The normal leans out of the card face and well upward, so a flat quad
    // still catches something of the sky and does not render as a black slab
    // whenever the sun is behind it.
    const nx = Math.sin(angle) * 0.45;
    const nz = -Math.cos(angle) * 0.45;
    // UVs: v = 0 at the ground, v = 1 at the tip. The billboard texture is
    // authored bottom-up in shape space and uploaded with flipY, so this is
    // the only winding that keeps distant crowns upright.
    const a = b.vertex(-dx, 0, -dz, nx, 0.78, nz, 0, 0, white);
    const c = b.vertex(dx, 0, dz, nx, 0.78, nz, 1, 0, white);
    const d = b.vertex(dx, height, dz, nx, 0.78, nz, 1, 1, white);
    const e = b.vertex(-dx, height, -dz, nx, 0.78, nz, 0, 1, white);
    b.quad(a, c, d, e);
  }
  return b.build();
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

type TreeSpec = {
  id: string;
  /** Fraction of the tree budget this species takes. */
  share: number;
  weights: Partial<Record<BiomeId, number>>;
  height: number;
  trunkRadius: number;
  /** How far off vertical the stem wanders. */
  lean: number;
  branches: number;
  branchAngle: number;
  crownShells: number;
  crownRadius: number;
  crownFlatten: number;
  /** Where the crown starts, as a fraction of trunk height. */
  crownRise: number;
  conifer: boolean;
  leafless: boolean;
  bark: Rgb;
  barkDark: Rgb;
  leaf: Rgb;
  leafShade: Rgb;
  scale: [number, number];
  maxSlope: number;
  minHeight: number;
  maxHeight: number;
  clump: number;
  clumpRadius: number;
  minRoadDistance: number;
  minWaterDistance: number;
  billboard: BillboardShape;
};

const TREES: TreeSpec[] = [
  {
    id: "pine",
    share: 0.3,
    weights: { pine: 1, highland: 0.3, heath: 0.07, marsh: 0.05, broadleaf: 0.08 },
    height: 12.5,
    trunkRadius: 0.3,
    lean: 0.1,
    branches: 0,
    branchAngle: 0.9,
    crownShells: 8,
    crownRadius: 2.65,
    crownFlatten: 0.22,
    crownRise: 0.28,
    conifer: true,
    leafless: false,
    bark: TRUNK_LIT,
    barkDark: TRUNK_SHADE,
    leaf: C_LIT,
    leafShade: C_SHADE,
    scale: [0.62, 1.35],
    maxSlope: 0.5,
    minHeight: WATER_LEVEL + 0.8,
    maxHeight: TREE_LINE,
    clump: 3,
    clumpRadius: 5.5,
    minRoadDistance: 5,
    minWaterDistance: 2,
    billboard: {
      blobs: [
        [0.5, 0.92, 0.08],
        [0.5, 0.82, 0.12],
        [0.5, 0.7, 0.16],
        [0.5, 0.56, 0.2],
        [0.5, 0.42, 0.24],
        [0.5, 0.3, 0.27],
      ],
      trunk: 0.24,
      trunkWidth: 0.024,
      leaf: C_LIT,
      bark: TRUNK_SHADE,
    },
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
    height: 8.6,
    trunkRadius: 0.46,
    lean: 0.22,
    branches: 4,
    branchAngle: 1.05,
    crownShells: 8,
    crownRadius: 4.4,
    crownFlatten: 0.72,
    crownRise: 0.6,
    conifer: false,
    leafless: false,
    bark: srgb(120, 102, 82),
    barkDark: srgb(52, 44, 36),
    leaf: hexRgb("#98AC43"),
    leafShade: C_MID,
    scale: [0.66, 1.45],
    maxSlope: 0.42,
    minHeight: WATER_LEVEL + 0.8,
    maxHeight: TREE_LINE - 6,
    clump: 2,
    clumpRadius: 11,
    minRoadDistance: 5.5,
    minWaterDistance: 2.5,
    billboard: {
      blobs: [
        [0.5, 0.78, 0.23],
        [0.3, 0.67, 0.19],
        [0.7, 0.69, 0.19],
        [0.42, 0.55, 0.18],
        [0.62, 0.53, 0.16],
      ],
      trunk: 0.42,
      trunkWidth: 0.045,
      leaf: hexRgb("#98AC43"),
      bark: srgb(114, 96, 78),
    },
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
    height: 10.4,
    trunkRadius: 0.21,
    lean: 0.3,
    branches: 3,
    branchAngle: 0.72,
    crownShells: 6,
    crownRadius: 2.4,
    crownFlatten: 0.94,
    crownRise: 0.56,
    conifer: false,
    leafless: false,
    bark: srgb(216, 210, 198),
    barkDark: srgb(92, 88, 84),
    leaf: hexRgb("#A9B65C"),
    leafShade: C_MID,
    scale: [0.7, 1.3],
    maxSlope: 0.46,
    minHeight: WATER_LEVEL + 0.8,
    maxHeight: TREE_LINE,
    clump: 4,
    clumpRadius: 5,
    minRoadDistance: 5,
    minWaterDistance: 2,
    billboard: {
      blobs: [
        [0.5, 0.83, 0.15],
        [0.38, 0.71, 0.13],
        [0.62, 0.69, 0.12],
        [0.5, 0.6, 0.12],
      ],
      trunk: 0.5,
      trunkWidth: 0.022,
      leaf: hexRgb("#A9B65C"),
      bark: srgb(208, 202, 190),
    },
  },
  {
    id: "willow",
    share: 0.09,
    weights: { marsh: 0.8, shore: 0.5, orchard: 0.14, broadleaf: 0.14, meadow: 0.07 },
    height: 6.4,
    trunkRadius: 0.4,
    lean: 0.36,
    branches: 5,
    branchAngle: 1.35,
    crownShells: 7,
    crownRadius: 3.6,
    crownFlatten: 0.88,
    crownRise: 0.66,
    conifer: false,
    leafless: false,
    bark: srgb(96, 86, 70),
    barkDark: srgb(42, 38, 32),
    leaf: hexRgb("#6E9440"),
    leafShade: C_DEEP,
    scale: [0.7, 1.24],
    maxSlope: 0.34,
    minHeight: WATER_LEVEL + 0.15,
    maxHeight: 26,
    clump: 3,
    clumpRadius: 9,
    minRoadDistance: 4.5,
    minWaterDistance: -1,
    billboard: {
      blobs: [
        [0.5, 0.74, 0.21],
        [0.28, 0.6, 0.17],
        [0.72, 0.6, 0.17],
        [0.5, 0.5, 0.19],
      ],
      trunk: 0.34,
      trunkWidth: 0.04,
      leaf: hexRgb("#6E9440"),
      bark: srgb(92, 82, 68),
    },
  },
  {
    id: "apple",
    share: 0.09,
    weights: { orchard: 1, farmland: 0.16 },
    height: 4.2,
    trunkRadius: 0.24,
    lean: 0.26,
    branches: 4,
    branchAngle: 1.15,
    crownShells: 6,
    crownRadius: 2.3,
    crownFlatten: 0.88,
    crownRise: 0.7,
    conifer: false,
    leafless: false,
    bark: srgb(106, 86, 66),
    barkDark: srgb(46, 36, 28),
    leaf: C_MID,
    leafShade: C_DEEP,
    scale: [0.82, 1.12],
    maxSlope: 0.24,
    minHeight: WATER_LEVEL + 1,
    maxHeight: 34,
    clump: 1,
    clumpRadius: 0,
    minRoadDistance: 4,
    minWaterDistance: 4,
    billboard: {
      blobs: [
        [0.5, 0.7, 0.24],
        [0.32, 0.58, 0.16],
        [0.68, 0.58, 0.16],
      ],
      trunk: 0.4,
      trunkWidth: 0.036,
      leaf: C_MID,
      bark: srgb(102, 82, 62),
    },
  },
  {
    id: "snag",
    share: 0.12,
    weights: { badlands: 0.9, marsh: 0.4, pine: 0.16, highland: 0.14, heath: 0.1 },
    height: 6.8,
    trunkRadius: 0.3,
    lean: 0.34,
    branches: 3,
    branchAngle: 1.25,
    crownShells: 0,
    crownRadius: 1.4,
    crownFlatten: 1,
    crownRise: 0.5,
    conifer: false,
    leafless: true,
    bark: srgb(152, 140, 124),
    barkDark: srgb(62, 54, 46),
    leaf: srgb(120, 110, 96),
    leafShade: srgb(52, 46, 40),
    scale: [0.58, 1.2],
    maxSlope: 0.55,
    minHeight: WATER_LEVEL + 0.2,
    maxHeight: 130,
    clump: 2,
    clumpRadius: 9,
    minRoadDistance: 3.5,
    minWaterDistance: 0,
    billboard: {
      blobs: [],
      trunk: 0.96,
      trunkWidth: 0.03,
      leaf: srgb(120, 110, 96),
      bark: srgb(148, 136, 120),
    },
  },
];

type Anchor = { x: number; y: number; z: number; scale: number };

/**
 * The trunk and its branching, as one mesh.
 *
 * A stem, three or four primaries off it, and a secondary on each. That is not
 * many branches, but it is the whole difference between a canopy floating on a
 * pole and a canopy something is *holding up* — and once the leaf masses hang
 * off branch tips rather than stacking on the axis, the crown stops being
 * symmetrical, which is most of the rest of it.
 */
function buildTrunk(spec: TreeSpec, detail: boolean): {
  geometry: THREE.BufferGeometry;
  anchors: Anchor[];
} {
  const b = new MeshBuilder();
  const anchors: Anchor[] = [];
  const sides = detail ? 8 : 5;
  const bark = (t: number) =>
    mixRgb(spec.barkDark, spec.bark, clamp01(0.2 + t * 1.15));

  const steps = detail ? 6 : 3;
  const stem: THREE.Vector3[] = [];
  const radii: number[] = [];
  const leanX = Math.cos(spec.lean * 5.1) * spec.lean;
  const leanZ = Math.sin(spec.lean * 7.3) * spec.lean;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Root flare, with a hard falloff so the swell is confined to the bottom
    // half metre where a real one is. Spread up the trunk it just reads as a
    // fatter tree.
    const flare = Math.pow(1 - t, 7) * spec.trunkRadius * 1.6;
    radii.push(spec.trunkRadius * (1 - t * 0.74) + flare);
    stem.push(
      new THREE.Vector3(
        leanX * t * t * spec.height * 0.24,
        t * spec.height,
        leanZ * t * t * spec.height * 0.24
      )
    );
  }
  // A buried, splayed foot. The stem as built starts exactly at y = 0, which
  // is fine on a lawn and wrong on a hillside: across the width of a mature
  // trunk a one-in-two slope drops half a metre, so one side of the flare
  // hangs in the air. Sinking the first ring costs four triangles and is the
  // difference between a tree standing in the ground and standing on it.
  stem.unshift(new THREE.Vector3(0, -Math.max(0.35, spec.trunkRadius * 1.3), 0));
  radii.unshift(radii[0] * 1.3);

  addTube(b, stem, radii, sides, bark, 1);

  const tip = stem[steps];

  if (spec.conifer) {
    // Whorls up the stem, narrowing to a spire. On the detailed LOD each
    // whorl grows a few drooping spokes — that silhouette is what reads as
    // pine from the road, not stacked spheres alone.
    for (let i = 0; i < spec.crownShells; i++) {
      const t = i / Math.max(1, spec.crownShells - 1);
      const y = lerp(spec.height * spec.crownRise, spec.height * 1.02, t);
      const along = y / spec.height;
      const cx = leanX * along * along * spec.height * 0.24;
      const cz = leanZ * along * along * spec.height * 0.24;
      const whorlScale = Math.pow(1 - t, 0.92) * 0.95 + 0.08;
      const reach = spec.crownRadius * whorlScale;

      if (detail) {
        const spokes = 4 + (i % 2);
        for (let s = 0; s < spokes; s++) {
          const az =
            (s / spokes) * Math.PI * 2 + t * 1.85 + i * 0.55 + hash2(i, s) * 0.4;
          const len = reach * lerp(0.72, 0.98, hash2(i * 3 + s, 41));
          const droop = len * lerp(0.18, 0.34, hash2(i + s, 53));
          const from = new THREE.Vector3(cx, y, cz);
          const mid = new THREE.Vector3(
            cx + Math.cos(az) * len * 0.5,
            y - droop * 0.35,
            cz + Math.sin(az) * len * 0.5
          );
          const end = new THREE.Vector3(
            cx + Math.cos(az) * len,
            y - droop,
            cz + Math.sin(az) * len
          );
          const r0 = spec.trunkRadius * (0.2 - t * 0.1);
          addTube(
            b,
            [from, mid, end],
            [r0, r0 * 0.65, r0 * 0.2],
            4,
            bark,
            0.55
          );
        }
      }

      anchors.push({
        x: cx,
        y: y - reach * 0.06,
        z: cz,
        scale: whorlScale,
      });
    }
    anchors.push({
      x: tip.x,
      y: spec.height * 1.04,
      z: tip.z,
      scale: 0.12,
    });
    return { geometry: b.build(), anchors };
  }

  const crownBase = spec.height * spec.crownRise;
  for (let i = 0; i < spec.branches; i++) {
    const azimuth = (i / spec.branches) * Math.PI * 2 + hash2(i, 17) * 0.9;
    const rise = lerp(0.72, 1, hash2(i * 3, 29));
    const from = new THREE.Vector3(
      lerp(stem[0].x, tip.x, rise),
      lerp(crownBase * 0.84, spec.height * 0.96, hash2(i * 5, 31)),
      lerp(stem[0].z, tip.z, rise)
    );
    const length = spec.crownRadius * lerp(0.52, 0.94, hash2(i * 7, 37));
    const spreadX = Math.cos(azimuth) * Math.sin(spec.branchAngle);
    const spreadZ = Math.sin(azimuth) * Math.sin(spec.branchAngle);
    const up = Math.cos(spec.branchAngle);

    const mid = new THREE.Vector3(
      from.x + spreadX * length * 0.55,
      from.y + up * length * 0.62,
      from.z + spreadZ * length * 0.55
    );
    const end = new THREE.Vector3(
      from.x + spreadX * length,
      // Limbs turn upward as they reach out. A straight one reads as a spar.
      from.y + up * length * 0.62 + length * 0.32,
      from.z + spreadZ * length
    );

    const r0 = spec.trunkRadius * 0.44;
    if (detail) {
      addTube(b, [from, mid, end], [r0, r0 * 0.6, r0 * 0.22], 5, bark, 0.6);
      const side = new THREE.Vector3(
        mid.x + spreadZ * length * 0.38,
        mid.y + length * 0.42,
        mid.z - spreadX * length * 0.38
      );
      addTube(b, [mid, side], [r0 * 0.5, r0 * 0.16], 4, bark, 0.6);
      anchors.push({ x: side.x, y: side.y, z: side.z, scale: 0.6 });
    } else {
      addTube(b, [from, end], [r0, r0 * 0.24], 4, bark, 0.6);
    }

    anchors.push({ x: end.x, y: end.y, z: end.z, scale: 0.9 });
  }

  // Two masses over the middle, or the crown comes out a ring of pompoms with
  // daylight through the centre of it.
  anchors.push({
    x: tip.x * 0.7,
    y: lerp(crownBase, spec.height, 0.86),
    z: tip.z * 0.7,
    scale: 1,
  });
  anchors.push({
    x: tip.x * 0.4 + spec.crownRadius * 0.18,
    y: lerp(crownBase, spec.height, 0.52),
    z: tip.z * 0.4 - spec.crownRadius * 0.2,
    scale: 0.76,
  });

  return { geometry: b.build(), anchors };
}

function buildCanopy(
  spec: TreeSpec,
  anchors: Anchor[],
  detail: boolean
): THREE.BufferGeometry | null {
  if (spec.leafless || spec.crownShells === 0 || anchors.length === 0) return null;

  const b = new MeshBuilder();
  const subdivisions = detail ? 1 : 0;
  const crownBottom = spec.height * spec.crownRise * 0.75;
  const crownTop = spec.height * 1.14;

  if (spec.conifer) {
    // Flat needle whorls + a pinched tip. Round shells stacked on the axis
    // read as lollipops; these read as firs.
    const wanted = detail
      ? Math.min(anchors.length, spec.crownShells + 1)
      : Math.min(4, anchors.length);
    for (let i = 0; i < wanted; i++) {
      const anchor =
        anchors[Math.floor((i * anchors.length) / wanted) % anchors.length];
      const t = i / Math.max(1, wanted - 1);
      const bulk = detail ? 1 : 1.35;
      const radius = spec.crownRadius * anchor.scale * 0.92 * bulk;
      const flat = lerp(0.16, 0.28, t);
      const tip = i >= wanted - 1;
      addShell(b, {
        cx: anchor.x + (hash2(i, 11) - 0.5) * radius * 0.08,
        cy: anchor.y,
        cz: anchor.z + (hash2(i, 19) - 0.5) * radius * 0.08,
        rx: tip ? radius * 0.55 : radius,
        ry: tip ? radius * 0.7 : radius * flat,
        rz: tip ? radius * 0.55 : radius * lerp(0.88, 1.05, hash2(i, 29)),
        seed: i * 37 + Math.round(spec.height * 13),
        subdivisions,
        lumpiness: tip ? 0.28 : 0.38,
        lit: spec.leaf,
        shaded: spec.leafShade,
        crownBottom,
        crownTop,
        crownRadius: spec.crownRadius,
        uvScale: 0.7,
        droop: tip ? 0.15 : 0.55,
        tipPinch: tip ? 0.75 : 0.35,
      });
    }
    return b.build();
  }

  const wanted = detail ? spec.crownShells : Math.min(4, spec.crownShells);
  for (let i = 0; i < wanted; i++) {
    // Spread evenly through the anchor list, so a reduced crown still spans the
    // whole tree instead of clustering on the first few branches.
    const anchor =
      anchors[Math.floor((i * anchors.length) / wanted) % anchors.length];
    const bulk = detail ? 1 : 1.45;
    const radius = spec.crownRadius * anchor.scale * 0.62 * bulk;
    const oval = lerp(0.82, 1.12, hash2(i * 5, 61));

    addShell(b, {
      cx: anchor.x + (hash2(i, 71) - 0.5) * radius * 0.18,
      cy: anchor.y + (hash2(i, 83) - 0.5) * radius * 0.12,
      cz: anchor.z + (hash2(i, 97) - 0.5) * radius * 0.18,
      rx: radius * oval,
      ry: radius * spec.crownFlatten * lerp(0.9, 1.15, hash2(i, 103)),
      rz: radius / oval,
      seed: i * 37 + Math.round(spec.height * 13),
      subdivisions,
      lumpiness: detail ? 0.52 : 0.4,
      lit: spec.leaf,
      shaded: spec.leafShade,
      crownBottom,
      crownTop,
      crownRadius: spec.crownRadius,
      uvScale: 0.62,
      droop: spec.id === "willow" ? 0.7 : 0.18,
      tipPinch: 0.12,
    });
  }

  return b.build();
}

// ---------------------------------------------------------------------------
// Undergrowth
// ---------------------------------------------------------------------------

type PlantSpec = {
  id: string;
  share: number;
  weights: Partial<Record<BiomeId, number>>;
  scale: [number, number];
  maxSlope: number;
  minHeight: number;
  maxHeight: number;
  clump: number;
  clumpRadius: number;
  minRoadDistance: number;
  minWaterDistance: number;
  /** Ground plants lean into the hill far more than trees do. */
  lean: number;
  /** Which wind material it uses. */
  sway: "high" | "low";
  build: (detail: boolean) => THREE.BufferGeometry;
};

function bushGeometry(options: {
  shells: number;
  radius: number;
  flatten: number;
  stems: number;
  lit: Rgb;
  shaded: Rgb;
  bark: Rgb;
  seed: number;
  detail: boolean;
}): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const subdivisions = options.detail ? 1 : 0;

  if (options.detail && options.stems > 0) {
    for (let i = 0; i < options.stems; i++) {
      const azimuth = (i / options.stems) * Math.PI * 2;
      const reach = options.radius * 0.5;
      addTube(
        b,
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(
            Math.cos(azimuth) * reach,
            options.radius * 0.95,
            Math.sin(azimuth) * reach
          ),
        ],
        [options.radius * 0.1, options.radius * 0.03],
        4,
        () => options.bark,
        0.5
      );
    }
  }

  const shells = options.detail ? options.shells : Math.max(1, options.shells - 1);
  for (let i = 0; i < shells; i++) {
    const azimuth = i * 2.39996 + 0.7;
    const spread = i === 0 ? 0 : options.radius * 0.44;
    const radius =
      options.radius * (i === 0 ? 0.88 : 0.64) * (options.detail ? 1 : 1.32);
    addShell(b, {
      cx: Math.cos(azimuth) * spread,
      cy: options.radius * (0.6 + (i % 2) * 0.24),
      cz: Math.sin(azimuth) * spread,
      rx: radius,
      ry: radius * options.flatten,
      rz: radius,
      seed: options.seed + i * 19,
      subdivisions,
      lumpiness: 0.55,
      lit: options.lit,
      shaded: options.shaded,
      crownBottom: 0,
      crownTop: options.radius * 1.6,
      crownRadius: options.radius,
      uvScale: 1.3,
    });
  }

  return b.build();
}

const SHRUBS: PlantSpec[] = [
  {
    id: "hazel",
    share: 0.3,
    weights: { broadleaf: 1, orchard: 0.34, meadow: 0.22, pine: 0.18, marsh: 0.14 },
    scale: [0.7, 1.5],
    maxSlope: 0.5,
    minHeight: WATER_LEVEL + 0.7,
    maxHeight: TREE_LINE,
    clump: 3,
    clumpRadius: 3.4,
    minRoadDistance: 3.4,
    minWaterDistance: 1.5,
    lean: 0.4,
    sway: "low",
    build: (detail) =>
      bushGeometry({
        shells: 4,
        radius: 1.15,
        flatten: 0.82,
        stems: 4,
        lit: srgb(96, 124, 54),
        shaded: srgb(22, 34, 16),
        bark: srgb(84, 68, 52),
        seed: 41,
        detail,
      }),
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
    scale: [0.6, 1.35],
    maxSlope: 0.62,
    minHeight: WATER_LEVEL + 0.7,
    maxHeight: TREE_LINE + 12,
    clump: 4,
    clumpRadius: 2.8,
    minRoadDistance: 3,
    minWaterDistance: 2,
    lean: 0.55,
    sway: "low",
    build: (detail) =>
      bushGeometry({
        shells: 3,
        radius: 0.78,
        flatten: 0.6,
        stems: 3,
        lit: srgb(122, 128, 58),
        shaded: srgb(36, 42, 20),
        bark: srgb(70, 62, 44),
        seed: 77,
        detail,
      }),
  },
  {
    id: "reedbed",
    share: 0.22,
    weights: { marsh: 1, shore: 0.55 },
    scale: [0.72, 1.5],
    maxSlope: 0.2,
    // Reeds stand in the shallows, so they are allowed below the waterline —
    // the only species in the valley that is.
    minHeight: WATER_LEVEL - 0.5,
    maxHeight: 12,
    clump: 5,
    clumpRadius: 2.2,
    minRoadDistance: 2.6,
    minWaterDistance: -3,
    lean: 0.15,
    sway: "high",
    build: (detail) =>
      bladeTuft({
        blades: detail ? 15 : 7,
        height: 1.75,
        halfWidth: 0.022,
        segments: detail ? 3 : 2,
        lean: 0.2,
        spread: 0.12,
        base: srgb(84, 92, 52),
        tip: srgb(170, 158, 100),
        seed: 311,
      }),
  },
  {
    id: "deadscrub",
    share: 0.16,
    weights: { badlands: 1, highland: 0.34, heath: 0.24, marsh: 0.14 },
    scale: [0.6, 1.3],
    maxSlope: 0.7,
    minHeight: WATER_LEVEL + 0.4,
    maxHeight: 140,
    clump: 3,
    clumpRadius: 4,
    minRoadDistance: 2.6,
    minWaterDistance: 1,
    lean: 0.5,
    sway: "low",
    build: (detail) => {
      const b = new MeshBuilder();
      const twigs = detail ? 7 : 4;
      const pale = srgb(136, 122, 102);
      const dark = srgb(56, 48, 40);
      for (let i = 0; i < twigs; i++) {
        const azimuth = i * 2.39996;
        const reach = 0.34 + hash2(i, 5) * 0.4;
        const rise = 0.5 + hash2(i * 3, 11) * 0.5;
        addTube(
          b,
          [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(
              Math.cos(azimuth) * reach * 0.5,
              rise * 0.55,
              Math.sin(azimuth) * reach * 0.5
            ),
            new THREE.Vector3(
              Math.cos(azimuth) * reach,
              rise,
              Math.sin(azimuth) * reach
            ),
          ],
          [0.05, 0.03, 0.012],
          4,
          (t) => mixRgb(dark, pale, clamp01(0.3 + t)),
          0.4
        );
      }
      return b.build();
    },
  },
];

const COVER: PlantSpec[] = [
  {
    // Dense roadside sward — the proven InstancedMesh + decorateFlora wind path,
    // so even if the GPU meadow misbehaves the bard still walks through moving
    // grass. Planted hard against the verge where the camera lives.
    id: "sward",
    share: 0.72,
    weights: {
      meadow: 1,
      orchard: 0.95,
      farmland: 0.9,
      broadleaf: 0.85,
      shore: 0.6,
      pine: 0.55,
      heath: 0.45,
      marsh: 0.32,
    },
    scale: [0.95, 1.7],
    maxSlope: 0.62,
    minHeight: WATER_LEVEL + 0.15,
    maxHeight: TREE_LINE + 14,
    // Smaller clumps, tighter packing — fills gaps the GPU meadow thins.
    clump: 6,
    clumpRadius: 1.15,
    minRoadDistance: 1.05,
    minWaterDistance: 0.35,
    lean: 0.45,
    sway: "high",
    build: (detail) =>
      bladeTuft({
        blades: detail ? 22 : 12,
        height: 0.92,
        halfWidth: 0.02,
        segments: detail ? 4 : 3,
        lean: 0.78,
        spread: 0.17,
        base: G_BASE,
        tip: G_TIP,
        seed: 4242,
      }),
  },
  {
    id: "heather",
    share: 0.14,
    weights: { heath: 1, highland: 0.42, pine: 0.14, marsh: 0.1 },
    scale: [0.7, 1.5],
    maxSlope: 0.62,
    minHeight: WATER_LEVEL + 0.6,
    maxHeight: TREE_LINE + 20,
    clump: 7,
    clumpRadius: 1.5,
    minRoadDistance: 2.4,
    minWaterDistance: 1.5,
    lean: 0.7,
    sway: "low",
    build: (detail) =>
      bushGeometry({
        shells: detail ? 3 : 1,
        radius: 0.3,
        flatten: 0.5,
        stems: 0,
        lit: srgb(150, 108, 132),
        shaded: srgb(44, 34, 42),
        bark: srgb(70, 56, 44),
        seed: 613,
        detail,
      }),
  },
  {
    id: "sedge",
    share: 0.12,
    weights: { marsh: 1, shore: 0.6, meadow: 0.08 },
    scale: [0.7, 1.4],
    maxSlope: 0.3,
    minHeight: WATER_LEVEL - 0.2,
    maxHeight: 14,
    clump: 6,
    clumpRadius: 1.6,
    minRoadDistance: 2.2,
    minWaterDistance: -2,
    lean: 0.4,
    sway: "high",
    build: (detail) =>
      bladeTuft({
        blades: detail ? 11 : 5,
        height: 0.72,
        halfWidth: 0.016,
        segments: detail ? 3 : 2,
        lean: 0.62,
        spread: 0.08,
        base: srgb(74, 88, 48),
        tip: srgb(148, 146, 84),
        seed: 907,
      }),
  },
  {
    id: "crop",
    share: 0.21,
    weights: { farmland: 1 },
    scale: [0.86, 1.1],
    maxSlope: 0.2,
    minHeight: WATER_LEVEL + 1.2,
    maxHeight: 40,
    clump: 9,
    clumpRadius: 1.1,
    minRoadDistance: 3.2,
    minWaterDistance: 4,
    // Crops stand up straight whatever the field's camber. They were planted,
    // not blown in.
    lean: 0.12,
    sway: "high",
    build: (detail) =>
      bladeTuft({
        blades: detail ? 12 : 6,
        height: 0.86,
        halfWidth: 0.014,
        segments: detail ? 3 : 2,
        lean: 0.16,
        spread: 0.06,
        base: srgb(128, 128, 62),
        tip: srgb(208, 186, 110),
        seed: 1201,
      }),
  },
  {
    id: "marram",
    share: 0.11,
    weights: { shore: 1, meadow: 0.06 },
    scale: [0.7, 1.35],
    maxSlope: 0.34,
    minHeight: WATER_LEVEL + 0.15,
    maxHeight: 12,
    clump: 6,
    clumpRadius: 1.7,
    minRoadDistance: 2.2,
    minWaterDistance: 0.5,
    lean: 0.55,
    sway: "high",
    build: (detail) =>
      bladeTuft({
        blades: detail ? 12 : 6,
        height: 0.6,
        halfWidth: 0.014,
        segments: detail ? 3 : 2,
        lean: 0.8,
        spread: 0.1,
        base: srgb(104, 118, 78),
        tip: srgb(180, 178, 136),
        seed: 1499,
      }),
  },
  {
    id: "wildflower",
    share: 0.15,
    weights: { meadow: 1, orchard: 0.55, farmland: 0.26, broadleaf: 0.2, shore: 0.14 },
    scale: [0.7, 1.3],
    maxSlope: 0.42,
    minHeight: WATER_LEVEL + 0.7,
    maxHeight: 40,
    clump: 5,
    clumpRadius: 1.3,
    minRoadDistance: 2,
    minWaterDistance: 1.5,
    lean: 0.5,
    sway: "high",
    build: (detail) => {
      const b = new MeshBuilder();
      const stem = srgb(98, 120, 58);
      const petal = srgb(228, 216, 134);
      const blades = detail ? 7 : 4;
      for (let i = 0; i < blades; i++) {
        addBlade(
          b,
          i * 2.39996,
          0.55,
          0.3 + hash2(i, 3) * 0.14,
          0.011,
          2,
          srgb(70, 88, 44),
          stem,
          0.05
        );
      }
      if (detail) {
        // Three flat heads, which is all a flower needs to be at the distance
        // anything shorter than a shrub is ever seen from.
        for (let i = 0; i < 3; i++) {
          const yaw = i * 2.1 + 0.4;
          const r = 0.05;
          const cx = Math.cos(yaw) * 0.07;
          const cz = Math.sin(yaw) * 0.07;
          const y = 0.33 + hash2(i * 11, 7) * 0.08;
          const a = b.vertex(cx - r, y, cz - r, 0, 1, 0, 0, 0, petal);
          const c = b.vertex(cx + r, y, cz - r, 0, 1, 0, 1, 0, petal);
          const d = b.vertex(cx + r, y, cz + r, 0, 1, 0, 1, 1, petal);
          const e = b.vertex(cx - r, y, cz + r, 0, 1, 0, 0, 1, petal);
          b.quad(a, c, d, e);
        }
      }
      return b.build();
    },
  },
  {
    id: "tussock",
    share: 0.14,
    weights: { highland: 1, heath: 0.62, pine: 0.32, badlands: 0.16, meadow: 0.1 },
    scale: [0.66, 1.4],
    maxSlope: 0.68,
    minHeight: WATER_LEVEL + 0.6,
    maxHeight: 160,
    clump: 5,
    clumpRadius: 2,
    minRoadDistance: 2.4,
    minWaterDistance: 1.5,
    lean: 0.6,
    sway: "high",
    build: (detail) =>
      bladeTuft({
        blades: detail ? 14 : 6,
        height: 0.4,
        halfWidth: 0.014,
        segments: detail ? 2 : 1,
        lean: 0.95,
        spread: 0.1,
        base: srgb(88, 92, 58),
        tip: srgb(164, 152, 100),
        seed: 1777,
      }),
  },
];

/** Bracken. On its own budget field, because callers still pass one. */
const BRACKEN: PlantSpec = {
  id: "bracken",
  share: 1,
  weights: { broadleaf: 1, pine: 0.5, meadow: 0.4, orchard: 0.34, marsh: 0.2 },
  scale: [0.66, 1.4],
  maxSlope: 0.48,
  minHeight: WATER_LEVEL + 0.6,
  maxHeight: TREE_LINE,
  clump: 4,
  clumpRadius: 1.9,
  minRoadDistance: 2.4,
  minWaterDistance: 1.5,
  lean: 0.55,
  sway: "high",
  build: (detail) => {
    const b = new MeshBuilder();
    const fronds = detail ? 8 : 4;
    const stalk = srgb(72, 88, 42);
    const frond = srgb(104, 130, 56);
    for (let i = 0; i < fronds; i++) {
      addBlade(b, i * 2.39996, 1.05, 0.52, 0.055, detail ? 3 : 2, stalk, frond, 0.04);
    }
    return b.build();
  },
};

// ---------------------------------------------------------------------------
// Rocks
// ---------------------------------------------------------------------------

/** A boulder: an icosphere pushed around by noise until it stops being a ball. */
function rockGeometry(seed: number, detail: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder();
  addShell(b, {
    cx: 0,
    // Sunk, not balanced on the surface. A boulder that sits exactly on the
    // ground plane reads as a prop dropped there, which is what it is.
    cy: 0.2,
    cz: 0,
    rx: 1,
    ry: 0.66,
    rz: 0.86,
    seed,
    subdivisions: detail ? 1 : 0,
    // Far more than foliage gets. A boulder wants faces and edges, not lumps.
    lumpiness: 0.85,
    // Lichen on the top and in the light, wet shadow underneath.
    lit: srgb(154, 150, 138),
    shaded: srgb(54, 54, 50),
    crownBottom: -0.9,
    crownTop: 0.9,
    crownRadius: 1.4,
    uvScale: 0.5,
  });
  return b.build();
}

const ROCK_WEIGHTS: Partial<Record<BiomeId, number>> = {
  highland: 1,
  badlands: 0.9,
  heath: 0.5,
  pine: 0.35,
  shore: 0.32,
  broadleaf: 0.14,
  meadow: 0.12,
  farmland: 0.05,
};

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

type Placement = {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
};

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
  /** Negative allows placement out into the shallows — reeds want that. */
  minWaterDistance: number;
  scale: [number, number];
  lean: number;
};

function distanceToWater(x: number, z: number): number {
  let best = Infinity;
  for (const water of WATERS) {
    const gap = Math.hypot(x - water.x, z - water.z) - water.radius;
    if (gap < best) best = gap;
  }
  return best;
}

type GroundSample = { y: number; dydx: number; dydz: number; slope: number };
const groundScratch: GroundSample = { y: 0, dydx: 0, dydz: 0, slope: 0 };

/**
 * The ground under a clump, sampled once for the whole clump.
 *
 * Everything expensive about placement is `heightAt`, and a fifteen-blade tuft
 * spread over a metre and a half does not need fifteen independent opinions
 * about where the ground is. It needs one, plus the local gradient, which these
 * same three samples already give — and that is the difference between a
 * hundred thousand plants costing half a second and costing fifty milliseconds.
 */
function sampleGround(x: number, z: number, out: GroundSample) {
  const y = heightAt(x, z);
  const step = 1.2;
  out.y = y;
  out.dydx = (heightAt(x + step, z) - y) / step;
  out.dydz = (heightAt(x, z + step) - y) / step;
  const gradient = Math.hypot(out.dydx, out.dydz);
  // Expressed the way `slopeAt` expresses it — one minus the normal's Y — so
  // the thresholds in the species tables mean what they mean in terrain.ts.
  out.slope = 1 - 1 / Math.sqrt(1 + gradient * gradient);
}

function placeClump(
  results: Placement[],
  cx: number,
  cz: number,
  options: ScatterOptions,
  index: number
) {
  sampleGround(cx, cz, groundScratch);
  if (groundScratch.slope > options.maxSlope) return;
  if (groundScratch.y < options.minHeight) return;
  if (groundScratch.y > options.maxHeight) return;
  if (distanceToRoad(cx, cz) < options.minRoadDistance) return;
  if (distanceToWater(cx, cz) < options.minWaterDistance) return;

  for (let k = 0; k < options.clump; k++) {
    const key = index * 31 + k;
    const angle = hash2(options.seed + key * 3, key) * Math.PI * 2;
    // sqrt, or every clump comes out with a bullseye in the middle of it.
    const radius = Math.sqrt(hash2(key * 5, options.seed + key)) * options.clumpRadius;
    const ox = Math.cos(angle) * radius;
    const oz = Math.sin(angle) * radius;

    results.push({
      x: cx + ox,
      // The clump's own gradient carries each member to its own height. Sink a
      // touch so plants meet the drawn LOD mesh (which sits below heightAt
      // between vertices) instead of hovering a centimetre above it.
      y:
        groundScratch.y +
        groundScratch.dydx * ox +
        groundScratch.dydz * oz -
        0.025,
      z: cz + oz,
      scale: lerp(
        options.scale[0],
        options.scale[1],
        hash2(options.seed * 7 + key, key * 17)
      ),
      yaw: hash2(key, options.seed * 19 + key) * Math.PI * 2,
      // Leaned into the hill. Trees stand nearly upright on a slope and low
      // cover lies almost flat along it, which is what `lean` dials between.
      tiltX: -groundScratch.dydz * options.lean,
      tiltZ: groundScratch.dydx * options.lean,
    });
  }
}

/**
 * Scatters a species across the valley in proportion to where it grows.
 *
 * A jittered grid rather than rejection sampling, and the biome lottery is
 * decided *before* the ground is touched — so the only candidates that pay for
 * a `heightAt` are the ones already destined to become a plant. Rejection
 * sampling a 640-metre world at these densities would spend nine tenths of its
 * time rediscovering that the fen is not a pine forest.
 *
 * The two passes are what land the count on target. The first measures how much
 * of the world actually suits the species; the second sets the acceptance rate
 * from that. Without it a species confined to one region either comes out empty
 * or floods the map, depending entirely on how big its region happens to be.
 */
function scatterBiome(options: ScatterOptions): Placement[] {
  const clumps = Math.max(1, Math.ceil(options.count / options.clump));
  // Three and a half candidate cells per wanted clump. It can be this low only
  // because a cell may place more than one clump — see below.
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

      // A cell may owe more than one clump, and it has to be able to pay.
      //
      // A single accept-or-reject lottery silently caps every cell at one, which
      // is invisible for a species spread over the whole valley and ruinous for
      // one that isn't: barley grows in Barleyhearth and nowhere else, so its
      // whole budget is owed by seven percent of the cells, and a one-per-cell
      // lottery delivered two fifths of a crop. The whole part is placed
      // outright and only the remainder goes to the coin toss.
      const whole = Math.min(8, Math.floor(chance));
      const extra =
        hash2(options.seed * 13 + index, index * 7 + options.seed) < chance - whole
          ? 1
          : 0;

      for (let rep = 0; rep < whole + extra; rep++) {
        const key = index * 9 + rep;
        const jx = hash2(options.seed + key, key * 3) - 0.5;
        const jz = hash2(key * 11, options.seed * 5 + key) - 0.5;
        placeClump(
          results,
          -half + (i + 0.5 + jx * 0.92) * step,
          -half + (j + 0.5 + jz * 0.92) * step,
          options,
          key
        );
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Instance fields
// ---------------------------------------------------------------------------

const CELL_SIZE = 32;
const CELLS = Math.ceil(WORLD_SIZE / CELL_SIZE) + 2;

type Bucket = {
  array: Float32Array;
  attribute: THREE.InstancedBufferAttribute;
  capacity: number;
  count: number;
  meshes: THREE.InstancedMesh[];
};

/**
 * A population of one species, kept sorted into level-of-detail buckets.
 *
 * This is the machine that makes a forested 640-metre valley possible. The
 * matrices are composed once at load and never again; every frame's work is a
 * distance test and a sixteen-float copy, and even that is skipped for the
 * cells behind the camera. What the GPU sees is a few hundred detailed plants
 * and a few thousand cards, regardless of whether the population behind them is
 * five hundred or seventy thousand.
 *
 * Instances are grouped into 32-metre cells and the cells are visited nearest
 * first, so when a bucket does run out of room it drops the furthest instances
 * — the ones nobody can miss.
 */
class InstanceField {
  private matrices: Float32Array;
  private cellStart: Int32Array;
  private cellSphere: Float32Array;
  private cellOrder: Int32Array;
  private cellDistance: Float32Array;
  private buckets: Bucket[] = [];
  private scratchSphere = new THREE.Sphere();

  readonly total: number;

  constructor(items: Placement[], extent: number) {
    this.total = items.length;

    // Bucket by cell, then rewrite the population in cell order, so a cell's
    // instances are one contiguous run and the per-frame scan is sequential.
    const counts = new Int32Array(CELLS * CELLS);
    const cellOf = new Int32Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const cell = cellIndexAt(items[i].x, items[i].z);
      cellOf[i] = cell;
      counts[cell]++;
    }

    this.cellStart = new Int32Array(CELLS * CELLS + 1);
    for (let c = 0; c < CELLS * CELLS; c++) {
      this.cellStart[c + 1] = this.cellStart[c] + counts[c];
    }

    const cursor = Int32Array.from(this.cellStart.subarray(0, CELLS * CELLS));
    this.matrices = new Float32Array(Math.max(1, items.length) * 16);

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const slot = cursor[cellOf[i]]++;
      position.set(item.x, item.y, item.z);
      euler.set(item.tiltX, item.yaw, item.tiltZ);
      quaternion.setFromEuler(euler);
      scale.setScalar(item.scale);
      matrix.compose(position, quaternion, scale);
      matrix.toArray(this.matrices, slot * 16);
    }

    // One sphere per cell, sized from what actually landed in it. Cells are the
    // unit of frustum culling, so a sphere that is merely conservative costs
    // real instances on every frame.
    this.cellSphere = new Float32Array(CELLS * CELLS * 4);
    for (let c = 0; c < CELLS * CELLS; c++) {
      const from = this.cellStart[c];
      const to = this.cellStart[c + 1];
      if (from === to) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = from; i < to; i++) {
        const x = this.matrices[i * 16 + 12];
        const y = this.matrices[i * 16 + 13];
        const z = this.matrices[i * 16 + 14];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      this.cellSphere[c * 4] = (minX + maxX) * 0.5;
      this.cellSphere[c * 4 + 1] = (minY + maxY) * 0.5 + extent * 0.5;
      this.cellSphere[c * 4 + 2] = (minZ + maxZ) * 0.5;
      this.cellSphere[c * 4 + 3] =
        Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5 + extent;
    }

    this.cellOrder = new Int32Array(CELLS * CELLS);
    this.cellDistance = new Float32Array(CELLS * CELLS);
  }

  /** Adds a level. Meshes at the same level share one instance buffer. */
  addLevel(capacity: number, meshes: THREE.InstancedMesh[]): void {
    const array = new Float32Array(Math.max(1, capacity) * 16);
    const attribute = new THREE.InstancedBufferAttribute(array, 16);
    attribute.setUsage(THREE.DynamicDrawUsage);
    for (const mesh of meshes) {
      mesh.instanceMatrix = attribute;
      mesh.count = 0;
      mesh.visible = false;
      // Culling happens here, per cell, against real bounds. three's own test
      // would use the whole population's bounding sphere, which for a species
      // spread across the valley is the whole valley.
      mesh.frustumCulled = false;
    }
    this.buckets.push({
      array,
      attribute,
      capacity: Math.max(1, capacity),
      count: 0,
      meshes,
    });
  }

  /**
   * @param always Instances inside this radius skip the frustum test. A tree
   *   behind the camera still casts a shadow into the shot, and culling it
   *   makes shadows wink in and out as the view turns.
   */
  update(
    frustum: THREE.Frustum,
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    thresholds: number[],
    maxDistance: number,
    always: number
  ): void {
    for (const bucket of this.buckets) bucket.count = 0;
    if (this.total === 0) return;

    const half = WORLD_SIZE / 2;
    const reach = maxDistance + CELL_SIZE;
    const minI = Math.max(0, Math.floor((cameraX - reach + half) / CELL_SIZE));
    const maxI = Math.min(CELLS - 1, Math.ceil((cameraX + reach + half) / CELL_SIZE));
    const minJ = Math.max(0, Math.floor((cameraZ - reach + half) / CELL_SIZE));
    const maxJ = Math.min(CELLS - 1, Math.ceil((cameraZ + reach + half) / CELL_SIZE));

    let candidates = 0;
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const cell = j * CELLS + i;
        if (this.cellStart[cell] === this.cellStart[cell + 1]) continue;
        const dx = this.cellSphere[cell * 4] - cameraX;
        const dz = this.cellSphere[cell * 4 + 2] - cameraZ;
        const distance = Math.hypot(dx, dz);
        if (distance - this.cellSphere[cell * 4 + 3] > maxDistance) continue;
        this.cellOrder[candidates++] = cell;
        this.cellDistance[cell] = distance;
      }
    }

    const order = this.cellOrder.subarray(0, candidates);
    order.sort((a, b) => this.cellDistance[a] - this.cellDistance[b]);

    const maxDistanceSq = maxDistance * maxDistance;

    for (let k = 0; k < candidates; k++) {
      const cell = order[k];
      const cellRadius = this.cellSphere[cell * 4 + 3];
      // The exemption is measured to the cell *centre*, not to its near edge.
      // Adding the radius sounds safer and is the opposite: a cell's sphere is
      // thirty metres across once the canopy is in it, so the exemption would
      // reach twice as far as intended and fill the near bucket with the whole
      // wood behind the camera.
      if (this.cellDistance[cell] > always) {
        this.scratchSphere.center.set(
          this.cellSphere[cell * 4],
          this.cellSphere[cell * 4 + 1],
          this.cellSphere[cell * 4 + 2]
        );
        // A margin, because this runs every third frame and a fast pan would
        // otherwise reach ground that has not been filled in yet.
        this.scratchSphere.radius = cellRadius * 1.3;
        if (!frustum.intersectsSphere(this.scratchSphere)) continue;
      }

      const from = this.cellStart[cell];
      const to = this.cellStart[cell + 1];
      for (let i = from; i < to; i++) {
        const base = i * 16;
        const dx = this.matrices[base + 12] - cameraX;
        const dy = this.matrices[base + 13] - cameraY;
        const dz = this.matrices[base + 14] - cameraZ;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxDistanceSq) continue;

        let level = thresholds.length;
        for (let t = 0; t < thresholds.length; t++) {
          if (d2 < thresholds[t] * thresholds[t]) {
            level = t;
            break;
          }
        }
        if (level >= this.buckets.length) continue;

        const bucket = this.buckets[level];
        if (bucket.count >= bucket.capacity) continue;
        bucket.array.set(this.matrices.subarray(base, base + 16), bucket.count * 16);
        bucket.count++;
      }
    }

    for (const bucket of this.buckets) {
      bucket.attribute.clearUpdateRanges();
      // Only the slice actually in use is uploaded. Without this three sends
      // the whole capacity every time, which for the grass buckets is close to
      // a megabyte of nothing several times a second.
      if (bucket.count > 0) bucket.attribute.addUpdateRange(0, bucket.count * 16);
      bucket.attribute.needsUpdate = true;
      for (const mesh of bucket.meshes) {
        mesh.count = bucket.count;
        mesh.visible = bucket.count > 0;
      }
    }
  }
}

function cellIndexAt(x: number, z: number) {
  const half = WORLD_SIZE / 2;
  let i = Math.floor((x + half) / CELL_SIZE) + 1;
  let j = Math.floor((z + half) / CELL_SIZE) + 1;
  i = i < 0 ? 0 : i >= CELLS ? CELLS - 1 : i;
  j = j < 0 ? 0 : j >= CELLS ? CELLS - 1 : j;
  return j * CELLS + i;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

type WindClock = { current: { uTime: { value: number } } };

type FloraMaterialOptions = {
  /** Height over which the sway ramps from nothing at the root to full. */
  height: number;
  strength: number;
  speed: number;
  /** Per-instance colour spread, as a fraction either side of the base. */
  tint: number;
  /**
   * `grass` — tip flash for blades/scrub.
   * `tree` — slow trunk/canopy bend with layered secondary flutter.
   */
  kind?: "grass" | "tree";
};

/**
 * Wind, and per-instance colour, injected into a standard material.
 *
 * Wind on the GPU is the only way tens of thousands of blades can move at all —
 * the CPU cannot touch that many vertices a frame. The displacement is weighted
 * by height so the base of a blade stays planted and only the tip travels, and
 * a slow low-frequency gust rolls across the whole valley so the motion reads
 * as weather rather than vibration.
 *
 * The tint is here rather than in an `instanceColor` buffer on purpose. The
 * instance matrices are repacked several times a second by the LOD partition,
 * so a colour buffer would have to be repacked and re-uploaded alongside them —
 * twelve more bytes per instance per update, for something six arithmetic
 * instructions can derive from a position the shader already has in hand.
 */
function decorateFlora(
  material: THREE.Material,
  clock: WindClock,
  options: FloraMaterialOptions,
  cacheKey: string
) {
  material.onBeforeCompile = (shader) => {
    // Read the clock here, not at call time: `onBeforeCompile` runs when the
    // material first reaches the GPU, by which point the ref is populated.
    shader.uniforms.uTime = clock.current.uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;`
      )
      .replace(
        "#include <color_vertex>",
        `#include <color_vertex>
         #if defined( USE_INSTANCING ) && defined( USE_COLOR )
           vec3 floraOrigin = instanceMatrix[ 3 ].xyz;
           float floraHashA = fract( sin( dot( floraOrigin.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
           float floraHashB = fract( sin( dot( floraOrigin.zx, vec2( 39.3468, 11.1357 ) ) ) * 24634.6345 );
           vColor.rgb *= vec3(
             1.0 + ( floraHashA - 0.5 ) * ${options.tint.toFixed(3)},
             1.0 + ( floraHashB - 0.5 ) * ${(options.tint * 1.15).toFixed(3)},
             1.0 + ( floraHashA - 0.5 ) * ${(options.tint * 0.7).toFixed(3)}
           );
         #endif`
      )
      .replace(
        "#include <begin_vertex>",
        options.kind === "tree"
          ? `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 windOrigin = instanceMatrix[ 3 ].xyz;
         #else
           vec3 windOrigin = vec3( 0.0 );
         #endif
         float windUp = clamp( position.y / ${options.height.toFixed(3)}, 0.0, 1.0 );
         // Roots stay planted; bend gathers in the upper crown (power curve).
         float windFalloff = windUp * windUp * windUp * ( 0.25 + 0.75 * windUp );
         float loc = windOrigin.x * 0.045 + windOrigin.z * 0.038;
         // Slow prevailing lean — whole tree bows with the weather.
         float primary = sin( uTime * ${ (options.speed * 0.55).toFixed(3) } + loc )
           + sin( uTime * ${ (options.speed * 0.23).toFixed(3) } + loc * 1.7 ) * 0.55;
         // Mid-frequency canopy roll.
         float secondary = sin( uTime * ${ (options.speed * 1.35).toFixed(3) }
           + loc * 3.1 + position.y * 0.35 ) * 0.35;
         // Tip flutter — only high in the crown, never the trunk.
         float flutter = sin( uTime * ${ (options.speed * 3.4).toFixed(3) }
           + loc * 8.0 + position.x * 1.7 + position.z * 1.3 ) * 0.18 * windUp * windUp;
         float gust = sin( uTime * 0.19 + windOrigin.x * 0.02 + windOrigin.z * 0.017 ) * 0.5 + 0.5;
         float bend = ( primary * ( 0.45 + gust * 0.55 ) + secondary + flutter )
           * windFalloff * ${options.strength.toFixed(3)};
         // Consistent wind quarter so trees lean together, not randomly.
         transformed.x += bend * 0.85;
         transformed.z += bend * 0.55;
         // Slight settle as the crown bows — reads as mass, not rubber.
         transformed.y -= abs( bend ) * 0.12;
        `
          : `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 windOrigin = instanceMatrix[ 3 ].xyz;
         #else
           vec3 windOrigin = vec3( 0.0 );
         #endif
         float windUp = clamp( position.y / ${options.height.toFixed(3)}, 0.0, 1.0 );
         float windPhase = uTime * ${options.speed.toFixed(3)}
           + windOrigin.x * 0.42 + windOrigin.z * 0.31;
         // Gust front rolling across the valley (CodePen §5 wind feel).
         float gust = sin( uTime * 0.27 + windOrigin.x * 0.031 + windOrigin.z * 0.026 ) * 0.5 + 0.5;
         float gust2 = sin( uTime * 0.11 + windOrigin.z * 0.019 - windOrigin.x * 0.014 ) * 0.5 + 0.5;
         float sway = ( sin( windPhase ) * 0.55 + sin( windPhase * 2.17 ) * 0.28 + sin( windPhase * 0.37 ) * 0.18 )
           * ( 0.22 + gust * 0.55 + gust2 * 0.23 );
         // Cubic tip weight — roots stay planted, tips paint the gust flash.
         float windFalloff = windUp * windUp * ( 0.35 + 0.65 * windUp );
         transformed.x += sway * windFalloff * ${options.strength.toFixed(3)};
         transformed.z += sway * windFalloff * ${(options.strength * 0.62).toFixed(3)};
        `
      );
  };

  // three's default cache key is the *source text* of `onBeforeCompile`, which
  // is identical for every material this function builds — so without an
  // explicit key they would all silently share the first one's compiled
  // program, and the trees would sway like grass.
  material.customProgramCacheKey = () => cacheKey;
  material.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// The meadow
// ---------------------------------------------------------------------------

/**
 * Four rings of camera-following chunks, drawn from one shared blade buffer per
 * ring. The arithmetic — the ring table, the density law, the chunk recycling
 * and the ground bake — lives in `lib/world/grass.ts`; what follows is the
 * geometry, the shader and the draw.
 *
 * The shape of it: a ring owns *one* blade template (a strip of `segments`
 * Bezier spans) and *one* instanced buffer of chunk-local positions, and every
 * chunk in the ring is a `Mesh` sharing both, positioned at the chunk's corner
 * and drawing a prefix of the buffer. That is why 89000 blades per nine-metre
 * chunk is affordable: forty-nine chunks cost forty-nine model matrices, not
 * four million transforms. The vertex shader re-hashes each blade against its
 * chunk origin and reflects the point set through one of eight symmetries, so
 * the same buffer grows differently in every chunk it appears in.
 */

const G_DRY = hexRgb(GHIBLI.gDry);

function glf(value: number): string {
  return value.toFixed(5);
}

function glvec3(colour: Rgb): string {
  return `vec3(${colour[0].toFixed(4)}, ${colour[1].toFixed(4)}, ${colour[2].toFixed(4)})`;
}

/**
 * One blade, as a template.
 *
 * `position` is not a position: x carries the side of the strip (-1, +1, and 0
 * at the tip) and y carries `t` along the blade. The real shape is built in the
 * vertex shader, because every blade needs a different height, lean, width and
 * wind phase and none of that can be baked. Riding on the `position` attribute
 * rather than a custom name is only so three's draw-range bookkeeping has
 * something it recognises to count.
 *
 * The tip is a single vertex, so a blade of S spans is 2S-1 triangles rather
 * than 2S with a degenerate one at the top. At four million blades a frame that
 * is not a rounding error.
 */
function bladeTemplate(segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let k = 0; k < segments; k++) {
    const t = k / segments;
    positions.push(-1, t, 0, 1, t, 0);
  }
  const tip = positions.length / 3;
  positions.push(0, 1, 0);

  for (let k = 0; k < segments - 1; k++) {
    const a = k * 2;
    const b = k * 2 + 1;
    const c = (k + 1) * 2;
    const d = (k + 1) * 2 + 1;
    indices.push(a, c, d, a, d, b);
  }
  indices.push((segments - 1) * 2, tip, (segments - 1) * 2 + 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function grassVertexShader(index: number, ring: GrassRing, density: number): string {
  const band = ringBand(index);
  const fadeIn =
    band.inHi > band.inLo
      ? `smoothstep(${glf(band.inLo)}, ${glf(band.inHi)}, d)`
      : `1.0`;
  const fadeOut =
    band.outHi > band.outLo
      ? `(1.0 - smoothstep(${glf(band.outLo)}, ${glf(band.outHi)}, d))`
      : `(1.0 - step(${glf(band.outLo)}, d))`;

  return `
    attribute vec2 aLocal;
    attribute vec2 aSeedRank;

    uniform float uTime;
    uniform sampler2D uHeight;
    uniform sampler2D uMask;
    uniform float uHeightMin;
    uniform float uHeightRange;
    uniform float uPixelScale;
    uniform vec3 uSun;
    uniform vec3 uSunColour;
    uniform vec3 uSkyColour;
    uniform vec3 uGroundColour;

    varying vec3 vColour;

    #include <common>
    #include <fog_pars_vertex>

    float gHash( vec2 p ) {
      vec3 q = fract( vec3( p.xyx ) * 0.1031 );
      q += dot( q, q.yzx + 33.33 );
      return fract( ( q.x + q.y ) * q.z );
    }

    void main() {
      vec2 chunkOrigin = vec2( modelMatrix[ 3 ][ 0 ], modelMatrix[ 3 ][ 2 ] );
      float cSeed = gHash( chunkOrigin * 0.07 + 3.1 );

      // Eight-fold dihedral shuffle of the shared point set. One buffer serves
      // every chunk in the ring; without this the chunk grid reads as a tiled
      // lattice the moment you sight along it.
      vec2 local = aLocal;
      if ( cSeed > 0.5 ) local.x = ${glf(ring.chunk)} - local.x;
      if ( fract( cSeed * 7.31 ) > 0.5 ) local.y = ${glf(ring.chunk)} - local.y;
      if ( fract( cSeed * 13.77 ) > 0.5 ) local = local.yx;

      vec2 world = chunkOrigin + local;
      vec2 mapUv = world * ${glf(1 / WORLD_SIZE)} + 0.5;

      vec4 mask = texture2D( uMask, mapUv );
      // Height is packed as 16-bit in R (lo) + G (hi). Channel-wise bilinear
      // still reconstructs the lerp of the decoded metres (see buildMeadow).
      vec4 htex = texture2D( uHeight, mapUv );
      float hn = ( htex.r * 255.0 + htex.g * 65280.0 ) / 65535.0;
      float ground = uHeightMin + hn * uHeightRange;
      // Planted under the analytic surface: the drawn LOD mesh sits a touch
      // below heightAt between vertices, and a flush plant would hover.
      vec3 root = vec3( world.x, ground - 0.11, world.y );

      // Plan distance only — the follow camera sits several metres above the
      // bard, and folding that height into density thins the sward underfoot
      // to nothing the moment you look down the road.
      float d = max( length( world - cameraPosition.xz ), 0.001 );

      // The density law: B * min( 1, ( dn / d ) ^ 1.5 ). Written this way on
      // purpose — at exactly 1.5 this is x*x*inversesqrt(x), three instructions
      // where a general pow is about ten, and it runs on every grass vertex in
      // the frame.
      float ratio = min( ${glf(ring.dn)} / d, 1.0 );
      float dens = ratio * ratio * inversesqrt( max( ratio, 1e-4 ) );

      // The ring's band, crossfaded against its neighbours over exactly the
      // interval they share, so the two weights sum to one and the density
      // curve runs through the handover without a step.
      float band = ${fadeIn} * ${fadeOut};

      // The fine half of the thinning. aSeedRank.y is the blade's place in the
      // shuffled queue, and the CPU already dropped everything past its own,
      // looser cut — measured from the chunk's nearest corner, so it is always
      // the larger of the two. This test can therefore only ever remove.
      float keep = ${glf(density)} * dens * band * mask.r;

      if ( aSeedRank.y >= keep ) {
        // Outside the clip volume — no fragments. (Avoid degenerate zero-area
        // triangles at the root, which some drivers still rasterize as haze.)
        vColour = vec3( 0.0 );
        #ifdef USE_FOG
          vFogDepth = 0.0;
        #endif
        gl_Position = vec4( 2.0, 2.0, 2.0, 0.0 );
        return;
      }

      float s = fract( aSeedRank.x + cSeed );
      float h1 = gHash( vec2( s * 91.7, cSeed * 13.1 + 1.7 ) );
      float h2 = gHash( vec2( s * 37.3 + 5.1, cSeed * 71.9 ) );
      float h3 = gHash( vec2( s * 57.1 + 9.3, cSeed * 29.7 + 2.3 ) );

      float side = position.x;
      float t = position.y;

      float height = ${glf(GRASS_BLADE_HEIGHT * ring.hs)}
        * ( 0.35 + mask.b * 1.1 ) * ( 0.55 + 0.95 * h3 );

      // The angular width floor. A blade is two centimetres across, which is
      // under a pixel past forty metres or so — and a sub-pixel blade does not
      // read as grass, it reads as crawling noise. Holding every blade at least
      // ${ring.wpx} pixels wide is what makes the far field a painted meadow
      // instead of shimmer. What has to stay constant is screen COVERAGE —
      // density times width times height — so an outer ring trades blade count
      // for blade width one for one, and that is a fair trade only because the
      // width is defended here.
      //
      // Capped against the blade's own height, because past the point where a
      // stroke is wider than it is tall it stops reading as grass and starts
      // reading as a horizontal dash. Nothing inside this valley reaches the
      // cap; it exists for the outer ring's stated 1250 metres.
      // Hard-capped: the old height*1.35 floor let far rings grow metre-wide
      // strokes that painted a full-screen green veil over the valley.
      float floorWidth = min(
        ${glf(ring.wpx)} * d * uPixelScale,
        min( height * 0.42, 0.055 )
      );
      float halfWidth = 0.5 * max( ${glf(GRASS_BLADE_WIDTH)} * ( 0.7 + 0.6 * h2 ), floorWidth );

      float yaw = h1 * 6.2831853;
      float ca = cos( yaw );
      float sa = sin( yaw );

      // The same clock and the same gust fronts as the rest of the flora, so the
      // valley moves as one weather system rather than as several.
      float phase = uTime * 1.35 + world.x * 0.42 + world.y * 0.31;
      float gust = sin( uTime * 0.31 + world.x * 0.031 + world.y * 0.026 ) * 0.5 + 0.5;
      float gust2 = sin( uTime * 0.13 + world.y * 0.019 - world.x * 0.014 ) * 0.5 + 0.5;
      float sway = ( sin( phase ) * 0.62 + sin( phase * 2.17 ) * 0.34 + sin( phase * 0.37 ) * 0.22 )
        * ( 0.38 + gust * 0.72 + gust2 * 0.32 );

      // A quadratic Bezier in the blade's own forward/up plane. The control
      // point sits high and on the axis so the blade leaves the ground
      // vertically and only the upper half travels; the end point is what the
      // lean and the wind move. A blade bent from the root looks like wire.
      float lean = clamp( 0.3 + h2 * 0.5 + sway * 0.72, 0.0, 1.45 );
      vec2 p1 = vec2( 0.0, height * 0.62 );
      vec2 p2 = vec2( height * lean, height * ( 1.0 - lean * lean * 0.34 ) );
      float mt = 1.0 - t;
      vec2 curve = 2.0 * mt * t * p1 + t * t * p2;

      float w = halfWidth * ( 1.0 - t * t * 0.8 );
      vec3 forward = vec3( ca, 0.0, sa );
      vec3 across = vec3( -sa, 0.0, ca );
      vec3 pos = root + forward * curve.x + vec3( 0.0, curve.y, 0.0 ) + across * ( side * w );

      // Teal at the root, yellow-green at the tip — the reference's colour path,
      // painted from the same film stock as the terrain and the canopies.
      vec3 c = mix( ${glvec3(G_BASE)}, ${glvec3(G_LOW)}, smoothstep( 0.0, 0.26, t ) );
      c = mix( c, ${glvec3(G_MID)}, smoothstep( 0.18, 0.55, t ) );
      c = mix( c, ${glvec3(G_UPPER)}, smoothstep( 0.45, 0.84, t ) );
      c = mix( c, ${glvec3(G_TIP)}, smoothstep( 0.78, 1.0, t ) );
      c = mix( c, ${glvec3(G_DRY)}, mask.g * ( 0.3 + 0.55 * t ) );
      c *= 0.82 + mask.a * 0.34;
      c *= 0.88 + h1 * 0.24;

      // A cheap face normal: off vertical by the blade's own lean, rolled by
      // which edge of the strip this vertex is. What sells a meadow is the sheen
      // travelling across it as a gust passes, and that comes from the spread of
      // yaws, not from an accurate normal.
      vec3 n = normalize( vec3(
        -forward.x * 0.42 + across.x * side * 0.3,
        1.0,
        -forward.z * 0.42 + across.z * side * 0.3
      ) );
      float sky = 0.5 + 0.5 * n.y;
      float sun = max( dot( n, uSun ), 0.0 );
      // Roots sit in their own shade. Without this the sward is flat and the
      // field reads as a painted plane however many blades are standing in it.
      float ao = 0.34 + 0.66 * t * t;
      vColour = c * mix( uGroundColour, uSkyColour, sky ) * ao
        + c * uSunColour * sun * ( 0.3 + 0.7 * t );

      // Already in world space — the chunk's model matrix was consumed above as
      // the blade's origin, so applying it again here would double it.
      vec4 mvPosition = viewMatrix * vec4( pos, 1.0 );
      gl_Position = projectionMatrix * mvPosition;

      #include <fog_vertex>
    }
  `;
}

const GRASS_FRAGMENT_SHADER = `
  varying vec3 vColour;

  #include <common>
  #include <fog_pars_fragment>

  void main() {
    // Lit in the vertex shader already. Keep this tiny so three's own
    // ShaderMaterial preamble (tone-map / color-space pars) cannot collide
    // with a second copy of those chunks — that was a silent meadow killer.
    gl_FragColor = vec4( vColour, 1.0 );
    #include <fog_fragment>
  }
`;

type MeadowRing = {
  ring: GrassRing;
  material: THREE.ShaderMaterial;
  meshes: THREE.Mesh[];
};

type Meadow = {
  group: THREE.Group;
  grid: GrassChunkGrid;
  rings: MeadowRing[];
  uniforms: { uPixelScale: { value: number } };
  templates: THREE.BufferGeometry[];
  textures: THREE.Texture[];
};

/** Ground-field resolution. One metre per texel on the tier that can pay for it. */
function groundResolution(budget: QualityBudget): number {
  return budget.tier === "high" ? 640 : budget.tier === "medium" ? 512 : 384;
}

function buildMeadow(budget: QualityBudget, clock: WindClock): Meadow {
  const tier = grassTierIndex(budget.tier);
  const quality = GRASS_QUALITY[tier];

  const ground = bakeGrassGround(groundResolution(budget));

  // Encode height as 16-bit into R (lo) + G (hi) of an RGBA8 texture.
  // R16F would be nicer, but a surprising number of WebGL2 drivers hand back
  // zero (or refuse the upload) for half-float red — every blade then plants
  // at y = 0, ten metres under the valley and invisible. Byte textures sample
  // everywhere LinearFilter works; packing 16-bit keeps quantisation under a
  // centimetre instead of the ~70 cm steps a single-byte field had.
  const heightRange = Math.max(1e-3, ground.maxHeight - ground.minHeight);
  const encodedHeights = new Uint8Array(ground.height.length * 4);
  for (let i = 0; i < ground.height.length; i++) {
    const t = (ground.height[i] - ground.minHeight) / heightRange;
    const q = Math.max(0, Math.min(65535, Math.round(t * 65535)));
    const o = i * 4;
    encodedHeights[o] = q & 255;
    encodedHeights[o + 1] = (q >> 8) & 255;
    encodedHeights[o + 2] = 0;
    encodedHeights[o + 3] = 255;
  }
  const heightTexture = new THREE.DataTexture(
    encodedHeights,
    ground.size,
    ground.size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  const maskTexture = new THREE.DataTexture(
    ground.mask,
    ground.size,
    ground.size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  for (const texture of [heightTexture, maskTexture]) {
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    // Both are data, not pictures. Letting the renderer decode them as sRGB
    // would bend the density curve and the height field alike.
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
  }

  const sun = ghibliSunDirection();
  const shared = {
    // The flora clock, shared, so the grass gusts with the canopies rather than
    // running its own weather.
    uTime: clock.current.uTime,
    uHeight: { value: heightTexture },
    uMask: { value: maskTexture },
    uHeightMin: { value: ground.minHeight },
    uHeightRange: { value: heightRange },
    uPixelScale: { value: 0.0012 },
    uSun: { value: new THREE.Vector3(sun[0], sun[1], sun[2]).normalize() },
    uSunColour: {
      value: new THREE.Color().setStyle(GHIBLI.sun, THREE.SRGBColorSpace).multiplyScalar(1.2),
    },
    uSkyColour: {
      value: new THREE.Color().setStyle(GHIBLI.ambSky, THREE.SRGBColorSpace).multiplyScalar(0.7),
    },
    uGroundColour: {
      value: new THREE.Color().setStyle(GHIBLI.ambGround, THREE.SRGBColorSpace).multiplyScalar(0.4),
    },
  };

  const group = new THREE.Group();
  group.name = "Grass";
  const grid = new GrassChunkGrid(ground, tier);
  const rings: MeadowRing[] = [];
  const templates: THREE.BufferGeometry[] = [];

  for (let r = 0; r < GRASS_RINGS.length; r++) {
    const ring = GRASS_RINGS[r];
    const template = bladeTemplate(quality.blades[r]);
    templates.push(template);

    const blades = buildRingBlades(r);
    const localAttribute = new THREE.InstancedBufferAttribute(blades.local, 2);
    const seedAttribute = new THREE.InstancedBufferAttribute(blades.seedRank, 2);

    const material = new THREE.ShaderMaterial({
      // `UniformsUtils.merge` would clone the shared value objects and sever the
      // clock; the fog block has to be cloned per material because the renderer
      // writes the scene's fog into it, so only that half is copied.
      uniforms: Object.assign(
        THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        shared
      ),
      vertexShader: grassVertexShader(r, ring, quality.grass[r]),
      fragmentShader: GRASS_FRAGMENT_SHADER,
      // A blade is a strip with no thickness and no reliable facing.
      side: THREE.DoubleSide,
      fog: true,
      lights: false,
      // Vertex shader already shades into display-ish colour; skipping the
      // renderer tone map avoids the r185 double-include compile failure.
      toneMapped: false,
    });
    material.name = `grass-ring-${r}`;

    const meshes: THREE.Mesh[] = [];
    const side = grid.gridPerSide[r];
    for (let s = 0; s < side * side; s++) {
      const geometry = new THREE.InstancedBufferGeometry();
      // Every chunk in the ring shares the template and the blade buffer; only
      // the model matrix, the instance count and the bounding sphere differ.
      // The attribute objects are shared by identity, so the renderer uploads
      // each of them exactly once however many chunks reference them.
      geometry.setAttribute("position", template.getAttribute("position"));
      geometry.setIndex(template.getIndex());
      geometry.setAttribute("aLocal", localAttribute);
      geometry.setAttribute("aSeedRank", seedAttribute);
      geometry.instanceCount = 0;
      // Set, not computed: `position` holds strip coordinates, so three's own
      // bounds would be a unit box in the wrong space. This one is rewritten
      // whenever the chunk is recycled, and it is what three frustum-culls on —
      // which is the difference between two hundred and sixty-eight draw calls
      // and the forty or so actually in shot.
      geometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(ring.chunk * 0.5, 0, ring.chunk * 0.5),
        ring.chunk
      );

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `grass-r${r}-c${s}`;
      mesh.visible = false;
      // Four million blades in the shadow map buy a texture of noise and cost a
      // whole extra pass of the same geometry.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Bounding spheres are rebuilt on recycle; until then a stale sphere can
      // cull a whole near-ring chunk the frame it appears beside the bard.
      mesh.frustumCulled = false;
      group.add(mesh);
      meshes.push(mesh);
    }

    rings.push({ ring, material, meshes });
  }

  return { group, grid, rings, uniforms: shared, templates, textures: [heightTexture, maskTexture] };
}

function updateMeadow(meadow: Meadow, cameraX: number, cameraZ: number): void {
  meadow.grid.update(cameraX, cameraZ);

  for (let r = 0; r < meadow.rings.length; r++) {
    const entry = meadow.rings[r];
    const slots = meadow.grid.slots[r];
    const chunk = entry.ring.chunk;

    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      const mesh = entry.meshes[s];

      // The move is applied even when the chunk has nothing to draw this frame.
      // A recycled slot that is out of band now may come into band a second
      // later without moving again, and it must not do so at its old origin.
      if (slot.moved) {
        mesh.position.set(slot.originX, 0, slot.originZ);
        const sphere = mesh.geometry.boundingSphere!;
        sphere.center.set(chunk * 0.5, (slot.minY + slot.maxY) * 0.5, chunk * 0.5);
        // Half the chunk's diagonal, plus the ground's relief, plus headroom for
        // the tallest blade and the furthest the wind can throw it.
        sphere.radius = Math.SQRT1_2 * chunk + (slot.maxY - slot.minY) * 0.5 + 4;
      }

      if (slot.count <= 0) {
        mesh.visible = false;
        continue;
      }

      mesh.visible = true;
      (mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = slot.count;
    }
  }
}

function disposeMeadow(meadow: Meadow): void {
  for (const entry of meadow.rings) {
    for (const mesh of entry.meshes) mesh.geometry.dispose();
    entry.material.dispose();
  }
  for (const template of meadow.templates) template.dispose();
  for (const texture of meadow.textures) texture.dispose();
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

type FieldGroup = {
  field: InstanceField;
  thresholds: number[];
  maxDistance: number;
  always: number;
};

function makeInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  capacity: number,
  name: string,
  shadows: boolean
) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  mesh.frustumCulled = false;
  return mesh;
}

/** `grass` = meadow + verge for first paint; `canopy` = trees/shrubs/rocks after. */
export type FloraLayers = "grass" | "canopy";

export function Flora({
  budget,
  layers = "canopy",
}: {
  budget: QualityBudget;
  layers?: FloraLayers;
}) {
  // One shared clock for every wind shader, so the whole world gusts together.
  // A ref, not a memo: this object is written on every frame, and a ref is the
  // container React sanctions for values that mutate outside of rendering.
  const clock = useRef({ uTime: { value: 0 } });
  const view = useRef({
    frustum: new THREE.Frustum(),
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    buffer: new THREE.Vector2(),
    // Starts one short of the cadence, so the first frame drawn is already
    // populated rather than an empty world for a twentieth of a second.
    frame: 2,
  });

  const built = useMemo(() => {
    const group = new THREE.Group();
    group.name = layers === "grass" ? "FloraGrass" : "FloraCanopy";
    const groups: FieldGroup[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    const meshes: THREE.InstancedMesh[] = [];
    const wantGrass = layers === "grass";
    const wantCanopy = layers === "canopy";

    const attach = (mesh: THREE.InstancedMesh, parent: THREE.Group) => {
      parent.add(mesh);
      meshes.push(mesh);
    };

    // --- shared surfaces --------------------------------------------------
    const textureSize = budget.textureSize >= 512 ? 256 : 128;

    const swayHigh = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // CodePen meadow wind: tip-heavy cubic bend + a slow gust front.
    decorateFlora(
      swayHigh,
      clock,
      // Strong tip sway — roadside grass has to read as moving from the
      // follow-camera distance, not as a static green fringe.
      { height: 0.7, strength: 0.62, speed: 1.35, tint: 0.22 },
      wantGrass ? "flora-sway-high-grass" : "flora-sway-high-canopy"
    );

    const swayLow = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    decorateFlora(
      swayLow,
      clock,
      { height: 1.4, strength: 0.07, speed: 0.95, tint: 0.28 },
      wantGrass ? "flora-sway-low-grass" : "flora-sway-low-canopy"
    );

    materials.push(swayHigh, swayLow);

    let barkMaterial: THREE.MeshStandardMaterial | null = null;
    let canopyMaterial: THREE.MeshStandardMaterial | null = null;
    let rockMaterial: THREE.MeshStandardMaterial | null = null;

    if (wantCanopy) {
      const bark = barkFields(textureSize);
      const foliage = makeFoliageAlpha(textureSize, 5);
      const rockNormal = makeRockNormalMap(Math.min(256, budget.textureSize));
      rockNormal.repeat.set(2, 2);
      textures.push(foliage, rockNormal);

      barkMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: bark.map,
        normalMap: bark.normalMap,
        normalScale: new THREE.Vector2(1.15, 1.15),
        roughnessMap: bark.roughnessMap,
        roughness: 1,
        metalness: 0,
      });
      decorateFlora(
        barkMaterial,
        clock,
        { height: 16, strength: 0.14, speed: 0.45, tint: 0.12, kind: "tree" },
        "flora-bark-tree"
      );

      canopyMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: foliage,
        // Cut-out hard enough to kill the green fog plane when the lens sits
        // inside a crown, soft enough that distant edges still read as leaves.
        alphaTest: 0.44,
        transparent: false,
        side: THREE.DoubleSide,
        roughness: 0.86,
        metalness: 0,
      });
      // Slow crown bend + tip flutter — mass first, then leaf noise.
      decorateFlora(
        canopyMaterial,
        clock,
        { height: 14, strength: 0.42, speed: 0.42, tint: 0.18, kind: "tree" },
        "flora-canopy-tree"
      );

      rockMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        normalMap: rockNormal,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 0.95,
        metalness: 0.02,
        flatShading: true,
      });

      materials.push(barkMaterial, canopyMaterial, rockMaterial);
    }

    // --- trees ------------------------------------------------------------
    const trees = new THREE.Group();
    trees.name = "Trees";
    if (wantCanopy) group.add(trees);

    for (let s = 0; wantCanopy && s < TREES.length; s++) {
      const spec = TREES[s];
      const items = scatterBiome({
        seed: 4200 + s * 137,
        count: Math.round(budget.trees * spec.share),
        weights: spec.weights,
        clump: spec.clump,
        clumpRadius: spec.clumpRadius,
        maxSlope: spec.maxSlope,
        minHeight: spec.minHeight,
        maxHeight: spec.maxHeight,
        // Keep crowns off the carriageway. The follow camera sits ~6m behind
        // the bard — trees closer than that put the lens inside the canopy and
        // the whole stage turns into a green veil.
        minRoadDistance: Math.max(spec.minRoadDistance, 11),
        minWaterDistance: spec.minWaterDistance,
        scale: spec.scale,
        // Trees stand up to the hill. One lying along the slope the way
        // heather does reads as a felled one.
        lean: 0.2,
      });
      if (items.length === 0) continue;

      const detailed = buildTrunk(spec, true);
      const simplified = buildTrunk(spec, false);
      const canopy = buildCanopy(spec, detailed.anchors, true);
      const simpleCanopy = buildCanopy(spec, simplified.anchors, false);

      const billboard = makeTreeBillboard(spec.billboard, 224, s * 13 + 3);
      const billboardMaterial = new THREE.MeshLambertMaterial({
        vertexColors: true,
        map: billboard,
        alphaTest: 0.4,
        transparent: false,
        side: THREE.DoubleSide,
      });
      const cardHeight = spec.height * 1.18;
      const cardWidth = spec.conifer ? cardHeight * 0.4 : cardHeight * 0.7;
      const cardGeometry = crossedCards(cardWidth, cardHeight);

      // Near is capped hard. Everything in it casts a shadow, so its triangle
      // count is paid twice, and in the thick of Greyneedle the uncapped figure
      // is several hundred trees.
      const nearCap = Math.min(items.length, Math.max(24, Math.round(items.length * 0.12)), 150);
      const midCap = Math.min(items.length, Math.max(48, Math.round(items.length * 0.45)));
      const field = new InstanceField(items, spec.crownRadius * 1.3 + spec.height * 0.4);

      const nearMeshes = [
        makeInstanced(
          detailed.geometry,
          barkMaterial!,
          nearCap,
          `${spec.id}-trunk`,
          true
        ),
      ];
      if (canopy) {
        nearMeshes.push(
          makeInstanced(
            canopy,
            canopyMaterial!,
            nearCap,
            `${spec.id}-canopy`,
            true
          )
        );
      }
      field.addLevel(nearCap, nearMeshes);

      // Mid keeps bark + cut-out canopy separate. Merging into a solid blob is
      // what made the middle distance look like green candy apples.
      const midMeshes = [
        makeInstanced(
          simplified.geometry,
          barkMaterial!,
          midCap,
          `${spec.id}-mid-trunk`,
          false
        ),
      ];
      if (simpleCanopy) {
        midMeshes.push(
          makeInstanced(
            simpleCanopy,
            canopyMaterial!,
            midCap,
            `${spec.id}-mid-canopy`,
            false
          )
        );
      }
      field.addLevel(midCap, midMeshes);

      const cardMesh = makeInstanced(
        cardGeometry,
        billboardMaterial,
        items.length,
        `${spec.id}-card`,
        false
      );
      field.addLevel(items.length, [cardMesh]);

      for (const mesh of nearMeshes) attach(mesh, trees);
      for (const mesh of midMeshes) attach(mesh, trees);
      attach(cardMesh, trees);

      geometries.push(detailed.geometry, simplified.geometry, cardGeometry);
      if (canopy) geometries.push(canopy);
      if (simpleCanopy) geometries.push(simpleCanopy);
      materials.push(billboardMaterial);
      textures.push(billboard);

      groups.push({
        field,
        thresholds: [budget.lodNear, budget.lodMid],
        maxDistance: budget.drawDistance,
        always: budget.shadowDistance,
      });
    }

    // --- shrubs and ground cover -----------------------------------------
    const understory = new THREE.Group();
    understory.name = "Undergrowth";
    group.add(understory);

    const addPlant = (
      spec: PlantSpec,
      count: number,
      seed: number,
      near: number,
      far: number,
      shadows: boolean
    ) => {
      const items = scatterBiome({
        seed,
        count,
        weights: spec.weights,
        clump: spec.clump,
        clumpRadius: spec.clumpRadius,
        maxSlope: spec.maxSlope,
        minHeight: spec.minHeight,
        maxHeight: spec.maxHeight,
        minRoadDistance: spec.minRoadDistance,
        minWaterDistance: spec.minWaterDistance,
        scale: spec.scale,
        lean: spec.lean,
      });
      if (items.length === 0) return;

      const material = spec.sway === "high" ? swayHigh : swayLow;
      const detailGeometry = spec.build(true);
      const roughGeometry = spec.build(false);
      geometries.push(detailGeometry, roughGeometry);

      const nearCap = Math.min(items.length, near);
      const farCap = Math.min(items.length, far);
      const field = new InstanceField(items, 1.6);

      const nearMesh = makeInstanced(
        detailGeometry,
        material,
        nearCap,
        `${spec.id}-near`,
        shadows
      );
      const farMesh = makeInstanced(
        roughGeometry,
        material,
        farCap,
        `${spec.id}-far`,
        false
      );
      field.addLevel(nearCap, [nearMesh]);
      field.addLevel(farCap, [farMesh]);
      attach(nearMesh, understory);
      attach(farMesh, understory);

      const isSward = spec.id === "sward";
      groups.push({
        field,
        thresholds: [budget.lodNear * (isSward ? 0.95 : 0.7)],
        // Undergrowth stops well short of the trees' draw distance. A knee-high
        // plant a hundred and fifty metres off is a fifth of a pixel, and a
        // hundred thousand fifth-of-a-pixel plants are how a scene dies.
        // Sward keeps a longer draw so the roadside reads lush from the camera.
        maxDistance: budget.lodMid * (isSward ? 1.55 : 1.15),
        always: isSward ? 14 : 0,
      });
    };

    if (wantCanopy) {
      for (let s = 0; s < SHRUBS.length; s++) {
        const spec = SHRUBS[s];
        addPlant(
          spec,
          Math.round(budget.shrubs * spec.share),
          9100 + s * 211,
          420,
          1800,
          true
        );
      }

      for (let s = 0; s < COVER.length; s++) {
        const spec = COVER[s];
        const isGrass =
          spec.id === "sward" ||
          spec.id === "wildflower" ||
          spec.id === "tussock";
        // Grass cover already came up in the first-paint layer.
        if (isGrass) continue;
        addPlant(
          spec,
          Math.round(budget.groundCover * spec.share),
          15500 + s * 313,
          1500,
          4200,
          false
        );
      }

      addPlant(BRACKEN, budget.ferns, 5150, 900, 2600, false);
    } else if (wantGrass) {
      // First paint: only the grass-like cover, not shrubs / bracken.
      for (let s = 0; s < COVER.length; s++) {
        const spec = COVER[s];
        const isGrass =
          spec.id === "sward" ||
          spec.id === "wildflower" ||
          spec.id === "tussock";
        if (!isGrass) continue;
        addPlant(
          spec,
          Math.round(budget.groundCover * spec.share * 2.1),
          15500 + s * 313,
          5200,
          16000,
          false
        );
      }
    }

    // --- roadside grass -----------------------------------------------------
    //
    // Extra InstancedMesh verge tufts on top of the GPU meadow, so the road
    // edge stays lush even when the near ring is still recycling chunks.
    if (wantGrass) {
      const vergeCount =
        budget.tier === "high" ? 72000 : budget.tier === "medium" ? 48000 : 22000;
      const verge: Placement[] = [];
      const point = new THREE.Vector3();
      const tangent = new THREE.Vector3();
      let guard = 0;
      while (verge.length < vergeCount && guard < vergeCount * 7) {
        guard++;
        const road =
          ROADS[Math.floor(hash2(guard * 17, 4242) * ROADS.length) % ROADS.length];
        const t = hash2(guard * 3, 901);
        const clamped = Math.min(0.9999, Math.max(0.0001, t));
        road.getPointAt(clamped, point);
        road.getTangentAt(clamped, tangent);
        const nx = -tangent.z;
        const nz = tangent.x;
        const len = Math.hypot(nx, nz) || 1;
        const side = hash2(guard, 55) > 0.5 ? 1 : -1;
        // Three bands: tight verge, near meadow, wider field strip.
        const roll = hash2(guard * 9, 61);
        const band = roll > 0.55 ? 0 : roll > 0.22 ? 1 : 2;
        const dist =
          ROAD_HALF_WIDTH +
          0.12 +
          (band === 0
            ? hash2(guard * 5, 77) * 3.6
            : band === 1
              ? 3.2 + hash2(guard * 5, 88) * 7.5
              : 10 + hash2(guard * 5, 99) * 14);
        const x = point.x + (nx / len) * side * dist;
        const z = point.z + (nz / len) * side * dist;
        if (distanceToRoad(x, z) < ROAD_HALF_WIDTH + 0.08) continue;
        sampleGround(x, z, groundScratch);
        if (groundScratch.y < WATER_LEVEL + 0.12) continue;
        if (groundScratch.y > TREE_LINE + 28) continue;
        if (groundScratch.slope > 0.68) continue;
        verge.push({
          x,
          y: groundScratch.y - 0.028,
          z,
          scale: 1.0 + hash2(guard, 19) * 0.95,
          yaw: hash2(guard, 23) * Math.PI * 2,
          tiltX: -groundScratch.dydz * 0.35,
          tiltZ: groundScratch.dydx * 0.35,
        });
      }

      if (verge.length > 0) {
        const detailGeometry = bladeTuft({
          blades: 22,
          height: 1.02,
          halfWidth: 0.022,
          segments: 4,
          lean: 0.85,
          spread: 0.18,
          base: G_BASE,
          tip: G_TIP,
          seed: 8801,
        });
        const roughGeometry = bladeTuft({
          blades: 12,
          height: 0.86,
          halfWidth: 0.026,
          segments: 3,
          lean: 0.76,
          spread: 0.15,
          base: G_BASE,
          tip: G_TIP,
          seed: 8802,
        });
        geometries.push(detailGeometry, roughGeometry);

        const nearCap = Math.min(
          verge.length,
          budget.tier === "low" ? 6000 : budget.tier === "medium" ? 16000 : 28000
        );
        const farCap = Math.min(
          verge.length,
          budget.tier === "low" ? 16000 : budget.tier === "medium" ? 40000 : 64000
        );
        const field = new InstanceField(verge, 1.7);
        const nearMesh = makeInstanced(
          detailGeometry,
          swayHigh,
          nearCap,
          "road-sward-near",
          false
        );
        const farMesh = makeInstanced(
          roughGeometry,
          swayHigh,
          farCap,
          "road-sward-far",
          false
        );
        field.addLevel(nearCap, [nearMesh]);
        field.addLevel(farCap, [farMesh]);
        attach(nearMesh, understory);
        attach(farMesh, understory);
        groups.push({
          field,
          thresholds: [budget.lodNear * 1.05],
          maxDistance: budget.lodMid * 1.75,
          always: 18,
        });
      }
    }

    // Camera-following GPU meadow — dense swaying grass across the valley.
    const meadow = wantGrass ? buildMeadow(budget, clock) : null;
    if (meadow) group.add(meadow.group);

    // --- rocks ------------------------------------------------------------
    if (wantCanopy && rockMaterial) {
      const rocksGroup = new THREE.Group();
      rocksGroup.name = "Rocks";
      group.add(rocksGroup);

      for (let v = 0; v < 3; v++) {
        const items = scatterBiome({
          seed: 909 + v * 173,
          count: Math.round(budget.rocks / 3),
          weights: ROCK_WEIGHTS,
          clump: 2,
          clumpRadius: 3.2,
          maxSlope: 0.72,
          minHeight: WATER_LEVEL - 0.3,
          maxHeight: 200,
          minRoadDistance: 2.6,
          minWaterDistance: -1,
          scale: [0.3, 1.7],
          // Boulders sit *in* the hill, not on top of it.
          lean: 0.9,
        });
        if (items.length === 0) continue;

        const near = rockGeometry(v * 31 + 5, true);
        const far = rockGeometry(v * 31 + 5, false);
        geometries.push(near, far);

        const nearCap = Math.min(items.length, 260);
        const farCap = Math.min(items.length, 900);
        const field = new InstanceField(items, 1.7);
        const nearMesh = makeInstanced(
          near,
          rockMaterial,
          nearCap,
          `rock-${v}-near`,
          true
        );
        const farMesh = makeInstanced(
          far,
          rockMaterial,
          farCap,
          `rock-${v}-far`,
          false
        );
        field.addLevel(nearCap, [nearMesh]);
        field.addLevel(farCap, [farMesh]);
        attach(nearMesh, rocksGroup);
        attach(farMesh, rocksGroup);

        groups.push({
          field,
          thresholds: [budget.lodNear],
          maxDistance: budget.drawDistance * 0.7,
          always: budget.shadowDistance,
        });
      }
    }

    return { group, groups, geometries, materials, textures, meshes, meadow };
  }, [budget, layers, 9]);

  useFrame((state, delta) => {
    clock.current.uTime.value += delta;

    const seen = view.current;
    const camera = state.camera;
    camera.getWorldPosition(seen.position);

    // Meadow follows the camera every frame — chunk recycle is cheap, and a
    // lagging near ring is exactly the "bare dirt underfoot" look.
    if (built.meadow) {
      const persp = camera as THREE.PerspectiveCamera;
      const heightPx = Math.max(
        1,
        state.gl.domElement.clientHeight * state.gl.getPixelRatio()
      );
      const fovRad = THREE.MathUtils.degToRad(persp.fov ?? 46);
      built.meadow.uniforms.uPixelScale.value =
        (2 * Math.tan(fovRad * 0.5)) / heightPx;
      updateMeadow(built.meadow, seen.position.x, seen.position.z);
    }

    // Metres per pixel, per metre of depth. The angular width floor turns a
    // blade's minimum size in pixels into a size in metres with it, so it has to
    // track both the canvas and the device pixel ratio — a blade sized for a
    // 900-pixel viewport is twice too wide on the same canvas at dpr 2.
    // Repartitioning every frame would be pure waste: nothing here moves fast
    // enough for a twentieth of a second of latency in the LOD split to show,
    // and the cell spheres are tested with a margin that covers it.
    seen.frame++;
    if (seen.frame % 3 !== 0) return;

    seen.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    seen.frustum.setFromProjectionMatrix(seen.matrix);

    for (const entry of built.groups) {
      entry.field.update(
        seen.frustum,
        seen.position.x,
        seen.position.y,
        seen.position.z,
        entry.thresholds,
        entry.maxDistance,
        entry.always
      );
    }
  });

  useEffect(() => {
    const { geometries, materials, textures, meshes, meadow } = built;
    return () => {
      for (const mesh of meshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      // Bark is shared for the life of the page and deliberately not in here:
      // a level-of-detail swap must not be able to free a texture another mesh
      // is still bound to.
      for (const texture of textures) texture.dispose();
      if (meadow) disposeMeadow(meadow);
    };
  }, [built]);

  return <primitive object={built.group} />;
}

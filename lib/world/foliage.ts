/**
 * Leaves, and the light that comes through them.
 *
 * A canopy is not a green solid. Everything that makes one read as foliage
 * rather than as a lumpy sphere happens at its boundary: the outline is torn,
 * daylight comes through the holes, and — with the sun sitting thirteen degrees
 * over this valley's horizon — the leaves at the rim are lit from *behind*, so
 * they glow a warmer and more saturated green than anything the diffuse term
 * can produce. Silhouette, gaps, transmission. Shading the outside of a shell
 * more cleverly cannot substitute for any of the three.
 *
 * So this module supplies the three ingredients the tree builder in
 * `Flora.tsx` cannot get from a shell:
 *
 *   - `makeLeafAtlas` — one texture of sixteen hand-rasterised leaf sprays,
 *     each with its own stem, its own per-leaf tone and its own ragged edge.
 *     Quads cut out of these are what breaks the crown's outline.
 *   - `decorateTranslucency` — the backlight term, injected into a material
 *     that has already been through `decorateFlora`, so wind and per-instance
 *     tint survive.
 *   - `makeCanopyBillboard` — the far level of detail, rebuilt out of the same
 *     ingredients (a branch skeleton, scattered leaf puffs, a warm rim) so the
 *     swap from the near mesh is not a change of species.
 *
 * Zero assets: every pixel below is rasterised into an array at runtime, the
 * same rule the rest of `lib/world` follows.
 */

import * as THREE from "three";
import { ghibliSunDirection } from "./ghibli-palette";

export type Rgb = [number, number, number];

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * Integer hash -> [0, 1). The same one `terrain.ts` and `textures.ts` use.
 *
 * `Math.imul` is load-bearing. A plain `*` on these constants runs past 2^53,
 * the float drops its low bits, and the low bits are the whole output of a
 * hash — the mean collapses toward 0.25 and every "random" leaf in a spray
 * lands on the same side of its twig.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp01(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Seeded value noise on a grid, bilinear. Not tiled — nothing here repeats. */
function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = hash2(i + seed * 7919, seed);

  const field = new Float32Array(size * size);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const fy = y * scale;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const row0 = y0 * (cells + 1);
      const row1 = (y0 + 1) * (cells + 1);
      field[y * size + x] =
        grid[row0 + x0] * (1 - sx) * (1 - sy) +
        grid[row0 + x0 + 1] * sx * (1 - sy) +
        grid[row1 + x0] * (1 - sx) * sy +
        grid[row1 + x0 + 1] * sx * sy;
    }
  }
  return field;
}

function fbm(size: number, seed: number, octaves: number, cells = 5): Float32Array {
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  let step = cells;
  for (let o = 0; o < octaves; o++) {
    const layer = valueNoise(size, step, seed + o * 137);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amplitude;
    total += amplitude;
    amplitude *= 0.52;
    step *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// ---------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------

/**
 * A scratch image with a colour *and* a depth channel.
 *
 * Coverage is max-composited rather than blended because these are cut-outs,
 * not paint: a leaf drawn over another leaf must keep its own edge, and the
 * hard boundary is the entire point — a blended stack of ellipses is exactly
 * the soft green cloud this module exists to get rid of.
 *
 * `depth` accumulates instead, because the number of things stacked over a
 * pixel is the only cheap measure of how deep inside the crown it is, and that
 * is what a canopy's interior darkness is made of.
 */
class Raster {
  readonly size: number;
  readonly alpha: Float32Array;
  readonly depth: Float32Array;
  readonly tone: Float32Array;
  readonly warm: Float32Array;
  readonly wood: Float32Array;

  constructor(size: number) {
    this.size = size;
    const n = size * size;
    this.alpha = new Float32Array(n);
    this.depth = new Float32Array(n);
    this.tone = new Float32Array(n);
    this.warm = new Float32Array(n);
    this.wood = new Float32Array(n);
  }

  /** `x`, `y` in image space, 0..1, y up. */
  private write(
    x: number,
    y: number,
    cover: number,
    tone: number,
    warm: number,
    wood: number
  ) {
    const px = Math.round(x * (this.size - 1));
    const py = Math.round((1 - y) * (this.size - 1));
    if (px < 0 || py < 0 || px >= this.size || py >= this.size) return;
    const i = py * this.size + px;
    this.depth[i] += cover;
    if (cover <= this.alpha[i]) return;
    this.alpha[i] = cover;
    this.tone[i] = tone;
    this.warm[i] = warm;
    this.wood[i] = wood;
  }

  /**
   * A tapered, curving stroke — leaf blade, petiole, twig, bough, trunk.
   *
   * Marched rather than solved: the midrib bends as it goes, and integrating
   * the heading is both shorter and more controllable than inverting a curve
   * for every scanline it crosses.
   */
  stroke(frame: Frame, s: Stroke) {
    const px = this.size * frame.scale;
    const steps = Math.max(4, Math.round(s.length * px * 1.7));
    let x = s.x;
    let y = s.y;
    const ds = s.length / steps;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const heading = s.angle + s.curve * t * t;
      const half = s.width(t);
      if (half > 1e-5) {
        // Perpendicular to the heading, in the same convention (angle 0 = up).
        const nx = Math.cos(heading);
        const ny = -Math.sin(heading);
        const span = Math.ceil(half * px) + 1;
        for (let k = -span; k <= span; k++) {
          const off = k / px;
          const edge = Math.abs(off) / half;
          if (edge > 1) continue;
          // One pixel of falloff at the rim, so a leaf edge is not a staircase.
          const cover = Math.min(1, (1 - edge) * half * px * 1.6);
          if (cover <= 0.02) continue;
          this.write(
            frame.ox + (x + nx * off) * frame.scale,
            frame.oy + (y + ny * off) * frame.scale,
            cover * s.opacity,
            s.tone(t),
            s.warm,
            s.wood
          );
        }
      }
      x += Math.sin(heading) * ds;
      y += Math.cos(heading) * ds;
    }
  }

  /** A soft round mass — one clump of leaves seen from a hundred metres. */
  blob(
    frame: Frame,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    tone: number,
    warm: number
  ) {
    const px = this.size * frame.scale;
    const x0 = Math.floor((cx - rx) * px);
    const x1 = Math.ceil((cx + rx) * px);
    const y0 = Math.floor((cy - ry) * px);
    const y1 = Math.ceil((cy + ry) * px);
    for (let iy = y0; iy <= y1; iy++) {
      const y = iy / px;
      for (let ix = x0; ix <= x1; ix++) {
        const x = ix / px;
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d >= 1) continue;
        this.write(
          frame.ox + x * frame.scale,
          frame.oy + y * frame.scale,
          1 - d * d * 0.55,
          tone,
          warm,
          0
        );
      }
    }
  }
}

/** Where in the target image a drawing's own 0..1 space lands. */
type Frame = { ox: number; oy: number; scale: number };

type Stroke = {
  x: number;
  y: number;
  /** Radians; 0 points up, positive turns toward +x. */
  angle: number;
  /** Total turn accumulated over the stroke. */
  curve: number;
  length: number;
  /** Half-width at t along the stroke. */
  width: (t: number) => number;
  tone: (t: number) => number;
  warm: number;
  wood: number;
  opacity: number;
};

/**
 * Flood the colour channels outward into transparent pixels.
 *
 * Bilinear filtering and every mip level below the top blend colour across the
 * cut-out boundary, so a leaf whose neighbours are transparent black picks up
 * a dark fringe that reads as soot along every edge — on foliage, which is
 * nothing *but* edge, that is the difference between leaves and grime.
 */
function dilate(raster: Raster, passes: number) {
  const { size, alpha, tone, warm, wood } = raster;
  const filled = Float32Array.from(alpha);
  for (let pass = 0; pass < passes; pass++) {
    const before = Float32Array.from(filled);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (before[i] > 0.01) continue;
        let bestTone = 0;
        let bestWarm = 0;
        let bestWood = 0;
        let weight = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= size) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= size) continue;
            const j = ny * size + nx;
            if (before[j] <= 0.01) continue;
            bestTone += tone[j];
            bestWarm += warm[j];
            bestWood += wood[j];
            weight++;
          }
        }
        if (weight === 0) continue;
        tone[i] = bestTone / weight;
        warm[i] = bestWarm / weight;
        wood[i] = bestWood / weight;
        filled[i] = 0.02;
      }
    }
  }
}

function toTexture(data: Uint8ClampedArray, size: number): THREE.CanvasTexture {
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  const ctx = element.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// The leaf atlas
// ---------------------------------------------------------------------------

export const LEAF_ATLAS_COLS = 4;
export const LEAF_ATLAS_ROWS = 4;

/**
 * Which family of sprays a species hangs on its twigs.
 *
 * Six of them, because at a hundred metres the only thing separating an oak
 * from a birch is the shape and density of its leaf mass, and one generic
 * blob-of-green cell would throw that away.
 */
export type LeafKind = "broad" | "needle" | "small" | "long" | "blossom";

const KIND_CELLS: Record<LeafKind, readonly number[]> = {
  broad: [0, 1, 2, 3],
  needle: [4, 5, 6, 7],
  small: [8, 9, 10, 11],
  long: [12, 13],
  blossom: [14, 15],
};

/** Picks one of a kind's cells. `variant` may be any integer. */
export function leafCell(kind: LeafKind, variant: number): number {
  const cells = KIND_CELLS[kind];
  return cells[((variant % cells.length) + cells.length) % cells.length];
}

/**
 * `[u0, v0, u1, v1]` for a cell, already inset.
 *
 * The inset is not cosmetic. Mip level three of a four-by-four atlas is one
 * texel per cell, and without a transparent gutter that texel is an average of
 * two different sprays bleeding into each other.
 */
export function leafCellUv(cell: number): [number, number, number, number] {
  const col = cell % LEAF_ATLAS_COLS;
  const row = Math.floor(cell / LEAF_ATLAS_COLS) % LEAF_ATLAS_ROWS;
  const w = 1 / LEAF_ATLAS_COLS;
  const h = 1 / LEAF_ATLAS_ROWS;
  const inset = 0.012;
  const u0 = col * w + inset;
  const u1 = (col + 1) * w - inset;
  // The canvas is written top-down and uploaded with three's default flipY, so
  // canvas row 0 is v = 1.
  const v1 = 1 - row * h - inset;
  const v0 = 1 - (row + 1) * h + inset;
  return [u0, v0, u1, v1];
}

type SprayRecipe = {
  /** Leaves on the spray. */
  leaves: number;
  /** Length and half-width of one leaf, in cell units. */
  leafLength: number;
  leafWidth: number;
  /** How far the leaf blade bends over its own length, radians. */
  leafCurve: number;
  /** Blade profile exponent: 1 = ovate, 2.2 = lanceolate, 4 = needle. */
  taper: number;
  /** Non-zero puts an oak-ish lobed edge on the blade. */
  lobes: number;
  /** Angle from the twig, radians. */
  spread: number;
  /** How far the spray's own stem leans and how long it is. */
  stemLength: number;
  stemCurve: number;
  stemWidth: number;
  /** Extra side twigs off the stem. */
  twigs: number;
  /** Luminance spread between the leaves of one spray. */
  toneSpread: number;
  /** Blossom / fruit dots. */
  flowers: number;
  flowerWarm: number;
  /** How hard the noise tears the blade edges. */
  erosion: number;
};

const RECIPES: Record<LeafKind, SprayRecipe> = {
  // Oak, chestnut: few big lobed blades, alternate up a stout stem.
  broad: {
    leaves: 9,
    leafLength: 0.3,
    leafWidth: 0.075,
    leafCurve: 0.5,
    taper: 1.05,
    lobes: 5,
    spread: 1.02,
    stemLength: 0.62,
    stemCurve: 0.18,
    stemWidth: 0.009,
    twigs: 2,
    toneSpread: 0.4,
    flowers: 0,
    flowerWarm: 0,
    erosion: 0.55,
  },
  // Pine: a fascicle. Many stiff needles fanned forward off one shoot.
  needle: {
    leaves: 34,
    leafLength: 0.36,
    leafWidth: 0.013,
    leafCurve: 0.42,
    taper: 3.4,
    lobes: 0,
    spread: 0.66,
    stemLength: 0.72,
    stemCurve: 0.1,
    stemWidth: 0.007,
    twigs: 1,
    toneSpread: 0.34,
    flowers: 0,
    flowerWarm: 0,
    erosion: 0.22,
  },
  // Birch: small toothed blades, a lot of them, on a whippy drooping shoot.
  small: {
    leaves: 17,
    leafLength: 0.17,
    leafWidth: 0.052,
    leafCurve: 0.6,
    taper: 1.35,
    lobes: 9,
    spread: 1.16,
    stemLength: 0.7,
    stemCurve: 0.42,
    stemWidth: 0.006,
    twigs: 3,
    toneSpread: 0.46,
    flowers: 0,
    flowerWarm: 0,
    erosion: 0.6,
  },
  // Willow: long lanceolate leaves hanging almost straight down the shoot.
  long: {
    leaves: 19,
    leafLength: 0.4,
    leafWidth: 0.023,
    leafCurve: 0.72,
    taper: 2.4,
    lobes: 0,
    spread: 0.42,
    stemLength: 0.84,
    stemCurve: 0.16,
    stemWidth: 0.006,
    twigs: 1,
    toneSpread: 0.38,
    flowers: 0,
    flowerWarm: 0,
    erosion: 0.38,
  },
  // Apple: round leaves with blossom among them.
  blossom: {
    leaves: 11,
    leafLength: 0.22,
    leafWidth: 0.072,
    leafCurve: 0.44,
    taper: 0.85,
    lobes: 0,
    spread: 1.1,
    stemLength: 0.58,
    stemCurve: 0.22,
    stemWidth: 0.008,
    twigs: 2,
    toneSpread: 0.42,
    flowers: 5,
    flowerWarm: 1,
    erosion: 0.45,
  },
};

function kindOfCell(cell: number): LeafKind {
  for (const kind of Object.keys(RECIPES) as LeafKind[]) {
    if (KIND_CELLS[kind].includes(cell)) return kind;
  }
  return "broad";
}

function drawSpray(raster: Raster, frame: Frame, cell: number, seed: number) {
  const kind = kindOfCell(cell);
  const r = RECIPES[kind];
  const rng = (a: number, b: number) => hash2(cell * 7919 + a + seed, b * 31 + seed);

  // Variants of one kind differ in how far the shoot leans and how loaded it
  // is, so four cells of "broad" are four sprays rather than four copies.
  const variant = cell % 4;
  const lean = (rng(1, 2) - 0.5) * 0.7;
  const load = 0.78 + rng(3, 4) * 0.44;
  const stemLength = r.stemLength * (0.88 + variant * 0.06);
  const stemCurve = r.stemCurve * (rng(5, 6) - 0.5) * 2;

  // The whole spray grows from the bottom-middle of the cell: the quad that
  // uses it has v = 0 at the branch and v = 1 at the tip, so this is the only
  // orientation that lets a cluster point away from the twig it hangs on.
  const rootX = 0.5;
  const rootY = 0.06;

  raster.stroke(frame, {
    x: rootX,
    y: rootY,
    angle: lean * 0.5,
    curve: stemCurve,
    length: stemLength,
    width: (t) => r.stemWidth * (1 - t * 0.8),
    tone: () => 0.42,
    warm: 0.85,
    wood: 1,
    opacity: 1,
  });

  // Where the stem actually ended up, resampled the same way the stroke
  // marched it, so leaves attach to the twig instead of hovering beside it.
  const stemAt = (t: number) => {
    const steps = 24;
    let x = rootX;
    let y = rootY;
    const ds = (stemLength * t) / steps;
    for (let i = 0; i < steps; i++) {
      const u = (i / steps) * t;
      const heading = lean * 0.5 + stemCurve * u * u;
      x += Math.sin(heading) * ds;
      y += Math.cos(heading) * ds;
    }
    return { x, y, heading: lean * 0.5 + stemCurve * t * t };
  };

  for (let i = 0; i < r.twigs; i++) {
    const t = 0.3 + (i / Math.max(1, r.twigs)) * 0.5;
    const at = stemAt(t);
    const side = i % 2 === 0 ? 1 : -1;
    raster.stroke(frame, {
      x: at.x,
      y: at.y,
      angle: at.heading + side * 0.62,
      curve: -side * 0.4,
      length: stemLength * 0.34,
      width: (u) => r.stemWidth * 0.7 * (1 - u * 0.85),
      tone: () => 0.4,
      warm: 0.85,
      wood: 1,
      opacity: 1,
    });
  }

  const count = Math.max(3, Math.round(r.leaves * load));
  for (let i = 0; i < count; i++) {
    // Golden angle along the shoot: alternate leaves never line up into rows.
    const t = 0.14 + (i / count) * 0.82;
    const at = stemAt(t);
    const side = i % 2 === 0 ? 1 : -1;
    const jitter = rng(i * 3 + 11, i * 5 + 13);
    const jitter2 = rng(i * 7 + 17, i * 11 + 19);

    // Leaves shorten toward the tip of the shoot; the whole spray tapers.
    const scale = (1 - t * 0.34) * (0.76 + jitter * 0.5);
    const angle =
      at.heading +
      side * r.spread * (0.62 + jitter2 * 0.72) +
      (kind === "long" ? Math.PI * 0.42 * side : 0);
    const length = r.leafLength * scale;
    const halfWidth = r.leafWidth * scale;

    // Every leaf in the spray has its own luminance. This is half of what
    // stops a crown being one flat wash of green: the other half is the
    // per-cluster and per-instance spread the mesh applies on top.
    const tone = 0.78 + (jitter - 0.5) * r.toneSpread * 2 + t * 0.16;
    const warm = (jitter2 - 0.35) * 0.5 + t * 0.2;

    raster.stroke(frame, {
      x: at.x,
      y: at.y,
      angle,
      // Blades curl back toward the light; a straight one reads as a shard.
      curve: -side * r.leafCurve * (0.7 + jitter * 0.7),
      length,
      width: (u) => {
        const profile = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.78)), 1 / r.taper);
        const lobe =
          r.lobes > 0 ? 0.74 + 0.26 * Math.abs(Math.cos(u * r.lobes * Math.PI)) : 1;
        return halfWidth * profile * lobe;
      },
      tone: (u) => tone * (0.9 + u * 0.18),
      warm,
      wood: 0,
      opacity: 1,
    });
  }

  for (let i = 0; i < r.flowers; i++) {
    const t = 0.24 + (i / Math.max(1, r.flowers)) * 0.66;
    const at = stemAt(t);
    const jitter = rng(i * 13 + 41, i * 17 + 43);
    const radius = 0.028 * (0.7 + jitter * 0.7);
    raster.blob(
      frame,
      at.x + (jitter - 0.5) * 0.1,
      at.y + (rng(i, 7) - 0.5) * 0.08,
      radius,
      radius,
      1.34,
      r.flowerWarm
    );
  }
}

/**
 * Sixteen leaf sprays, one texture.
 *
 * The mesh supplies the colour, so this is written near-white with only the
 * per-leaf luminance and a small hue push in it. One atlas therefore serves
 * every species, every season and every instance tint, which is what keeps the
 * whole canopy on one material and one draw per level of detail.
 */
export function makeLeafAtlas(size = 512, seed = 17): THREE.CanvasTexture {
  const raster = new Raster(size);
  const cell = 1 / LEAF_ATLAS_COLS;
  // Nine tenths of the cell, centred: the remaining tenth is the gutter that
  // keeps neighbouring sprays out of each other's mip levels.
  const draw = cell * 0.9;

  for (let c = 0; c < LEAF_ATLAS_COLS * LEAF_ATLAS_ROWS; c++) {
    const col = c % LEAF_ATLAS_COLS;
    const row = Math.floor(c / LEAF_ATLAS_COLS);
    drawSpray(
      raster,
      {
        ox: col * cell + (cell - draw) * 0.5,
        // Frame origin is the cell's *bottom* in y-up image space.
        oy: 1 - (row + 1) * cell + (cell - draw) * 0.5,
        scale: draw,
      },
      c,
      seed
    );
  }

  const tear = fbm(size, seed * 31 + 5, 4, 14);
  const grain = valueNoise(size, Math.max(8, Math.round(size / 6)), seed * 71 + 9);
  const data = new Uint8ClampedArray(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    const wood = raster.wood[i];
    let alpha = raster.alpha[i];
    if (alpha > 0 && wood < 0.5) {
      // Tear the blade edges. Only the edges: the erosion is weighted by how
      // close to the boundary the pixel already is, so the middle of a leaf
      // stays solid and the outline goes ragged, which is the way round that
      // reads as foliage rather than as moth damage.
      const kind = 0.35 + tear[i] * 0.95 + grain[i] * 0.28;
      alpha *= smoothstep(0.42, 0.86, kind * 0.55 + alpha * 0.75);
    }
    if (alpha <= 0.004) alpha = 0;

    const tone = raster.tone[i];
    const warm = raster.warm[i];
    const lit = wood > 0.5 ? tone : tone * (0.92 + grain[i] * 0.2);
    data[i * 4] = 255 * clamp01(lit * (1 + warm * 0.2));
    data[i * 4 + 1] = 255 * clamp01(lit * (1 - Math.max(0, warm) * 0.06));
    data[i * 4 + 2] = 255 * clamp01(lit * (1 - warm * 0.26));
    data[i * 4 + 3] = 255 * clamp01(alpha);
  }

  // Colour bleed outward before upload; alpha is untouched.
  const bleed = new Raster(size);
  for (let i = 0; i < size * size; i++) {
    bleed.alpha[i] = data[i * 4 + 3] / 255;
    bleed.tone[i] = data[i * 4] / 255;
    bleed.warm[i] = data[i * 4 + 1] / 255;
    bleed.wood[i] = data[i * 4 + 2] / 255;
  }
  dilate(bleed, 3);
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4 + 3] > 2) continue;
    data[i * 4] = 255 * bleed.tone[i];
    data[i * 4 + 1] = 255 * bleed.warm[i];
    data[i * 4 + 2] = 255 * bleed.wood[i];
  }

  const texture = toTexture(data, size);
  // Clamped, because it is an atlas: a UV that rounded past a cell edge under
  // wrapping would fetch the spray on the far side of the texture.
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

// ---------------------------------------------------------------------------
// Backlight
// ---------------------------------------------------------------------------

export type TranslucencyOptions = {
  /** Transmitted colour — warmer and more saturated than the diffuse leaf. */
  colour: Rgb;
  /** Peak strength of the view-aligned transmission. */
  strength: number;
  /** How tightly the effect gathers around the sun. Higher = tighter. */
  viewPower: number;
  /** How much the surface must be edge-on to the sun. Higher = rim only. */
  edgePower: number;
  /**
   * A floor that does not depend on where the camera is looking.
   *
   * Light through a leaf does not switch off when you turn away from the sun,
   * it only stops being the brightest thing in the frame. Without this the
   * shaded side of every crown goes to a flat dead green the moment the sun
   * leaves the shot.
   */
  wrap: number;
};

const SUN = ghibliSunDirection();

/**
 * The single strongest realism cue available to a canopy in this scene.
 *
 * The sun here sits 13.5° over the horizon, which means nearly every tree in
 * the valley is being lit from behind or from the side and almost none from
 * the front. Diffuse shading answers the wrong question for that geometry: it
 * asks how much light *bounces off* a leaf, when what the eye is reading is how
 * much comes *through* one. The transmitted term is strongest exactly where the
 * diffuse term is weakest — leaves turned edge-on to the sun, seen by a viewer
 * looking into it — so adding it does not brighten the tree so much as invert
 * which parts of it glow, and that inversion is what a photograph of a tree at
 * five in the afternoon looks like.
 *
 * Composed on top of whatever `decorateFlora` already installed, so the wind
 * displacement and the per-instance tint survive.
 */
export function decorateTranslucency(
  material: THREE.Material,
  options: TranslucencyOptions,
  cacheKey: string,
  sunDirection: [number, number, number] = SUN
) {
  const previous = material.onBeforeCompile;
  const sun = new THREE.Vector3(...sunDirection).normalize();
  const transmit = new THREE.Color(
    options.colour[0],
    options.colour[1],
    options.colour[2]
  );

  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);

    shader.uniforms.uSunDir = { value: sun };
    shader.uniforms.uLeafTransmit = { value: transmit };

    // A per-vertex weight, so the twigs and the inner mass do not glow like
    // the leaf edges do. Absent on a geometry that never sets it, in which
    // case WebGL supplies zero and the term vanishes — which is the correct
    // default for bark.
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float aFoliage;
         varying float vFoliage;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vFoliage = aFoliage;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform vec3 uSunDir;
         uniform vec3 uLeafTransmit;
         varying float vFoliage;`
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
         {
           // Both vectors in view space: three hands the fragment shader the
           // view-space normal already, and rotating one uniform is cheaper
           // than carrying a world-space normal varying for every leaf.
           vec3 sunView = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
           vec3 toEye = normalize( vViewPosition );
           // Looking into the sun.
           float facing = max( dot( toEye, -sunView ), 0.0 );
           // Edge-on to the sun: a leaf square to it transmits nothing.
           float edgeOn = 1.0 - abs( dot( normal, sunView ) );
           float through = pow( facing, ${options.viewPower.toFixed(2)} )
             * pow( edgeOn, ${options.edgePower.toFixed(2)} );
           // Wrapped ambient: the shaded half of a leaf still sees skylight.
           float wrapped = max( 0.5 - dot( normal, sunView ) * 0.5, 0.0 );
           // Tinted toward the transmitted colour but never wholly to it, so a
           // per-instance or per-leaf tint still shows through the glow.
           float lum = dot( diffuseColor.rgb, vec3( 0.32, 0.52, 0.16 ) );
           vec3 tint = mix( diffuseColor.rgb, uLeafTransmit * ( 0.42 + lum ), 0.76 );
           reflectedLight.indirectDiffuse += tint * vFoliage * (
             through * ${options.strength.toFixed(3)}
             + wrapped * wrapped * ${options.wrap.toFixed(3)}
           );
         }`
      );
  };

  // three keys its program cache on the *source text* of `onBeforeCompile`,
  // which is identical for every material this function decorates — without an
  // explicit key they would all share the first compiled program.
  material.customProgramCacheKey = () => cacheKey;
  material.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Far level of detail
// ---------------------------------------------------------------------------

/**
 * Crown outlines, at a hundred metres.
 *
 * The only job of these is to be recognisable in silhouette, because that is
 * all a tree is at this distance — five pixels of shape against the sky.
 */
export type CanopyForm = "spire" | "dome" | "column" | "weep" | "open" | "bare";

export type CanopyBillboardShape = {
  form: CanopyForm;
  /** Bare trunk height and base half-width, 0..1 of the card. */
  trunk: number;
  trunkWidth: number;
  /** Primary limbs drawn into the skeleton. */
  boughs: number;
  /** Leaf puffs scattered over the crown envelope. */
  puffs: number;
  /** Puff radius range, 0..1 of the card. */
  puffRadius: [number, number];
  /** Crown half-width at its widest, 0..1 of the card. */
  spread: number;
  leaf: Rgb;
  leafDark: Rgb;
  /** Backlit rim — where the crown's outline is one leaf thick. */
  leafSun: Rgb;
  bark: Rgb;
  barkDark: Rgb;
};

/** Normalised crown half-width at height `v` within the crown, 0..1. */
function envelope(form: CanopyForm, t: number): number {
  switch (form) {
    // A fir narrows all the way to a point and flares at the skirt.
    case "spire":
      return Math.pow(1 - t, 0.78) * (0.85 + 0.15 * Math.sin(t * 9));
    // Broad and heavy, widest a little below the middle.
    case "dome":
      return Math.sin(Math.PI * (0.18 + t * 0.76)) * (1 - t * 0.12);
    // Birch: tall, narrow, and it keeps its width most of the way up.
    case "column":
      return Math.sin(Math.PI * (0.3 + t * 0.62)) * 0.94;
    // Willow: wide at the shoulders, curtain hanging below.
    case "weep":
      return Math.sin(Math.PI * (0.1 + t * 0.82)) * (1.02 - t * 0.2);
    // Orchard: small, round, and open enough to see through.
    case "open":
      return Math.sin(Math.PI * (0.22 + t * 0.7));
    case "bare":
      return 0;
  }
  return 0;
}

/**
 * A whole tree, drawn flat.
 *
 * Rebuilt out of the same ingredients as the near mesh — a branch skeleton, a
 * scatter of leaf clusters over a species envelope, and a warm rim where the
 * crown thins to one leaf — because the level-of-detail swap is only invisible
 * if both levels were built from the same description of the tree. The old
 * version drew five big overlapping discs, which made a clean oval outline,
 * and a clean oval outline is the thing the near mesh no longer has.
 */
export function makeCanopyBillboard(
  shape: CanopyBillboardShape,
  size = 224,
  seed = 11
): THREE.CanvasTexture {
  const raster = new Raster(size);
  const frame: Frame = { ox: 0, oy: 0, scale: 1 };
  const rng = (a: number, b: number) => hash2(seed * 7717 + a, b * 53 + seed);

  const crownBase = shape.form === "spire" ? shape.trunk * 0.9 : shape.trunk;
  const crownTop = shape.form === "spire" ? 0.99 : 0.94;
  const crownHeight = Math.max(0.05, crownTop - crownBase);

  // --- skeleton ------------------------------------------------------------
  //
  // Drawn first and allowed to keep any pixel a leaf does not cover more
  // strongly, so limbs stay visible through the gaps in the crown. On the bare
  // species it is the whole picture.
  raster.stroke(frame, {
    x: 0.5,
    y: 0,
    angle: (rng(1, 2) - 0.5) * 0.12,
    curve: (rng(3, 4) - 0.5) * 0.3,
    length: crownBase + crownHeight * (shape.form === "spire" ? 0.98 : 0.42),
    width: (t) => shape.trunkWidth * Math.pow(1 - t, 0.85),
    tone: (t) => 0.72 + t * 0.2,
    warm: 0.55,
    wood: 1,
    opacity: 1,
  });

  const limbs = shape.form === "bare" ? shape.boughs + 2 : shape.boughs;
  for (let i = 0; i < limbs; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const t = 0.12 + (i / Math.max(1, limbs)) * 0.74;
    const from = crownBase * (0.62 + t * 0.42);
    const reach = shape.spread * (shape.form === "bare" ? 0.9 : 0.78) * (0.6 + rng(i * 5, 7) * 0.6);
    const angle = side * (0.5 + rng(i * 3, 11) * 0.55) + (1 - t) * side * 0.25;
    raster.stroke(frame, {
      x: 0.5 + side * shape.trunkWidth * 0.4,
      y: from,
      angle,
      curve: -side * 0.55,
      length: reach,
      width: (u) => shape.trunkWidth * 0.5 * Math.pow(1 - u, 0.9),
      tone: (u) => 0.66 + u * 0.16,
      warm: 0.55,
      wood: 1,
      opacity: 1,
    });

    // One order of secondaries. Two is invisible at this size; none makes the
    // bare species read as a pitchfork.
    const forks = shape.form === "bare" ? 3 : 1;
    for (let f = 0; f < forks; f++) {
      const at = 0.45 + f * 0.22;
      const fx = 0.5 + Math.sin(angle) * reach * at;
      const fy = from + Math.cos(angle) * reach * at;
      const fs = f % 2 === 0 ? side : -side;
      raster.stroke(frame, {
        x: fx,
        y: fy,
        angle: angle + fs * 0.7,
        curve: -fs * 0.5,
        length: reach * 0.52,
        width: (u) => shape.trunkWidth * 0.26 * Math.pow(1 - u, 0.9),
        tone: (u) => 0.62 + u * 0.16,
        warm: 0.55,
        wood: 1,
        opacity: 1,
      });
    }
  }

  // --- crown ---------------------------------------------------------------
  for (let i = 0; i < shape.puffs; i++) {
    // Stratified up the crown so a low puff count still spans it, then jittered
    // so the strata do not read as stripes.
    const strat = (i + rng(i * 7, 13)) / shape.puffs;
    const t = clamp01(strat);
    const v = crownBase + t * crownHeight;
    const half = envelope(shape.form, t) * shape.spread;
    if (half <= 0) break;

    // Across the silhouette, biased outward: the outer half of the projected
    // disc is most of what the eye sees, and puffs piled on the axis just
    // thicken a middle that is already opaque.
    const across = rng(i * 11, 17) * 2 - 1;
    const push = Math.sign(across) * Math.pow(Math.abs(across), 0.62);
    const u = 0.5 + push * half;

    const size0 = shape.puffRadius[0];
    const size1 = shape.puffRadius[1];
    const radius =
      lerp(size1, size0, t * 0.7 + Math.abs(push) * 0.3) *
      (0.7 + rng(i * 13, 19) * 0.6);

    // Weeping species trail their puffs downward under the shoulders.
    const drop =
      shape.form === "weep" ? Math.abs(push) * crownHeight * 0.42 * rng(i * 17, 23) : 0;

    raster.blob(
      frame,
      u,
      v - drop,
      radius * (shape.form === "weep" ? 0.78 : 1),
      radius * (shape.form === "spire" ? 0.62 : shape.form === "weep" ? 1.5 : 0.92),
      0.8 + rng(i * 19, 29) * 0.44,
      (rng(i * 23, 31) - 0.4) * 0.4
    );
  }

  // --- resolve -------------------------------------------------------------
  const tear = fbm(size, seed * 91 + 7, 4, 9);
  const grain = valueNoise(size, Math.max(10, Math.round(size / 4)), seed * 43 + 3);
  const data = new Uint8ClampedArray(size * size * 4);
  let maxDepth = 0;
  for (let i = 0; i < size * size; i++) {
    if (raster.wood[i] < 0.5 && raster.depth[i] > maxDepth) maxDepth = raster.depth[i];
  }
  const depthScale = 1 / Math.max(1, maxDepth * 0.55);

  for (let i = 0; i < size * size; i++) {
    const wood = raster.wood[i] > 0.5;
    let alpha = raster.alpha[i];
    let r = 0;
    let g = 0;
    let b = 0;

    if (alpha > 0 && !wood) {
      // Erode the outline hard and the interior barely at all. The puff
      // scatter already gives a bumpy edge; this turns the bumps into leaves.
      const bite = tear[i] * 0.66 + grain[i] * 0.34;
      alpha = smoothstep(0.34, 0.62, alpha * 0.72 + bite * 0.46);

      // Stacked puffs are the inside of the crown and sit in its own shadow.
      const buried = clamp01(raster.depth[i] * depthScale);
      // One puff deep and on the outline: this is the leaf the sun shines
      // through, and it is the brightest thing on the whole card.
      const rim = smoothstep(0.55, 0.06, raster.alpha[i]) * (1 - buried * 0.75);
      // Height on the card is the key light: the top of a crown faces the sky
      // and the underside of it faces the ground.
      const v = 1 - Math.floor(i / size) / (size - 1);
      const key = 0.34 + v * 0.62 + raster.tone[i] * 0.34;
      const shade = lerp(1, 0.42, buried) * key;

      let cr = lerp(shape.leafDark[0], shape.leaf[0], clamp01(shade));
      let cg = lerp(shape.leafDark[1], shape.leaf[1], clamp01(shade));
      let cb = lerp(shape.leafDark[2], shape.leaf[2], clamp01(shade));
      cr = lerp(cr, shape.leafSun[0], rim * 0.72);
      cg = lerp(cg, shape.leafSun[1], rim * 0.72);
      cb = lerp(cb, shape.leafSun[2], rim * 0.72);

      const warm = raster.warm[i];
      r = cr * (1 + warm * 0.16) * 255;
      g = cg * 255;
      b = cb * (1 - warm * 0.2) * 255;
    } else if (wood) {
      const tone = raster.tone[i] * (0.82 + grain[i] * 0.36);
      r = lerp(shape.barkDark[0], shape.bark[0], clamp01(tone)) * 255;
      g = lerp(shape.barkDark[1], shape.bark[1], clamp01(tone)) * 255;
      b = lerp(shape.barkDark[2], shape.bark[2], clamp01(tone)) * 255;
      alpha = Math.min(1, alpha * 1.6);
    }

    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255 * clamp01(alpha);
  }

  const bleed = new Raster(size);
  bleed.alpha.set(raster.alpha);
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4 + 3] < 3) bleed.alpha[i] = 0;
    bleed.tone[i] = data[i * 4] / 255;
    bleed.warm[i] = data[i * 4 + 1] / 255;
    bleed.wood[i] = data[i * 4 + 2] / 255;
  }
  dilate(bleed, 3);
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4 + 3] > 2) continue;
    data[i * 4] = 255 * bleed.tone[i];
    data[i * 4 + 1] = 255 * bleed.warm[i];
    data[i * 4 + 2] = 255 * bleed.wood[i];
  }

  const texture = toTexture(data, size);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

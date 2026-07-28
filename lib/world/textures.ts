/**
 * Procedurally generated textures.
 *
 * Not a single image file is downloaded for the world. Every surface detail
 * here is drawn into a canvas at runtime and uploaded as a texture, which
 * keeps the hero scene at zero asset weight while still giving surfaces the
 * fine relief that separates "3D render" from "3D model".
 *
 * The normal maps matter most: without them, a terrain lit by a single sun is
 * a flat expanse of colour no matter how good the geometry is. The second most
 * important thing here is that every map is *tileable* — a seam repeating every
 * four metres across a 640-metre valley is more obvious than no texture at all.
 */

import * as THREE from "three";

function canvas(size: number) {
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  return element;
}

/**
 * Integer hash -> [0, 1). The same one `terrain.ts` uses, for the same reason.
 *
 * `Math.imul` is load-bearing: a plain `*` on these constants produces results
 * past 2^53, so the float silently drops its low bits — and those low bits are
 * the entire output of a hash. Written with `*` this returns a mean of 0.25
 * with a third of the expected spread, which here would bias every feature
 * point in the Voronoi fields into one corner of every cell.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Seeded, tileable value noise on a grid.
 */
function noiseField(size: number, cells: number, seed: number): Float32Array {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) {
    let h = Math.imul(i + seed * 9781, 374761393);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    grid[i] = ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  const field = new Float32Array(size * size);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const fy = y * scale;
      const x0 = Math.floor(fx) % cells;
      const y0 = Math.floor(fy) % cells;
      const x1 = (x0 + 1) % cells;
      const y1 = (y0 + 1) % cells;
      const tx = fx - Math.floor(fx);
      const ty = fy - Math.floor(fy);
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);

      const a = grid[y0 * cells + x0];
      const b = grid[y0 * cells + x1];
      const c = grid[y1 * cells + x0];
      const d = grid[y1 * cells + x1];
      field[y * size + x] =
        a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
    }
  }
  return field;
}

/**
 * Every map below is built out of a handful of these, and several of them want
 * the same one. Generating a 512² five-octave stack is about twelve million
 * operations, so the difference between sharing them and not is most of the
 * texture budget for the whole scene.
 *
 * Callers must treat the result as immutable — it is genuinely the same array.
 */
const fieldCache = new Map<string, Float32Array>();

function cached(key: string, build: () => Float32Array): Float32Array {
  const hit = fieldCache.get(key);
  if (hit) return hit;
  const made = build();
  fieldCache.set(key, made);
  return made;
}

/** Stacked octaves of `noiseField`, tileable. */
function fractalField(size: number, seed: number, octaves = 5): Float32Array {
  return cached(`f:${size}:${seed}:${octaves}`, () => {
    const out = new Float32Array(size * size);
    let amplitude = 1;
    let cells = 4;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      const layer = noiseField(size, cells, seed + o * 71);
      for (let i = 0; i < out.length; i++) out[i] += layer[i] * amplitude;
      total += amplitude;
      amplitude *= 0.52;
      cells *= 2;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  });
}

/**
 * Tileable Worley noise, returned as the gap between the nearest and second
 * nearest feature point.
 *
 * That difference is near zero exactly on the boundary between two cells and
 * rises away from it, which draws the *crack* rather than the cell — and cracks
 * are the whole reason rock reads as rock. Fractal noise can give you lumps and
 * grain but it cannot give you a straight-sided fracture, because there is no
 * straight-sided anything in a sum of smooth functions.
 */
function worleyCracks(size: number, cells: number, seed: number): Float32Array {
  return cached(`w:${size}:${cells}:${seed}`, () => {
    const out = new Float32Array(size * size);
    const step = size / cells;

    for (let y = 0; y < size; y++) {
      const cy = Math.floor(y / step);
      for (let x = 0; x < size; x++) {
        const cx = Math.floor(x / step);

        let first = Infinity;
        let second = Infinity;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            // Wrapped cell coordinates, so the field tiles seamlessly.
            const gx = (cx + ox + cells) % cells;
            const gy = (cy + oy + cells) % cells;
            const fx = (cx + ox + hash2(gx + seed, gy * 31 + seed)) * step;
            const fy = (cy + oy + hash2(gx * 17 + seed, gy + seed * 3)) * step;
            const d = Math.hypot(x - fx, y - fy);
            if (d < first) {
              second = first;
              first = d;
            } else if (d < second) {
              second = d;
            }
          }
        }

        out[y * size + x] = Math.min(1, (second - first) / step);
      }
    }
    return out;
  });
}

/**
 * Converts a height field into a tangent-space normal map via central
 * differences. `strength` scales how pronounced the relief reads under light.
 */
function heightToNormal(
  field: Float32Array,
  size: number,
  strength: number
): THREE.CanvasTexture {
  const element = canvas(size);
  const ctx = element.getContext("2d")!;
  const image = ctx.createImageData(size, size);

  const at = (x: number, y: number) =>
    field[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;

      // Normalise (-dx, -dy, 1) and pack into 0..255.
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      image.data[i] = ((-dx / length) * 0.5 + 0.5) * 255;
      image.data[i + 1] = ((-dy / length) * 0.5 + 0.5) * 255;
      image.data[i + 2] = (1 / length) * 0.5 * 255 + 127;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Packs a field into a greyscale texture, remapped into [low, high]. */
function fieldToGreyscale(
  field: Float32Array,
  size: number,
  low: number,
  high: number
): THREE.CanvasTexture {
  const element = canvas(size);
  const ctx = element.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const value = (low + field[i] * (high - low)) * 255;
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Uploads an RGBA buffer, already written by the caller. */
function toTexture(
  data: Uint8ClampedArray,
  size: number,
  srgb: boolean
): THREE.CanvasTexture {
  const element = canvas(size);
  const ctx = element.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return texture;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

/**
 * Fine ground detail, multiplied over the terrain's vertex colours.
 *
 * Vertex colours alone can only vary as fast as the terrain grid — about one
 * value per metre at best, and one per five out in the far chunks — so a
 * hillside comes out as a single flat wash no matter how good the biome logic
 * is. This map adds the sub-metre mottling that ground actually has: clumps of
 * darker and lighter cover, a high-frequency fleck that reads as individual
 * blades once it's more than a few metres away, and thin lateral fibres.
 *
 * It is near-neutral in hue on purpose. It modulates whatever biome colour the
 * vertex beneath it carries — grass, dirt, sand, shingle or snow — rather than
 * tinting everything the same green.
 */
export function makeGroundDetailMap(size = 512): THREE.CanvasTexture {
  const clumps = fractalField(size, 53, 4);
  const fleck = noiseField(size, 168, 61);
  const streak = noiseField(size, 232, 97);
  // A separate coarse layer of bare patches — trodden ground, molehills, the
  // places cover has failed. Without something at this scale the mottling is
  // uniformly busy, which is its own kind of flat.
  const bare = fractalField(size, 311, 3);

  const data = new Uint8ClampedArray(size * size * 4);

  const at = (field: Float32Array, x: number, y: number) =>
    field[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;

      // Broad patches of thicker and thinner cover.
      const clump = 0.6 + clumps[i] * 0.7;

      // High-frequency speckle. This is what actually reads as individual
      // blades once the ground is more than a couple of metres away — no
      // amount of instanced geometry can reach that density.
      const speck = 0.8 + fleck[i] * 0.4;

      // Sampling with a squashed Y turns round noise into short fibres, which
      // is the direction ground cover lies in.
      const fibre = 0.86 + at(streak, x, Math.floor(y * 0.28)) * 0.28;

      // Worn patches. Squared, so most of the map is untouched and the bare
      // ground appears as occasional scuffs rather than an even wash.
      const worn = smoothstep(0.62, 0.92, bare[i]);

      const value = Math.max(0.18, Math.min(1, clump * speck * fibre));

      // More green in the lighter patches, more red in the darker ones — new
      // growth against dead thatch underneath — and the worn patches pushed
      // warm and pale, toward exposed soil.
      const warmth = 1 - value;
      const r = value * (236 + warmth * 36) + worn * 34;
      const g = value * 255 - worn * 6;
      const b = value * (220 - warmth * 22) - worn * 26;

      data[i * 4] = r;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
  }

  const texture = toTexture(data, size, true);
  texture.anisotropy = 8;
  return texture;
}

/**
 * Very low-frequency colour drift, tiled over roughly a hundred metres.
 *
 * The single loudest tell of a tiled ground texture is not the texture — it is
 * the *period*. Multiplying a second copy of the detail in at a wildly
 * different, non-harmonic scale destroys the period without adding a visible
 * pattern of its own, because the eye can only lock on to a repeat it sees
 * twice in one glance. Kept low-contrast and slightly hue-shifted so it reads
 * as damp ground and dry ground rather than as a stain.
 */
export function makeMacroVariationMap(size = 128): THREE.CanvasTexture {
  const broad = fractalField(size, 733, 4);
  const hue = fractalField(size, 907, 3);
  const data = new Uint8ClampedArray(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    const value = 0.72 + broad[i] * 0.56;
    const shift = (hue[i] - 0.5) * 0.16;
    data[i * 4] = value * (1 - shift) * 255;
    data[i * 4 + 1] = value * 255;
    data[i * 4 + 2] = value * (1 + shift * 0.6) * 255;
    data[i * 4 + 3] = 255;
  }

  return toTexture(data, size, true);
}

export type GroundTextures = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  dispose: () => void;
};

/**
 * Ground relief. Three scales combined: broad soil undulation, a fine
 * pebble/grit layer, and a lateral fibre grain — which together are what stop
 * close-up ground looking like a smoothly shaded plane when the bard walks
 * over it.
 */
export function makeGroundTextures(size = 512): GroundTextures {
  const coarse = fractalField(size, 17, 5);
  const grit = fractalField(size, 91, 3);
  const fibre = noiseField(size, 148, 233);

  const combined = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // The fibre layer is sampled with a squashed Y so its bumps run sideways,
      // the way flattened grass and cart ruts do.
      const lateral = fibre[(Math.floor(y * 0.3) % size) * size + x];
      combined[i] = coarse[i] * 0.62 + grit[i] * 0.26 + lateral * 0.12;
    }
  }

  const normalMap = heightToNormal(combined, size, 30);
  normalMap.anisotropy = 8;

  // Rougher in the hollows, slightly polished on the crests — the way trodden
  // earth actually wears.
  const roughnessMap = fieldToGreyscale(coarse, size, 0.68, 1);

  const map = makeGroundDetailMap(size);

  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

export type TerrainSurfaces = GroundTextures & {
  /** Angular fracture relief, blended in wherever the ground is bare rock. */
  rockNormalMap: THREE.Texture;
  /** Hundred-metre colour drift, multiplied in to kill the detail tile. */
  macroMap: THREE.Texture;
  /** Metres per tile of the detail maps, for the UVs the terrain bakes. */
  detailTile: number;
};

/**
 * Everything the terrain material samples.
 *
 * Grouped into one call because the terrain is the only consumer and the maps
 * have to agree about tiling: `detailTile` is baked into the mesh UVs, and the
 * shader derives every other scale from it.
 */
export function makeTerrainSurfaces(size = 512): TerrainSurfaces {
  const ground = makeGroundTextures(size);
  const rockNormalMap = makeRockNormalMap(Math.min(size, 256));
  const macroMap = makeMacroVariationMap(128);

  return {
    ...ground,
    rockNormalMap,
    macroMap,
    detailTile: 3.2,
    dispose: () => {
      ground.dispose();
      rockNormalMap.dispose();
      macroMap.dispose();
    },
  };
}

/**
 * Rock relief: fracture planes with grain between them.
 *
 * The cracks come from Worley, which is the only cheap way to get a straight
 * edge out of noise, and they are cut *down* into the surface rather than
 * blended with it — a crack that fades out is a crease, and stone doesn't
 * crease.
 */
export function makeRockNormalMap(size = 256): THREE.Texture {
  const cracks = worleyCracks(size, 9, 4211);
  const fine = worleyCracks(size, 26, 517);
  const grain = fractalField(size, 1201, 4);

  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i++) {
    // `smoothstep` on the crack gap turns the linear ramp away from a cell
    // boundary into a narrow groove with flat rock either side.
    const major = smoothstep(0, 0.24, cracks[i]);
    const minor = 0.55 + smoothstep(0, 0.4, fine[i]) * 0.45;
    field[i] = major * minor * 0.72 + grain[i] * 0.28;
  }

  const texture = heightToNormal(field, size, 46);
  texture.anisotropy = 8;
  return texture;
}

// ---------------------------------------------------------------------------
// Bark
// ---------------------------------------------------------------------------

/**
 * Bark relief: strongly stretched vertically, the way real bark runs, with
 * Worley fissures cut through it so a trunk has plates rather than corduroy.
 */
export function makeBarkTexture(size = 256): THREE.Texture {
  return barkFields(size).normalMap;
}

export type BarkTextures = {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  dispose: () => void;
};

const barkCache = new Map<number, BarkTextures>();

/**
 * Bark, as a full set.
 *
 * Cached and never disposed: it is a couple of 256² maps shared by every trunk
 * in the world, and a tree LOD swap must not be able to free a texture another
 * level is still bound to.
 */
export function barkFields(size = 256): BarkTextures {
  const hit = barkCache.get(size);
  if (hit) return hit;

  const grain = fractalField(size, 43, 4);
  // Deep vertical fissures. Sampled with a heavily squashed Y so the cells come
  // out as long slivers running up the trunk instead of round plates.
  const fissure = worleyCracks(size, 14, 88);

  const relief = new Float32Array(size * size);
  const albedo = new Uint8ClampedArray(size * size * 4);
  const rough = new Float32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const sy = Math.floor(y * 0.2) % size;
      const stretched = grain[sy * size + x] * 0.78 + grain[i] * 0.22;
      // The fissure field is read with the same vertical squash, which is what
      // turns Worley's round cells into bark plates.
      const crack = smoothstep(0, 0.3, fissure[sy * size + x]);

      const height = stretched * 0.45 + crack * 0.55;
      relief[i] = height;
      rough[i] = 1 - crack * 0.25;

      // Bark colour tracks the relief: the ridges are weathered pale grey, the
      // fissures hold shadow and damp and run much darker and browner.
      const lit = 0.34 + height * 0.66;
      albedo[i * 4] = lit * 150 + 26;
      albedo[i * 4 + 1] = lit * 128 + 22;
      albedo[i * 4 + 2] = lit * 104 + 20;
      albedo[i * 4 + 3] = 255;
    }
  }

  const normalMap = heightToNormal(relief, size, 40);
  normalMap.repeat.set(2, 5);
  normalMap.anisotropy = 4;

  const map = toTexture(albedo, size, true);
  map.repeat.set(2, 5);
  map.anisotropy = 4;

  const roughnessMap = fieldToGreyscale(rough, size, 0.7, 1);
  roughnessMap.repeat.set(2, 5);

  const set: BarkTextures = {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      /* shared for the lifetime of the page — see the note above */
    },
  };
  barkCache.set(size, set);
  return set;
}

// ---------------------------------------------------------------------------
// Foliage
// ---------------------------------------------------------------------------

/**
 * A leaf-mass alpha map, for the canopy shells.
 *
 * The single thing that separates a convincing tree from a lollipop is that
 * light gets *through* it. A solid canopy blob has a hard, closed silhouette
 * no amount of displacement fixes, because the eye reads the outline before it
 * reads the shape. Punching this through the shells with an alpha test breaks
 * the outline into leaves and lets the sky show between them, and because it is
 * an alpha *test* rather than blending, it costs one discard and no sorting.
 *
 * White RGB on purpose: the colour comes from the mesh, so one map serves every
 * species and season.
 */
export function makeFoliageAlpha(size = 256, seed = 5): THREE.CanvasTexture {
  const clusters = fractalField(size, seed * 131 + 3, 4);
  const detail = noiseField(size, 44, seed * 17 + 9);
  const fine = noiseField(size, 96, seed * 41 + 3);
  const veins = noiseField(size, 22, seed * 73 + 11);
  const shade = fractalField(size, seed * 211 + 61, 3);
  const data = new Uint8ClampedArray(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    // Broad leaf clumps, then a finer tear so the silhouette reads as foliage
    // instead of a soft cloud. Veins carve thin gaps through solid regions.
    const mass = clusters[i] * 0.52 + detail[i] * 0.3 + fine[i] * 0.18;
    const gap = smoothstep(0.42, 0.7, veins[i]);
    const alpha =
      smoothstep(0.34, 0.56, mass) * (0.55 + gap * 0.45) *
      smoothstep(0.22, 0.48, clusters[i] + fine[i] * 0.35);

    // A little baked variation in the leaf colour itself. Multiplied over the
    // mesh colour, so it darkens the leaves in the gaps between clusters —
    // which is where a real canopy is in its own shadow.
    const lit = 0.62 + shade[i] * 0.5 + fine[i] * 0.08;
    data[i * 4] = 255 * Math.min(1, lit * 0.96);
    data[i * 4 + 1] = 255 * Math.min(1, lit);
    data[i * 4 + 2] = 255 * Math.min(1, lit * 0.88);
    data[i * 4 + 3] = alpha * 255;
  }

  const texture = toTexture(data, size, true);
  texture.anisotropy = 4;
  return texture;
}

/**
 * A whole tree, drawn flat, for the far LOD.
 *
 * Two of these crossed at right angles is what lets the valley have thousands
 * of trees in it. It has to match the 3D silhouette closely enough that the
 * swap isn't a flicker, which means building it out of the same ingredients:
 * a tapered trunk, a set of canopy masses in the species' own arrangement, and
 * the same top-lit/bottom-shaded gradient the shells carry in vertex colour.
 */
export type BillboardShape = {
  /** Canopy masses, in 0..1 texture space: x, y (0 = base), radius. */
  blobs: Array<[number, number, number]>;
  /** Height of the bare trunk, 0..1. */
  trunk: number;
  /** Half-width of the trunk at the base, 0..1. */
  trunkWidth: number;
  /** Base foliage colour. */
  leaf: [number, number, number];
  /** Trunk colour. */
  bark: [number, number, number];
};

export function makeTreeBillboard(
  shape: BillboardShape,
  size = 192,
  seed = 11
): THREE.CanvasTexture {
  const erosion = fractalField(size, seed * 97 + 5, 4);
  const clump = fractalField(size, seed * 37 + 19, 3);
  const data = new Uint8ClampedArray(size * size * 4);

  for (let py = 0; py < size; py++) {
    // Texture space runs top-down; the shape is described bottom-up.
    const v = 1 - py / (size - 1);
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const i = (py * size + px) * 4;

      // --- canopy --------------------------------------------------------
      let cover = 0;
      let depth = 0;
      for (let b = 0; b < shape.blobs.length; b++) {
        const [bx, by, br] = shape.blobs[b];
        const d = Math.hypot(u - bx, v - by) / br;
        if (d >= 1) continue;
        const k = 1 - d;
        if (k > cover) cover = k;
        depth += k;
      }

      let alpha = 0;
      let r = 0;
      let g = 0;
      let b2 = 0;

      if (cover > 0) {
        // Erode the edge hard and the interior barely at all, so the silhouette
        // is leafy but the middle of the crown stays solid enough to read as
        // mass rather than lace.
        const bite = erosion[py * size + px] * 0.58 + clump[py * size + px] * 0.42;
        const edge = smoothstep(0, 0.38, cover);
        alpha = smoothstep(
          0.4,
          0.62,
          edge * 0.5 + bite * 0.42 + cover * 0.38
        );

        // Overlapping masses are the interior of the crown and sit in shadow;
        // height within the crown supplies the key light from above.
        const occlusion = 1 - Math.min(0.58, (depth - cover) * 0.38);
        const key = 0.58 + v * 0.62;
        const tone = occlusion * key * (0.78 + bite * 0.45);
        r = shape.leaf[0] * tone * 255;
        g = shape.leaf[1] * tone * 255;
        b2 = shape.leaf[2] * tone * 255;
      }

      // --- trunk ---------------------------------------------------------
      // Drawn after the canopy and allowed to win, because the lower trunk is
      // in front of the crown from any angle this billboard is seen from.
      const taper = shape.trunkWidth * (1 - v * 0.55);
      if (v < shape.trunk + 0.06 && Math.abs(u - 0.5) < taper) {
        const across = Math.abs(u - 0.5) / taper;
        const fade = 1 - smoothstep(shape.trunk - 0.05, shape.trunk + 0.06, v);
        const shadeAcross = 0.55 + (1 - across * across) * 0.65;
        const solid = fade * smoothstep(0.94, 0.72, across);
        if (solid > alpha * 0.4) {
          const tone = shadeAcross * (0.72 + v * 0.3);
          r = shape.bark[0] * tone * 255 * solid + r * (1 - solid);
          g = shape.bark[1] * tone * 255 * solid + g * (1 - solid);
          b2 = shape.bark[2] * tone * 255 * solid + b2 * (1 - solid);
          alpha = Math.max(alpha, solid);
        }
      }

      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b2;
      data[i + 3] = alpha * 255;
    }
  }

  const texture = toTexture(data, size, true);
  // Clamped: a billboard that wrapped would smear the far side of the crown
  // across the near side wherever a UV rounded past the edge.
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

/**
 * Water surface normals.
 *
 * Not plain fractal noise: real water is anisotropic. Wind drives a train of
 * long crests in one direction, and the capillary ripple sits across them at a
 * much finer scale. Summing a few phase-warped sine trains along two headings
 * and adding fractal chop on top gets that, and it is the difference between
 * water and cling film.
 */
export function makeWaterNormals(size = 256, seed = 7): THREE.Texture {
  const warp = fractalField(size, seed * 13 + 3, 3);
  const chop = fractalField(size, seed * 29 + 11, 4);
  const field = new Float32Array(size * size);

  // Integer wave numbers, so every train closes seamlessly across the tile.
  const trains: Array<[number, number, number]> = [
    [3, 1, 1],
    [5, 2, 0.55],
    [2, -3, 0.42],
    [9, 4, 0.2],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const v = y / size;
      // Warping the phase is what stops the trains reading as a plaid.
      const wu = u + (warp[i] - 0.5) * 0.12;
      const wv = v + (warp[(i + 3571) % (size * size)] - 0.5) * 0.12;

      let value = 0;
      let total = 0;
      for (const [kx, kz, amplitude] of trains) {
        value +=
          Math.sin((wu * kx + wv * kz) * Math.PI * 2) * 0.5 * amplitude + 0.5 * amplitude;
        total += amplitude;
      }
      field[i] = (value / total) * 0.72 + chop[i] * 0.28;
    }
  }

  const texture = heightToNormal(field, size, 14);
  texture.repeat.set(6, 6);
  texture.anisotropy = 4;
  return texture;
}

/**
 * Shoreline foam, in the UV frame of the foam ring: U runs along the shore, V
 * runs from open water (0) to dry land (1).
 *
 * Foam is filaments, not a gradient. The lacework comes from ridged noise —
 * `1 - |n|` has a sharp crest exactly where the noise crosses its midpoint, and
 * a crest is a filament. A smooth alpha ramp here reads as fog on the water.
 */
export function makeFoamTexture(size = 256): THREE.CanvasTexture {
  const lace = fractalField(size, 617, 4);
  const tear = fractalField(size, 811, 3);
  const data = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;

      // The band the wash actually occupies, densest just off the sand.
      const band = Math.sin(Math.min(1, Math.max(0, v)) * Math.PI) ** 1.3;

      const filament = 1 - Math.abs(lace[i] * 2 - 1);
      const mass = filament * filament * 0.7 + tear[i] * 0.3;
      const alpha = Math.max(0, Math.min(1, band * smoothstep(0.24, 0.72, mass) * 1.25));

      data[i * 4] = 255;
      data[i * 4 + 1] = 253;
      data[i * 4 + 2] = 250;
      data[i * 4 + 3] = alpha * 255;
    }
  }

  const texture = toTexture(data, size, true);
  // Wraps around the shore in U, clamps across the band in V — repeating across
  // V would put a second, phantom waterline on the dry side of the ring.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

/**
 * A soft cloud puff sprite.
 *
 * drei ships a `<Cloud>` component, but it fetches its texture from a CDN at
 * runtime — which would put an external network dependency in the hero and
 * break under a strict CSP or offline. Generating the puff here keeps the
 * scene self-contained.
 *
 * The alpha is a radial falloff multiplied by fractal noise, so edges are
 * wispy and torn rather than a clean circle.
 *
 * Deliberately not cached: `Atmosphere` owns and disposes what it gets back.
 */
export function makeCloudTexture(size = 128, seed = 3): THREE.Texture {
  const field = fractalField(size, seed, 4);
  const element = canvas(size);
  const ctx = element.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const centre = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const distance = Math.hypot(x - centre, y - centre) / centre;

      // Radial falloff, squared for a soft shoulder.
      const radial = Math.max(0, 1 - distance);
      const softness = radial * radial;
      // Noise erodes the edge; the +0.35 keeps the core solid.
      const alpha = Math.max(0, Math.min(1, softness * (field[i] + 0.35) * 1.9));

      image.data[i * 4] = 255;
      image.data[i * 4 + 1] = 255;
      image.data[i * 4 + 2] = 255;
      image.data[i * 4 + 3] = alpha * 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

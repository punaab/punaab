/**
 * The shape of Punaab's world.
 *
 * One height function is the single source of truth here. The terrain mesh,
 * every tree, rock and grass blade, every building footprint, the bard's
 * footing, and the camera's collision all sample `heightAt()`. If they each had
 * their own idea of where the ground was, things would float and sink — so they
 * don't.
 *
 * The valley is 640 metres across and built as a watershed rather than a noise
 * field. High ground stands north and north-east, everything drains south and
 * west through carved river glens into the mere and the fen, and the road
 * network follows the contours between them. That ordering — mountains, then
 * water, then roads, then settlement — is the same order real landscapes get
 * built in, and it is why the place reads as somewhere rather than something.
 *
 * Everything is deterministic. There is no `Math.random()` in the world
 * generation, which means the scene looks identical on every load and on every
 * machine, and the exported world data matches what you saw in the browser.
 */

import * as THREE from "three";

export const WORLD_SIZE = 640;
export const WATER_LEVEL = -1.4;

/**
 * Half-width of the road surface. A cart track through a valley, not a
 * highway — wide enough for two to walk abreast and no wider.
 */
export const ROAD_HALF_WIDTH = 2;

/**
 * Reference elevations, published so the terrain shader, the flora budgets and
 * the settlement placer all draw their thresholds from one place. Retuning the
 * landform below without moving these leaves snow on the meadows.
 */
export const VALLEY_FLOOR = 6;
export const TREE_LINE = 62;
export const SNOW_LINE = 96;

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/**
 * Integer hash -> [0, 1). Cheap, stable across platforms.
 *
 * `Math.imul` is load-bearing, not a micro-optimisation. A plain `*` on these
 * constants produces results past 2^53, so the float silently drops its low
 * bits — and those low bits are the entire output of a hash. Written with `*`
 * this function returns a mean of 0.25 with a third of the expected spread,
 * which biases every consumer: terrain sinks, and rejection-sampled props all
 * land in one corner of the map instead of spreading across it.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function clamp01(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Clamped smoothstep. Most callers below are feeding it an unbounded ratio. */
function fade(t: number) {
  return smoothstep(clamp01(t));
}

/**
 * Smooth lower bound. Approaches `floor` asymptotically instead of clipping to
 * it, so nothing in the world ends up with the dead-flat pan and hard crease
 * that `Math.max` leaves behind wherever it bites.
 */
function softFloor(value: number, floor: number, softness: number): number {
  const above = value - floor;
  if (above > softness) return value;
  return floor + softness * Math.exp(above / softness - 1);
}

/** Bilinear value noise. */
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoothstep(x - xi);
  const yf = smoothstep(y - yi);

  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);

  return (
    a * (1 - xf) * (1 - yf) +
    b * xf * (1 - yf) +
    c * (1 - xf) * yf +
    d * xf * yf
  );
}

/** Fractal Brownian motion — stacked octaves, each finer and quieter. */
export function fbm(x: number, y: number, octaves = 5): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07; // non-integer, so octaves don't align into grid artefacts
  }
  return value / total;
}

/**
 * Ridged noise — inverted absolute FBM. Produces sharp crests instead of
 * rolling blobs, which is what makes distant mountains read as mountains.
 */
function ridged(x: number, y: number, octaves = 4): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * frequency, y * frequency) * 2 - 1);
    value += n * n * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.13;
  }
  return value / total;
}

// ---------------------------------------------------------------------------
// Standing water
// ---------------------------------------------------------------------------

export const WATERS: Array<{
  id: string;
  x: number;
  z: number;
  radius: number;
  kind: "lake" | "pond";
}> = [
  // The mere. Every drop of the Sildwater ends here, and it is the only body of
  // water big enough to be visible from the mountain road.
  { id: "mirrormere", x: -168, z: 120, radius: 58, kind: "lake" },
  // Open water in the middle of Thornwake Fen, where the Blackrun gives up.
  { id: "fenmere", x: 204, z: 158, radius: 28, kind: "pond" },
  // A pool on the Sildwater where the Thistlebeck joins it.
  { id: "duskpool", x: -72, z: -12, radius: 11, kind: "pond" },
  // Willow pond, deep in Elderloom.
  { id: "willowpond", x: 86, z: 176, radius: 17, kind: "pond" },
  // A cold tarn up among the pines, deliberately well off any road: the road
  // corridor widens with the depth of its cutting, and up here that is enough
  // to fill a small pond in.
  { id: "crowtarn", x: 88, z: -190, radius: 14, kind: "pond" },
  // Flooded workings below the Ashenreach terraces.
  { id: "quarrytarn", x: 168, z: -104, radius: 12, kind: "pond" },
];

/**
 * The great lake, kept as its own export because it predates `WATERS` and six
 * files still address it by name.
 */
export const LAKE = { x: -168, z: 120, radius: 58 };

/**
 * The shoreline radius of a water body at a given bearing.
 *
 * A perfectly circular lake reads as a hole punched in the terrain and is one
 * of the loudest procedural tells there is. The perturbation is outward only:
 * the water surface is drawn as a disc of the nominal radius, and a shore that
 * wandered inside that would leave water lying over dry ground.
 */
function shoreRadius(index: number, radius: number, dx: number, dz: number): number {
  const angle = Math.atan2(dz, dx);
  // Sampled on the unit circle so the wobble closes seamlessly at due west.
  const wobble = fbm(
    Math.cos(angle) * 2.2 + index * 137 + 40,
    Math.sin(angle) * 2.2 + index * 137 + 40,
    3
  );
  return radius * (1.02 + wobble * 0.17);
}

/** Widest a shore can wander out to, for the early-out test. */
const SHORE_MAX = 1.19;

function waterBasinAndCarve(x: number, z: number, height: number): number {
  let result = height;
  for (let i = 0; i < WATERS.length; i++) {
    const water = WATERS[i];
    const dx = x - water.x;
    const dz = z - water.z;
    const d2 = dx * dx + dz * dz;
    const outer = water.radius * 1.55 * SHORE_MAX;
    if (d2 >= outer * outer) continue;

    const reach = shoreRadius(i, water.radius, dx, dz) * 1.55;
    if (d2 >= reach * reach) continue;

    const t = 1 - Math.sqrt(d2) / reach;
    const depth = water.kind === "lake" ? 9 : 3.4;
    // Exponent above one holds the profile near shore level for the first few
    // metres in and only then lets it fall away. That shelf is what reads as a
    // beach you could wade off; a linear bowl reads as a swimming pool. Tuned
    // so the waterline lands within a metre or two of `radius`, which is where
    // the water plane is drawn.
    const bowl = Math.pow(fade(t * 1.26), 1.6);
    result = result * (1 - bowl) + (WATER_LEVEL - depth) * bowl;
  }
  return result;
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

// ---------------------------------------------------------------------------
// Landform
// ---------------------------------------------------------------------------

const BASE_ELEVATION = 15;
const CONTINENTAL_AMPLITUDE = 30;

/**
 * The hand-placed uplands. Coordinates match the region centres in
 * `regions.ts` — Skarnfell the region sits on Skarnfell the mountain, and if
 * one moves the other has to move with it.
 *
 * `octaves` is the personality dial: five gives the fractured crests of real
 * peaks, three gives the smooth swell of a moor.
 */
const MASSIFS = [
  // Skarnfell Heights — the northern wall. Every river here is born on it.
  { x: -10, z: -252, radius: 178, height: 118, frequency: 0.006, seed: 500, octaves: 5 },
  // The Kestrel March — a drier second range across the north-east.
  { x: 214, z: -238, radius: 146, height: 96, frequency: 0.0068, seed: 820, octaves: 5 },
  // Ashenreach — eroded uplands. The terraces below are cut out of this.
  { x: 196, z: -84, radius: 138, height: 54, frequency: 0.0074, seed: 2100, octaves: 4 },
  // The Hollowmoor — high rolling moor, deliberately blunt.
  { x: -156, z: -146, radius: 140, height: 42, frequency: 0.0092, seed: 1310, octaves: 3 },
  // The Tarnwild fells, standing over the mere from the west.
  { x: -244, z: -34, radius: 130, height: 66, frequency: 0.0071, seed: 2600, octaves: 4 },
];

const RIM_INNER = 244;
const RIM_OUTER = 322;
/** How far the rim wanders in and out around the compass, peak to peak. */
const RIM_WOBBLE = 64;

/**
 * Breaks in the mountain rim. Without them the valley is a bowl with a wall
 * around it, and a wall around the world is the fastest way to make a place
 * feel like a level instead of a country.
 */
const RIM_GAPS = [
  // The Sunder: where the fen drains away east, and the only low horizon.
  { x: 268, z: 214, radius: 150, depth: 0.92 },
  // The Skarn Pass: the road north goes over the top through here.
  { x: -22, z: -298, radius: 82, depth: 0.6 },
];

/**
 * Saddles: the notches the roads actually get through the mountains by.
 *
 * A range with no way over it is a wall, and a road governed to a walkable
 * gradient that tries to cross one anyway ends up fifty metres down in a trench
 * of its own making — which reads as a canyon someone inexplicably paved. A
 * pass has to be a feature of the mountain, cut before the road is laid on it,
 * not an excavation the road performs on arrival.
 *
 * These only ever lower the land, so a saddle can never appear as a shelf stuck
 * on the side of a peak.
 */
const SADDLES = [
  // The Skarn Pass, over the northern wall.
  { x: -2, z: -278, radius: 106, level: 44 },
  // The Ashgate, the way out east above the terraces.
  { x: 240, z: -152, radius: 96, level: 38 },
];

/** Wind-cut terraces. Ashenreach is the only place in the valley that steps. */
const MESA = { x: 196, z: -84, radius: 168, step: 8.5 };

/** Thornwake Fen: waterlogged, level, and barely above the waterline. */
const FEN = { x: 176, z: 132, radius: 128 };

/**
 * How worked-over the ground is, 0..1.
 *
 * Ploughed fields, orchard terraces and waterlogged fen are all level in a way
 * wild ground never is, so the detail noise is damped across them. A furrowed
 * field with hummocks in it reads as abandoned.
 */
function tameness(x: number, z: number): number {
  let value = fade(1 - Math.hypot(x + 95, z - 60) / 120) * 0.78; // Barleyhearth
  value += fade(1 - Math.hypot(x + 52, z - 212) / 96) * 0.62; // Cidergarth
  value += fade(1 - Math.hypot(x - FEN.x, z - FEN.z) / FEN.radius) * 0.9;
  return clamp01(value);
}

/**
 * Low-frequency terrain only: everything that decides where a mountain, a
 * plateau or a basin is. The rivers and the roads are graded against this
 * rather than against the full detail, so neither ripples over every bump.
 */
function landform(x: number, z: number): number {
  // Domain warp. Sampling the big noise through a slow wobble is the
  // difference between ranges that meander the way geology does and ranges
  // that run in straight bands along the noise grid.
  const wx = x + (fbm(x * 0.0026 + 11.3, z * 0.0026 + 4.7, 2) - 0.5) * 130;
  const wz = z + (fbm(x * 0.0026 + 71.9, z * 0.0026 + 39.1, 2) - 0.5) * 130;

  let height =
    BASE_ELEVATION +
    (fbm(wx * 0.0031 + 100, wz * 0.0031 + 100, 4) - 0.5) * CONTINENTAL_AMPLITUDE;

  // The valley floor: a broad bowl centred on the green, pulling the middle of
  // the map down toward a consistent, settleable elevation. Without it the
  // inhabited country sits on a random slice of the continental noise and half
  // the villages end up on a hillside.
  const fromCentre = Math.hypot(x, z);
  const bowl = 1 - fade(fromCentre / 235);
  height = height * (1 - bowl * 0.72) + VALLEY_FLOOR * (bowl * 0.72);

  // Downland, strongest exactly where the bowl has flattened everything else.
  // The valley needs relief of its own or it comes out a lawn with a road on
  // it: low hills at the scale you cross in a minute's walk, which is the scale
  // that makes ground feel walked through rather than looked at.
  height += (fbm(wx * 0.0118 + 220, wz * 0.0118 + 220, 4) - 0.44) * 22 * bowl;

  // Massifs. Each bails out the moment it has no influence: `heightAt` runs
  // several hundred thousand times to build the mesh, and a five-octave ridged
  // stack about to be multiplied by zero is the most expensive nothing here.
  for (let i = 0; i < MASSIFS.length; i++) {
    const massif = MASSIFS[i];
    const distance = Math.hypot(x - massif.x, z - massif.z);
    if (distance >= massif.radius) continue;

    const k = fade(1 - distance / massif.radius);
    const peak = ridged(
      wx * massif.frequency + massif.seed,
      wz * massif.frequency + massif.seed,
      massif.octaves
    );
    // k² rather than k leaves a long skirt below the range proper.
    height += peak * massif.height * k * k;

    // Corrugation across that skirt, strongest where the ground is turning
    // upward. This is what makes a range *step* up out of the valley instead
    // of swelling out of it like a dropped blanket.
    const skirt = 4 * k * (1 - k);
    height +=
      (ridged(wx * 0.019 + massif.seed, wz * 0.019 + massif.seed, 3) - 0.36) *
      11 *
      skirt;
  }

  // The rim. Not a circle: a wobble sampled around the compass pushes it in and
  // out, so the valley gets spurs and side-glens rather than a wall, and two
  // explicit gaps open the horizon where the land has somewhere to drain.
  //
  // The wobble can only ever pull the rim in by half its amplitude, so anywhere
  // inside that bound is guaranteed rim-free and skips both noise stacks. Most
  // of the map is inside it, and this is the hottest function in the project.
  if (fromCentre > RIM_INNER - RIM_WOBBLE * 0.5) {
    const angle = Math.atan2(z, x);
    const wobble =
      (fbm(Math.cos(angle) * 2.6 + 300, Math.sin(angle) * 2.6 + 300, 3) - 0.5) *
      RIM_WOBBLE;
    let rim = clamp01(
      (fromCentre - (RIM_INNER + wobble)) / (RIM_OUTER - RIM_INNER)
    );
    if (rim > 0) {
      for (let i = 0; i < RIM_GAPS.length; i++) {
        const gap = RIM_GAPS[i];
        const distance = Math.hypot(x - gap.x, z - gap.z);
        if (distance >= gap.radius) continue;
        rim *= 1 - fade(1 - distance / gap.radius) * gap.depth;
      }
      height +=
        ridged(wx * 0.0052 + 5000, wz * 0.0052 + 5000, 5) * 156 * rim * rim;
    }
  }

  // Notch the passes out before anything else is laid on top of the mountains.
  for (let i = 0; i < SADDLES.length; i++) {
    const saddle = SADDLES[i];
    const distance = Math.hypot(x - saddle.x, z - saddle.z);
    if (distance >= saddle.radius) continue;
    // Rough, so the pass reads as a broken col rather than a milled slot.
    const target =
      saddle.level + (fbm(x * 0.021 + 610, z * 0.021 + 610, 3) - 0.5) * 13;
    if (height <= target) continue;
    const k = fade(1 - distance / saddle.radius) * 0.94;
    height = height * (1 - k) + target * k;
  }

  // Ashenreach terracing. A plain quantisation gives aliased stairs; fading
  // over the top third of each tread turns them into flat benches separated by
  // cliffs, which is what wind actually cuts out of soft rock.
  const mesaDistance = Math.hypot(x - MESA.x, z - MESA.z);
  if (mesaDistance < MESA.radius) {
    const k = fade(1 - mesaDistance / MESA.radius) * 0.85;
    const level = height / MESA.step;
    const tread = Math.floor(level);
    const stepped = (tread + fade((level - tread - 0.6) / 0.32)) * MESA.step;
    height = height * (1 - k) + stepped * k;
  }

  // Ordinary ground never dips under the waterline: a puddle with no water in
  // it reads as a hole punched in the world. Basins are applied afterwards,
  // because they are supposed to go under.
  height = softFloor(height, WATER_LEVEL + 1.4, 3.5);

  // Basins. The ground gives way gradually for a long way around standing
  // water — that gradient is what makes a shore a shore instead of the rim of
  // a bucket, and it is where the coastal shelving comes from.
  for (let i = 0; i < WATERS.length; i++) {
    const water = WATERS[i];
    const basin = water.radius * (water.kind === "lake" ? 3 : 2.2);
    const distance = Math.hypot(x - water.x, z - water.z);
    if (distance >= basin) continue;
    const k = fade(1 - distance / basin) * 0.92;
    height = height * (1 - k) + (WATER_LEVEL + 2.2) * k;
  }

  // The fen. Flat, sodden, and a hand's breadth above the water table.
  const fenDistance = Math.hypot(x - FEN.x, z - FEN.z);
  if (fenDistance < FEN.radius) {
    const k = fade(1 - fenDistance / FEN.radius) * 0.94;
    const floor =
      WATER_LEVEL + 0.55 + (fbm(x * 0.05 + 41, z * 0.05 + 41, 3) - 0.5) * 0.9;
    height = height * (1 - k) + floor * k;
  }

  return height;
}

/** Mid and fine relief, damped wherever people have worked the ground level. */
function detail(x: number, z: number): number {
  let value = (fbm(x * 0.0195 + 20, z * 0.0195 + 20, 4) - 0.5) * 5.4;
  value += (fbm(x * 0.062 + 60, z * 0.062 + 60, 3) - 0.5) * 1.35;
  value += (fbm(x * 0.19 + 90, z * 0.19 + 90, 2) - 0.5) * 0.34;
  return value * (1 - tameness(x, z) * 0.62);
}

// ---------------------------------------------------------------------------
// Path indices
// ---------------------------------------------------------------------------

/**
 * Both the rivers and the roads are polylines that the height function has to
 * measure distance to at every vertex of the terrain mesh, so they share one
 * accelerator.
 *
 * Two decisions in here matter. Segments rather than points: a 4m sample
 * spacing with point distances puts a 2m error on a 4m-wide road, which shows
 * as scalloping down both verges. And each segment is registered into every
 * cell within `pad` of its bounding box, which means a query reads exactly one
 * bucket and is exact out to `pad` metres — no ring search, no false negatives
 * inside the range anything actually asks about.
 */
type PathSamples = {
  xs: Float64Array;
  zs: Float64Array;
  ts: Float64Array;
  starts: number[];
  counts: number[];
  closed: boolean[];
  total: number;
};

type PathIndex = {
  ax: Float64Array;
  az: Float64Array;
  ay: Float64Array;
  at: Float64Array;
  bx: Float64Array;
  bz: Float64Array;
  by: Float64Array;
  bt: Float64Array;
  owner: Int32Array;
  count: number;
  cell: number;
  pad: number;
  buckets: Map<number, Int32Array>;
};

type PathHit = { distance: number; x: number; z: number; y: number; t: number; owner: number };

function makeCurve(points: [number, number][], closed: boolean) {
  return new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    closed,
    "catmullrom",
    0.5
  );
}

function samplePaths(
  curves: THREE.CatmullRomCurve3[],
  spacing: number
): PathSamples {
  const xs: number[] = [];
  const zs: number[] = [];
  const ts: number[] = [];
  const starts: number[] = [];
  const counts: number[] = [];
  const closed: boolean[] = [];

  for (let c = 0; c < curves.length; c++) {
    const curve = curves[c];
    const divisions = Math.max(12, Math.round(curve.getLength() / spacing));
    const points = curve.getSpacedPoints(divisions);
    // `getSpacedPoints` hands back divisions + 1 points; on a closed curve the
    // last duplicates the first, and the wrap segment supplies the join.
    const n = curve.closed ? divisions : divisions + 1;

    starts.push(xs.length);
    counts.push(n);
    closed.push(curve.closed);

    for (let i = 0; i < n; i++) {
      xs.push(points[i].x);
      zs.push(points[i].z);
      ts.push(i / divisions);
    }
  }

  return {
    xs: Float64Array.from(xs),
    zs: Float64Array.from(zs),
    ts: Float64Array.from(ts),
    starts,
    counts,
    closed,
    total: xs.length,
  };
}

function buildPathIndex(
  samples: PathSamples,
  ys: Float64Array,
  cell: number,
  pad: number
): PathIndex {
  const ai: number[] = [];
  const bi: number[] = [];
  const owner: number[] = [];
  const bt: number[] = [];

  for (let c = 0; c < samples.starts.length; c++) {
    const start = samples.starts[c];
    const n = samples.counts[c];
    const wraps = samples.closed[c];
    const segments = wraps ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      const a = start + i;
      const b = start + ((i + 1) % n);
      ai.push(a);
      bi.push(b);
      owner.push(c);
      // The wrap segment's far end is the start of the curve, whose stored `t`
      // is 0. Reporting 1 keeps the parameter monotonic all the way round.
      bt.push(wraps && i === segments - 1 ? 1 : samples.ts[b]);
    }
  }

  const count = ai.length;
  const index: PathIndex = {
    ax: new Float64Array(count),
    az: new Float64Array(count),
    ay: new Float64Array(count),
    at: new Float64Array(count),
    bx: new Float64Array(count),
    bz: new Float64Array(count),
    by: new Float64Array(count),
    bt: Float64Array.from(bt),
    owner: Int32Array.from(owner),
    count,
    cell,
    pad,
    buckets: new Map(),
  };

  const raw = new Map<number, number[]>();
  for (let i = 0; i < count; i++) {
    const a = ai[i];
    const b = bi[i];
    index.ax[i] = samples.xs[a];
    index.az[i] = samples.zs[a];
    index.ay[i] = ys[a];
    index.at[i] = samples.ts[a];
    index.bx[i] = samples.xs[b];
    index.bz[i] = samples.zs[b];
    index.by[i] = ys[b];

    const minX = Math.floor((Math.min(index.ax[i], index.bx[i]) - pad) / cell);
    const maxX = Math.floor((Math.max(index.ax[i], index.bx[i]) + pad) / cell);
    const minZ = Math.floor((Math.min(index.az[i], index.bz[i]) - pad) / cell);
    const maxZ = Math.floor((Math.max(index.az[i], index.bz[i]) + pad) / cell);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = (cx + 4096) * 8192 + (cz + 4096);
        const bucket = raw.get(key);
        if (bucket) bucket.push(i);
        else raw.set(key, [i]);
      }
    }
  }

  for (const [key, list] of raw) index.buckets.set(key, Int32Array.from(list));
  return index;
}

/** Distance sentinel for "further away than this index can answer for". */
const PATH_FAR = 999;

function measureSegment(
  index: PathIndex,
  i: number,
  qx: number,
  qz: number,
  out: PathHit
): number {
  const ex = index.bx[i] - index.ax[i];
  const ez = index.bz[i] - index.az[i];
  const px = qx - index.ax[i];
  const pz = qz - index.az[i];
  const length2 = ex * ex + ez * ez;

  let u = length2 > 1e-9 ? (px * ex + pz * ez) / length2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;

  const cx = index.ax[i] + ex * u;
  const cz = index.az[i] + ez * u;
  const dx = qx - cx;
  const dz = qz - cz;
  const d2 = dx * dx + dz * dz;

  out.x = cx;
  out.z = cz;
  out.y = index.ay[i] + (index.by[i] - index.ay[i]) * u;
  out.t = index.at[i] + (index.bt[i] - index.at[i]) * u;
  out.owner = index.owner[i];
  return d2;
}

const probe: PathHit = { distance: 0, x: 0, z: 0, y: 0, t: 0, owner: 0 };

/** Nearest point on the network, exact within `index.pad`, `PATH_FAR` beyond. */
function queryPath(
  index: PathIndex,
  qx: number,
  qz: number,
  out: PathHit
): number {
  const key =
    (Math.floor(qx / index.cell) + 4096) * 8192 +
    (Math.floor(qz / index.cell) + 4096);
  const bucket = index.buckets.get(key);
  if (!bucket) {
    out.distance = PATH_FAR;
    return PATH_FAR;
  }

  let best = Infinity;
  for (let i = 0; i < bucket.length; i++) {
    const d2 = measureSegment(index, bucket[i], qx, qz, probe);
    if (d2 < best) {
      best = d2;
      out.x = probe.x;
      out.z = probe.z;
      out.y = probe.y;
      out.t = probe.t;
      out.owner = probe.owner;
    }
  }

  out.distance = Math.sqrt(best);
  return out.distance;
}

/** Unbounded fallback. Only for placement-time queries, never per-frame. */
function scanPath(index: PathIndex, qx: number, qz: number, out: PathHit): number {
  let best = Infinity;
  for (let i = 0; i < index.count; i++) {
    const d2 = measureSegment(index, i, qx, qz, probe);
    if (d2 < best) {
      best = d2;
      out.x = probe.x;
      out.z = probe.z;
      out.y = probe.y;
      out.t = probe.t;
      out.owner = probe.owner;
    }
  }
  out.distance = Math.sqrt(best);
  return out.distance;
}

// ---------------------------------------------------------------------------
// Rivers
// ---------------------------------------------------------------------------

/**
 * Where the water starts and where it is trying to get to. Everything between
 * is traced, not drawn.
 *
 * Hand-drawing a river's course is the obvious thing to do and it is wrong. It
 * looks correct on a map and then turns out, once the landform underneath it
 * settles, to run along the shoulder of a hill with lower ground fifty metres
 * to one side — which no river has ever done, and which the eye picks up
 * immediately even when it can't say why. Tracing downhill through `landform`
 * guarantees the course sits in the bottom of its own valley, because that is
 * the definition of the path it takes.
 */
const RIVER_SOURCES: Array<{ x: number; z: number; target: { x: number; z: number; radius: number } }> = [
  // The Sildwater — off Skarnfell, the length of the valley, into the mere.
  { x: -44, z: -258, target: WATERS[0] },
  // The Blackrun — out of the Kestrel March, down to Thornwake Fen.
  { x: 218, z: -240, target: WATERS[1] },
  // The Thistlebeck — off the Hollowmoor, joining the Sildwater at Duskpool.
  { x: -192, z: -162, target: WATERS[2] },
];

/**
 * Steepest descent with momentum and a pull toward the mouth.
 *
 * The goal term is what keeps this authored rather than emergent. Up in the
 * mountains the terrain gradient across a probe step is tens of metres and the
 * land decides everything; out on the valley floor the gradient is almost
 * nothing and base level takes over. That is also how a real river picks its
 * course, so weighting the two against each other gets both behaviours out of
 * one rule.
 */
function traceFlow(
  sourceX: number,
  sourceZ: number,
  target: { x: number; z: number; radius: number }
): [number, number][] {
  const STEP = 11;
  // Probe further than a step: the gradient over twenty metres of real ground
  // is a much better guide to where the valley is than the gradient over one.
  const PROBE = 20;
  const DIRECTIONS = 20;
  const MOMENTUM = 0.55;
  const GOAL = 0.24;

  const path: [number, number][] = [[sourceX, sourceZ]];
  let x = sourceX;
  let z = sourceZ;
  let dx = target.x - sourceX;
  let dz = target.z - sourceZ;
  const start = Math.hypot(dx, dz);
  dx /= start;
  dz /= start;

  for (let step = 0; step < 200; step++) {
    const before = Math.hypot(x - target.x, z - target.z);
    // Fall back on heading straight for the mouth if nothing else qualifies.
    let bestScore = Infinity;
    let bestX = (target.x - x) / before;
    let bestZ = (target.z - z) / before;

    for (let d = 0; d < DIRECTIONS; d++) {
      const angle = (d / DIRECTIONS) * Math.PI * 2;
      const ux = Math.cos(angle);
      const uz = Math.sin(angle);
      // Never double back. Without this the trace oscillates on flat ground
      // instead of crossing it.
      if (ux * dx + uz * dz < -0.2) continue;

      const px = x + ux * PROBE;
      const pz = z + uz * PROBE;
      const after = Math.hypot(px - target.x, pz - target.z);
      // Every step has to close on the mouth. Terrain still picks *which* of
      // the forward directions to take, which is where the meander comes from,
      // but a course free to move away from its outfall will find a hollow,
      // circle in it, and cut a deeper pit with every lap — which is exactly
      // what the Blackrun did before this line existed.
      if (after >= before - 0.5) continue;

      const score = landform(px, pz) - GOAL * (before - after);
      if (score < bestScore) {
        bestScore = score;
        bestX = ux;
        bestZ = uz;
      }
    }

    dx = dx * MOMENTUM + bestX * (1 - MOMENTUM);
    dz = dz * MOMENTUM + bestZ * (1 - MOMENTUM);
    const magnitude = Math.hypot(dx, dz) || 1;
    dx /= magnitude;
    dz /= magnitude;

    x += dx * STEP;
    z += dz * STEP;
    path.push([x, z]);

    if (Math.hypot(x - target.x, z - target.z) < target.radius * 0.5) break;
    if (Math.abs(x) > 312 || Math.abs(z) > 312) break;
  }

  // Relax the trace, then thin it. A control point every step makes a Catmull-
  // Rom that wobbles between them; every third gives the curve room to be a
  // curve, which is what the meander wants to look like anyway.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < path.length - 1; i++) {
      path[i][0] = (path[i - 1][0] + path[i][0] * 2 + path[i + 1][0]) * 0.25;
      path[i][1] = (path[i - 1][1] + path[i][1] * 2 + path[i + 1][1]) * 0.25;
    }
  }

  const thinned: [number, number][] = [];
  for (let i = 0; i < path.length; i += 3) thinned.push(path[i]);
  const last = path[path.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);
  return thinned;
}

/**
 * The watercourses, source first, mouth last. Order matters: the bed profile
 * below is built by walking each one downstream.
 *
 * Exported because bridges, fords and any future water surface all need to know
 * where the water runs, and re-deriving it from the height field afterwards is
 * both slow and approximate.
 */
export const RIVERS: THREE.CatmullRomCurve3[] = RIVER_SOURCES.map((source) =>
  makeCurve(traceFlow(source.x, source.z, source.target), false)
);

const RIVER_SPACING = 6;
const RIVER_VALLEY = 52;
const RIVER_CHANNEL = 6;
/** Radius over which the detail noise is quietened toward a watercourse. */
const RIVER_CALM = 24;
/** How deep a bed is allowed to sit below the land it passes through. */
const MAX_INCISION = 22;

const riverSamples = samplePaths(RIVERS, RIVER_SPACING);

/**
 * The bed profile.
 *
 * Water runs downhill and nothing else, so the elevation is a running minimum
 * walked from source to mouth. Where the land rises against it the bed cuts in
 * — that is a gorge, and it is the single most convincing thing terrain can
 * do — but the cut is capped, because an uncapped running minimum will happily
 * carve a two-hundred-metre slot through a mountain to prove a point.
 */
const riverElevation = (() => {
  const ys = new Float64Array(riverSamples.total);

  for (let c = 0; c < RIVERS.length; c++) {
    const start = riverSamples.starts[c];
    const n = riverSamples.counts[c];

    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      raw[i] = landform(riverSamples.xs[start + i], riverSamples.zs[start + i]);
    }

    const profile = new Float64Array(n);
    profile[0] = raw[0];
    for (let i = 1; i < n; i++) {
      profile[i] = Math.max(
        Math.min(raw[i], profile[i - 1] - 0.04),
        raw[i] - MAX_INCISION
      );
    }

    // Where a course ends in standing water, drop the last stretch under the
    // surface so it merges instead of stopping on a lip. Where it ends at a
    // confluence with no pool, leave it — forcing every mouth down would sink
    // tributaries a full basin below the river they join.
    const endX = riverSamples.xs[start + n - 1];
    const endZ = riverSamples.zs[start + n - 1];
    if (distanceToWater(endX, endZ) < 0) {
      const mouth = Math.max(4, Math.round(n * 0.12));
      for (let i = n - mouth; i < n; i++) {
        const k = (i - (n - mouth)) / (mouth - 1);
        profile[i] = profile[i] * (1 - k) + (WATER_LEVEL - 1.4) * k;
      }
    }

    // Grade it. An unsmoothed running minimum leaves a stair tread wherever the
    // land rose against it, and beds don't have steps in them.
    for (let pass = 0; pass < 6; pass++) {
      let previous = profile[0];
      for (let i = 1; i < n - 1; i++) {
        const current = profile[i];
        profile[i] = (previous + current * 2 + profile[i + 1]) * 0.25;
        previous = current;
      }
    }
    for (let i = 1; i < n; i++) {
      profile[i] = Math.min(profile[i], profile[i - 1] - 0.01);
    }

    for (let i = 0; i < n; i++) ys[start + i] = profile[i];
  }

  return ys;
})();

const riverIndex = buildPathIndex(riverSamples, riverElevation, 32, 60);
const riverHit: PathHit = { distance: 0, x: 0, z: 0, y: 0, t: 0, owner: 0 };

/**
 * Cuts the glen. The valley walls only ever take material away — erosion does
 * not fill hollows in — and the narrow channel on top of it is the stream bed
 * itself.
 *
 * Takes the query result rather than running it, because `heightAt` needs the
 * distance before it has a height to carve with: the detail noise has to be
 * turned down first. Its amplitude is three metres and the channel is two deep,
 * so at full strength it simply fills the cut back in with lumps.
 */
function carveRiver(distance: number, bed: number, height: number): number {
  if (distance >= RIVER_VALLEY) return height;

  let result = height;

  const wall = bed + 1.2 + (distance / RIVER_VALLEY) * 26;
  if (wall < result) {
    const w = fade(1 - distance / RIVER_VALLEY) * 0.88;
    result = result * (1 - w) + wall * w;
  }

  if (distance < RIVER_CHANNEL) {
    const c = fade(1 - distance / RIVER_CHANNEL);
    result = result * (1 - c) + (bed - 2) * c;
  }

  return result;
}

/** How much of the detail noise survives this close to running water. */
function riverCalm(distance: number): number {
  if (distance >= RIVER_CALM) return 1;
  return 0.15 + 0.85 * fade(distance / RIVER_CALM);
}

/** The graded land a road is laid on: landform plus whatever the water took. */
function erodedLand(x: number, z: number): number {
  const distance = queryPath(riverIndex, x, z, riverHit);
  return carveRiver(distance, riverHit.y, landform(x, z));
}

// ---------------------------------------------------------------------------
// The road network
// ---------------------------------------------------------------------------

/**
 * One circuit and nine spurs.
 *
 * `ROADS[0]` is the Long Circuit — closed, because the bard walks it forever,
 * which is the whole conceit: he is always travelling, never arriving. The
 * spurs hang off its control points and run out to the places worth the detour:
 * the mere, the orchard, the fen causeway, the terraces, the pass over
 * Skarnfell, the moor, the pinewood, Elderloom, and one lane straight across
 * the middle of the green so the valley floor isn't a doughnut.
 *
 * Every branch begins on a point of the circuit, and the grading below anchors
 * its elevation to the circuit's at that junction — otherwise two roads meeting
 * at the same coordinate arrive at slightly different heights and leave a step
 * in the ground.
 */
export const ROADS: THREE.CatmullRomCurve3[] = [
  makeCurve(
    [
      [5, 118],
      [78, 140],
      // The eastern arc sits deliberately west of the Blackrun's traced line.
      // The river picks its own course through this valley and the two of them
      // want the same twenty metres of it; a road laid down the middle of a
      // stream bed is not a road, it is a ford four hundred metres long.
      [112, 80],
      [124, 20],
      [116, -58],
      [96, -114],
      [28, -148],
      [-46, -142],
      [-108, -112],
      [-150, -46],
      [-138, 22],
      [-92, 74],
      [-50, 112],
    ],
    true
  ),
  // The Mere Road, down the east shore to Saltmere Strand.
  makeCurve(
    [
      [-138, 22],
      [-130, 60],
      [-108, 98],
      [-106, 142],
      [-130, 178],
      [-158, 204],
    ],
    false
  ),
  // Orchard Lane, through Cidergarth toward Elderloom.
  makeCurve(
    [
      [-50, 112],
      [-64, 152],
      [-70, 196],
      [-46, 228],
      [-4, 240],
      [42, 226],
    ],
    false
  ),
  // The Fen Causeway. The only dry footing across Thornwake.
  makeCurve(
    [
      [112, 80],
      [136, 104],
      [156, 134],
      [162, 176],
      [152, 210],
    ],
    false
  ),
  // The Ash Track, out onto the terraces past the flooded workings. Crosses the
  // Blackrun square on rather than running down it.
  makeCurve(
    [
      [116, -58],
      [150, -74],
      [186, -92],
      [220, -118],
      [244, -158],
    ],
    false
  ),
  // The Skarn Pass, the only way over the northern wall.
  makeCurve(
    [
      [28, -148],
      [10, -186],
      [-6, -222],
      [-14, -258],
      [4, -286],
    ],
    false
  ),
  // The Green Lane, straight across the valley floor.
  makeCurve(
    [
      [5, 118],
      [10, 66],
      [-2, 18],
      [6, -34],
      [26, -80],
      [28, -148],
    ],
    false
  ),
  // The Moor Road, up onto the Hollowmoor. It follows the Thistlebeck the way a
  // real road follows a beck — along the far bank, twenty-odd metres clear, not
  // down the middle of the water.
  makeCurve(
    [
      [-108, -112],
      [-124, -140],
      [-148, -164],
      [-178, -180],
      [-212, -188],
    ],
    false
  ),
  // Pine Way, into Greyneedle and up to the tarn.
  makeCurve(
    [
      [96, -114],
      [70, -146],
      [50, -178],
      [48, -210],
      [54, -244],
    ],
    false
  ),
  // Elder Path, under the canopy past the willow pond.
  makeCurve(
    [
      [78, 140],
      [66, 172],
      [52, 204],
      [66, 232],
      [96, 246],
    ],
    false
  ),
];

/** Kept so every existing import of the single loop still resolves. */
export const ROAD_CURVE = ROADS[0];

const ROAD_SPACING = 4;
/**
 * The steepest a track is allowed to climb. Roughly a one-in-six — hard work
 * with a handcart, which is what a mountain spur should feel like, and far
 * beyond anything the circuit ever needs. Terrain left ungoverned will happily
 * hand a road a forty-five degree ramp up a mountainside.
 */
const MAX_ROAD_GRADE = 0.17;
const roadSamples = samplePaths(ROADS, ROAD_SPACING);

/**
 * The closest profile to `source` that never changes by more than `maxRise`
 * between adjacent samples, approached from one side only: `lower` gives the
 * highest legal profile that is nowhere above the source, `!lower` the lowest
 * that is nowhere below it.
 *
 * A forward sweep and a backward sweep compute that exactly for an open path —
 * it is a distance transform, not an iteration. Trying to reach the same answer
 * by nudging violating pairs toward each other looks equivalent and is not: the
 * correction diffuses one sample per pass, so it needs O(n²) passes, and at a
 * few hundred samples a circuit it quietly stops short and leaves a third of
 * the road over budget.
 */
function limitSlope(
  source: Float64Array,
  n: number,
  wraps: boolean,
  maxRise: number,
  lower: boolean
): Float64Array {
  const out = Float64Array.from(source);
  const pairs = wraps ? n : n - 1;
  // A closed circuit needs the constraint carried past the seam and round
  // again; an open spur is settled by one sweep each way.
  const laps = wraps ? 3 : 1;

  for (let lap = 0; lap < laps; lap++) {
    for (let k = 0; k < pairs; k++) {
      const i = k;
      const j = (k + 1) % n;
      if (lower) {
        if (out[j] > out[i] + maxRise) out[j] = out[i] + maxRise;
      } else if (out[j] < out[i] - maxRise) {
        out[j] = out[i] - maxRise;
      }
    }
    for (let k = pairs - 1; k >= 0; k--) {
      const i = k;
      const j = (k + 1) % n;
      if (lower) {
        if (out[i] > out[j] + maxRise) out[i] = out[j] + maxRise;
      } else if (out[i] < out[j] - maxRise) {
        out[i] = out[j] - maxRise;
      }
    }
  }

  return out;
}

/**
 * The graded road surface, one elevation per sample.
 *
 * Precomputing this is what lets `roadHeight` be a lookup rather than a stack
 * of terrain evaluations, but it is mostly here for quality: smoothing the
 * profile *along the road* is literally what grading a track is. Smoothing it
 * across the terrain instead — averaging the ground either side of each point —
 * leaves the road following every foothill it crosses, which is why an ungraded
 * procedural road always looks painted on rather than dug in.
 */
const roadElevation = (() => {
  const ys = new Float64Array(roadSamples.total);
  const floor = WATER_LEVEL + 1.2;

  for (let c = 0; c < ROADS.length; c++) {
    const start = roadSamples.starts[c];
    const n = roadSamples.counts[c];
    const wraps = roadSamples.closed[c];

    const profile = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      profile[i] = Math.max(
        erodedLand(roadSamples.xs[start + i], roadSamples.zs[start + i]),
        floor
      );
    }

    const scratch = new Float64Array(n);
    for (let pass = 0; pass < 48; pass++) {
      for (let i = 0; i < n; i++) {
        const previous = wraps ? profile[(i - 1 + n) % n] : profile[Math.max(0, i - 1)];
        const next = wraps ? profile[(i + 1) % n] : profile[Math.min(n - 1, i + 1)];
        scratch[i] = (previous + profile[i] * 2 + next) * 0.25;
      }
      profile.set(scratch);
    }

    // What the circuit is doing where this spur meets it, at whichever ends
    // actually touch. Both roads were graded against the same ground but over
    // different neighbourhoods, so they disagree at a junction, and a step in
    // the middle of a road fork is exactly the sort of thing the eye finds
    // instantly. The Green Lane rejoins the circuit at both ends, so checking
    // only where a spur starts is not enough.
    const anchorAt = (px: number, pz: number): number | null => {
      if (c === 0) return null;
      const mainStart = roadSamples.starts[0];
      const mainCount = roadSamples.counts[0];
      let nearest = 0;
      let nearestDistance = Infinity;
      for (let i = 0; i < mainCount; i++) {
        const dx = roadSamples.xs[mainStart + i] - px;
        const dz = roadSamples.zs[mainStart + i] - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < nearestDistance) {
          nearestDistance = d2;
          nearest = i;
        }
      }
      // Six metres, squared. Sample spacing is four, so a spur that shares a
      // control point with the circuit always lands inside it and one that
      // merely passes nearby never does. Reading `ys` here is safe because the
      // circuit is index 0 and has already been written.
      return nearestDistance <= 6 * 6 ? ys[mainStart + nearest] : null;
    };

    const headAnchor = anchorAt(roadSamples.xs[start], roadSamples.zs[start]);
    const tailAnchor = anchorAt(
      roadSamples.xs[start + n - 1],
      roadSamples.zs[start + n - 1]
    );

    // Govern the gradient. Smoothing takes the ripples out of a profile but
    // says nothing about how fast it is allowed to climb, and the spurs run at
    // mountains — ungoverned, the Skarn Pass came out as a forty-five degree
    // ramp.
    //
    // Blending the two envelopes is the trick. Each is a legal profile on its
    // own: the low one hangs off the bottom of the climb and is all cutting, the
    // high one hangs off the top and is all embankment. Anything between them is
    // legal too, because a slope limit is a convex constraint — so the blend
    // weight is a free parameter, and rather than fix it at half and then have
    // to force the junction afterwards, a spur solves for the weight that lands
    // its first sample on the circuit exactly. Ramping a leftover offset in
    // afterwards is what broke this before: on a short spur the ramp has to be
    // steep, and it puts back the grade the envelopes just took out.
    const spacing = Math.hypot(
      roadSamples.xs[start + 1] - roadSamples.xs[start],
      roadSamples.zs[start + 1] - roadSamples.zs[start]
    );
    const maxRise = MAX_ROAD_GRADE * spacing;
    const low = limitSlope(profile, n, wraps, maxRise, true);
    const high = limitSlope(profile, n, wraps, maxRise, false);

    let weight = 0.5;
    const solveFor = headAnchor ?? tailAnchor;
    if (solveFor !== null) {
      const index = headAnchor !== null ? 0 : n - 1;
      const span = high[index] - low[index];
      if (span > 1e-6) weight = clamp01((high[index] - solveFor) / span);
    }
    for (let i = 0; i < n; i++) {
      profile[i] = low[i] * weight + high[i] * (1 - weight);
    }

    // Whatever the weight couldn't absorb, tilted in across the whole spur
    // rather than ramped in over a few samples near the join. Same total
    // correction, spread over fifty times the distance, so it costs a fraction
    // of a percent of grade instead of putting back the cliff the envelopes
    // just took out.
    const head = headAnchor !== null ? headAnchor - profile[0] : 0;
    const tail = tailAnchor !== null ? tailAnchor - profile[n - 1] : 0;
    if (head !== 0 || tail !== 0) {
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0;
        profile[i] += head * (1 - t) + tail * t;
      }
    }

    for (let i = 0; i < n; i++) ys[start + i] = Math.max(profile[i], floor);
  }

  return ys;
})();

const ROAD_PAD = 30;
const roadIndex = buildPathIndex(roadSamples, roadElevation, 16, ROAD_PAD);
const roadHit: PathHit = { distance: 0, x: 0, z: 0, y: 0, t: 0, owner: 0 };
const roadLookup: PathHit = { distance: 0, x: 0, z: 0, y: 0, t: 0, owner: 0 };

const roadLengths = ROADS.map((road) => road.getLength());
const roadTotalLength = roadLengths.reduce((sum, length) => sum + length, 0);

/**
 * Distance from (x, z) to the nearest centre line in the network.
 *
 * Reports 999 past `ROAD_PAD` metres rather than searching outward. Every
 * caller is asking "am I on or beside a road", and the terrain builder asks it
 * once per vertex — paying for an exact answer at two hundred metres, where the
 * answer is only ever used as "no", would dominate load time.
 */
export function distanceToRoad(x: number, z: number): number {
  return queryPath(roadIndex, x, z, roadLookup);
}

/** Nearest point on the network, with the curve it belongs to and its parameter. */
export function nearestRoadPoint(
  x: number,
  z: number
): { x: number; z: number; t: number; road: number } {
  const distance = queryPath(roadIndex, x, z, roadLookup);
  if (distance >= PATH_FAR) scanPath(roadIndex, x, z, roadLookup);
  return {
    x: roadLookup.x,
    z: roadLookup.z,
    t: roadLookup.t,
    road: roadLookup.owner,
  };
}

/**
 * Where the road surface sits. Clamped above the waterline so the path never
 * disappears into the mere — a traveller's road wouldn't.
 */
export function roadHeight(x: number, z: number): number {
  const distance = queryPath(roadIndex, x, z, roadHit);
  if (distance < PATH_FAR) return roadHit.y;
  // Off the network entirely. Nothing should be asking, but returning graded
  // ground beats returning a hole.
  return Math.max(erodedLand(x, z), WATER_LEVEL + 1.2);
}

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

/** Full detail height at a world position. This is *the* ground. */
export function heightAt(x: number, z: number): number {
  // One river query, used twice: once to quieten the detail noise on the way
  // down into a glen, and again to cut the glen itself.
  const riverDistance = queryPath(riverIndex, x, z, riverHit);

  let height = landform(x, z) + detail(x, z) * riverCalm(riverDistance);
  height = softFloor(height, WATER_LEVEL + 0.7, 2.4);
  height = carveRiver(riverDistance, riverHit.y, height);
  height = waterBasinAndCarve(x, z, height);

  const distance = queryPath(roadIndex, x, z, roadLookup);
  if (distance < PATH_FAR) {
    const target = roadLookup.y;

    // Cut and fill. Where the hillside stands well above the graded track the
    // corridor reaches further, because that is a cutting with a bank above it;
    // where the track stands above the land it is a narrower embankment. A
    // constant-width corridor is the giveaway that a road was stamped onto the
    // terrain rather than dug into it.
    // A governed road climbing a mountain sits in a deep cutting, and a cutting
    // needs a batter or it is a trench with vertical walls. The corridor widens
    // roughly in step with the depth, out to the limit the road index can
    // answer distance queries for.
    const rise = Math.abs(height - target);
    const shoulder = ROAD_HALF_WIDTH + 3.4 + clamp01(rise / 16) * 13;

    if (distance < shoulder) {
      const t =
        distance <= ROAD_HALF_WIDTH
          ? 1
          : 1 -
            fade(
              (distance - ROAD_HALF_WIDTH) / (shoulder - ROAD_HALF_WIDTH)
            );
      height = height * (1 - t) + target * t;
    }
  }

  return height;
}

/** Surface normal, from finite differences on `heightAt`. */
export function normalAt(x: number, z: number, epsilon = 0.6): THREE.Vector3 {
  const hL = heightAt(x - epsilon, z);
  const hR = heightAt(x + epsilon, z);
  const hD = heightAt(x, z - epsilon);
  const hU = heightAt(x, z + epsilon);
  return new THREE.Vector3(hL - hR, 2 * epsilon, hD - hU).normalize();
}

/** How steep the ground is at a point, 0 (flat) to 1 (cliff). */
export function slopeAt(x: number, z: number): number {
  return 1 - normalAt(x, z).y;
}

// ---------------------------------------------------------------------------
// Scattering
// ---------------------------------------------------------------------------

export type Scatter = {
  x: number;
  z: number;
  y: number;
  scale: number;
  rotation: number;
  variant: number;
};

/**
 * Deterministically scatters props across the terrain, rejecting anywhere they
 * would look wrong: in the water, on a cliff, or in the middle of the road.
 *
 * `centerX` / `centerZ` / `spread` restrict placement to a disc. At 640 metres
 * across, a uniform scatter over the whole world puts a few hundred trees at
 * one per twelve hundred square metres, which is an empty plain with the
 * occasional shrub in it. Density belongs where the camera is.
 */
export function scatter(
  count: number,
  options: {
    seed: number;
    minRoadDistance?: number;
    maxSlope?: number;
    minHeight?: number;
    maxHeight?: number;
    scaleRange?: [number, number];
    variants?: number;
    /** Bias placement toward the road (1) or away from it (-1). */
    roadAffinity?: number;
    /** Optional disc to place within, instead of the whole world. */
    centerX?: number;
    centerZ?: number;
    spread?: number;
    /** Keep this far clear of standing water. */
    minWaterDistance?: number;
  }
): Scatter[] {
  const {
    seed,
    minRoadDistance = 0,
    maxSlope = 0.45,
    minHeight = WATER_LEVEL + 0.4,
    maxHeight = 200,
    scaleRange = [0.8, 1.3],
    variants = 1,
    roadAffinity = 0,
    centerX = 0,
    centerZ = 0,
    spread = 0,
    minWaterDistance = 0,
  } = options;

  const results: Scatter[] = [];
  // Inset from the mesh edge, so nothing hangs off the end of the world.
  const half = (WORLD_SIZE / 2) * 0.97;
  // Try generously — rejection sampling throws most candidates away.
  const attempts = count * 18;

  for (let i = 0; i < attempts && results.length < count; i++) {
    const ra = hash2(seed + i * 3, seed * 7 + i);
    const rb = hash2(seed * 13 + i, seed + i * 5);

    let x: number;
    let z: number;
    if (spread > 0) {
      const angle = ra * Math.PI * 2;
      // sqrt, or every disc comes out with a bullseye in the middle of it.
      const radius = Math.sqrt(rb) * spread;
      x = centerX + Math.cos(angle) * radius;
      z = centerZ + Math.sin(angle) * radius;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
    } else {
      x = (ra - 0.5) * 2 * half;
      z = (rb - 0.5) * 2 * half;
    }

    const roadDistance = distanceToRoad(x, z);
    if (roadDistance < minRoadDistance) continue;
    if (minWaterDistance > 0 && distanceToWater(x, z) < minWaterDistance) continue;

    if (roadAffinity !== 0) {
      // Accept probabilistically based on how close to the road we want things.
      const nearness = Math.max(0, 1 - roadDistance / 26);
      const want = roadAffinity > 0 ? nearness : 1 - nearness;
      if (hash2(seed * 31 + i, i * 17) > want * 0.9 + 0.1) continue;
    }

    const y = heightAt(x, z);
    if (y < minHeight || y > maxHeight) continue;
    if (slopeAt(x, z) > maxSlope) continue;

    const s = hash2(seed * 3 + i, seed * 11 + i);
    results.push({
      x,
      z,
      y,
      scale: scaleRange[0] + s * (scaleRange[1] - scaleRange[0]),
      rotation: hash2(i, seed + i) * Math.PI * 2,
      variant: Math.floor(hash2(seed + i * 19, i * 23) * variants) % variants,
    });
  }

  return results;
}

/**
 * Scatters props in a band following the road network, in clumps.
 *
 * Rejection-sampling the whole 640×640 world is the wrong tool for ground
 * cover: spreading a few thousand blades over 400,000 m² gives well under one
 * blade per square metre, which reads as a bald field with occasional spikes
 * rather than as grass. The camera only ever travels the roads, so density
 * belongs there.
 *
 * Clumps are distributed along the network in proportion to each road's length,
 * so a short spur doesn't end up with the same verge density as the circuit.
 * Placement within a clump is clustered rather than uniform, because real
 * ground cover grows in tufts — evenly spaced blades look like a hairbrush.
 */
export function scatterAlongRoad(
  count: number,
  options: {
    seed: number;
    /** Half-width of the band either side of the road centre line. */
    width: number;
    /** Blades per clump. */
    clumpSize?: number;
    /** Radius of a clump. */
    clumpRadius?: number;
    minRoadDistance?: number;
    maxSlope?: number;
    scaleRange?: [number, number];
    variants?: number;
  }
): Scatter[] {
  const {
    seed,
    width,
    clumpSize = 7,
    clumpRadius = 0.85,
    minRoadDistance = 0,
    maxSlope = 0.5,
    scaleRange = [0.7, 1.3],
    variants = 1,
  } = options;

  const results: Scatter[] = [];
  const clumps = Math.ceil(count / clumpSize);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  for (let c = 0; c < clumps && results.length < count; c++) {
    const along = ((c + 0.5) / clumps) * roadTotalLength;
    let road = 0;
    let consumed = 0;
    while (road < ROADS.length - 1 && consumed + roadLengths[road] < along) {
      consumed += roadLengths[road];
      road++;
    }

    // Jittered, so clump centres don't band up at a regular interval.
    const t = Math.min(
      0.9995,
      clamp01((along - consumed) / roadLengths[road]) +
        hash2(seed + c, c * 7) * 0.008
    );

    const curve = ROADS[road];
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent);

    // Perpendicular to the road, in the ground plane.
    const perpX = tangent.z;
    const perpZ = -tangent.x;

    // Push clumps off the road surface itself and out toward the verge.
    const side = hash2(seed * 3 + c, c * 11) < 0.5 ? -1 : 1;
    const offset =
      side *
      (ROAD_HALF_WIDTH * 0.75 +
        hash2(seed * 5 + c, c * 13) * (width - ROAD_HALF_WIDTH * 0.75));

    const cx = point.x + perpX * offset;
    const cz = point.z + perpZ * offset;

    for (let b = 0; b < clumpSize && results.length < count; b++) {
      const index = c * clumpSize + b;
      const angle = hash2(seed + index * 3, index) * Math.PI * 2;
      // sqrt keeps blades from bunching at the clump centre.
      const radius = Math.sqrt(hash2(index * 5, seed + index)) * clumpRadius;
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;

      if (distanceToRoad(x, z) < minRoadDistance) continue;
      if (slopeAt(x, z) > maxSlope) continue;
      if (distanceToWater(x, z) < 1) continue;

      const y = heightAt(x, z);
      if (y < WATER_LEVEL + 0.3) continue;

      const s = hash2(seed * 7 + index, index * 17);
      results.push({
        x,
        z,
        y,
        scale: scaleRange[0] + s * (scaleRange[1] - scaleRange[0]),
        rotation: hash2(index, seed * 19 + index) * Math.PI * 2,
        variant:
          Math.floor(hash2(seed + index * 23, index * 29) * variants) % variants,
      });
    }
  }

  return results;
}

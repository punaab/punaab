/**
 * The named places of the valley.
 *
 * A 640-metre world that is all one biome is a noise field with trees on it.
 * What makes somewhere feel like a *place* is that it has a name, an edge you
 * can feel yourself crossing, and a character the rest of the world respects —
 * so this file is the authority the terrain, the flora, the settlements and the
 * bard's itinerary all defer to when they ask "where am I and what grows here".
 *
 * Region centres are chosen to sit on the landforms hand-placed in
 * `terrain.ts` (the massifs, basins and plateau fields there use the same
 * coordinates). Move a region and you must move its landform, or you will end
 * up with a marsh halfway up a mountain.
 *
 * Deliberately dependency-free: it is pure geometry over a constant table, so
 * `terrain.ts` can import it without a cycle, and a route handler can import it
 * without pulling three.js into the server bundle.
 */

export type BiomeId =
  | "meadow"
  | "broadleaf"
  | "pine"
  | "highland"
  | "marsh"
  | "shore"
  | "farmland"
  | "orchard"
  | "heath"
  | "badlands";

export type Region = {
  id: string;
  name: string;
  biome: BiomeId;
  x: number;
  z: number;
  radius: number;
  /** One in-world sentence, shown to the player on crossing the border. */
  blurb: string;
};

/**
 * Fourteen regions across all ten biomes. North is -Z, east is +X.
 *
 * The layout is a watershed, not a patchwork: the high ground is north and
 * north-east, everything drains south and west, and the wettest land (the fen,
 * the mere) sits lowest. Walk downhill from anywhere and you reach water.
 */
export const REGIONS: Region[] = [
  {
    id: "wanderers-green",
    name: "Wanderer's Green",
    biome: "meadow",
    x: 0,
    z: 10,
    radius: 105,
    blurb:
      "Soft country and good walking, under a sky that has never once made up its mind.",
  },
  {
    id: "barleyhearth",
    name: "Barleyhearth",
    biome: "farmland",
    x: -95,
    z: 60,
    radius: 92,
    blurb:
      "Every field here has a name, and every name has an old grudge folded into it.",
  },
  {
    id: "saltmere",
    name: "Saltmere Strand",
    biome: "shore",
    x: -160,
    z: 190,
    radius: 96,
    blurb:
      "The mere throws salt up on a west wind, and nobody in four hundred years has explained why.",
  },
  {
    id: "cidergarth",
    name: "Cidergarth",
    biome: "orchard",
    x: -52,
    z: 212,
    radius: 82,
    blurb:
      "Old trees, older families, and cider strong enough to settle an argument permanently.",
  },
  {
    id: "elderloom",
    name: "Elderloom Wood",
    biome: "broadleaf",
    x: 58,
    z: 190,
    radius: 96,
    blurb:
      "The canopy closes over the road here, and every sound you make comes back wrong.",
  },
  {
    id: "thornwake",
    name: "Thornwake Fen",
    biome: "marsh",
    x: 176,
    z: 132,
    radius: 100,
    blurb:
      "Keep to the causeway — the fen has swallowed better travellers than you, and kept them.",
  },
  {
    id: "ashenreach",
    name: "Ashenreach",
    biome: "badlands",
    x: 196,
    z: -84,
    radius: 104,
    blurb:
      "Wind-cut terraces of red stone, where nothing grows and nothing is forgiven.",
  },
  {
    id: "kestrel-march",
    name: "The Kestrel March",
    biome: "highland",
    x: 214,
    z: -238,
    radius: 108,
    blurb:
      "Bare crag and thin air, patrolled by birds that have never had reason to fear a person.",
  },
  {
    id: "greyneedle",
    name: "Greyneedle Wood",
    biome: "pine",
    x: 36,
    z: -152,
    radius: 104,
    blurb:
      "Pines packed close as a crowd, and a hand's depth of needles where the path should be.",
  },
  {
    id: "skarnfell",
    name: "Skarnfell Heights",
    biome: "highland",
    x: -10,
    z: -252,
    radius: 118,
    blurb:
      "Every river in the valley is born up here, out of snow that never entirely goes.",
  },
  {
    id: "hollowmoor",
    name: "The Hollowmoor",
    biome: "heath",
    x: -156,
    z: -146,
    radius: 106,
    blurb:
      "Heather to the horizon, and a wind that carries the sound of something else walking.",
  },
  {
    id: "tarnwild",
    name: "The Tarnwild",
    biome: "pine",
    x: -244,
    z: -34,
    radius: 100,
    blurb:
      "Fell pine and black tarns, west of anywhere a sensible person has business being.",
  },
  {
    id: "bracken-hollow",
    name: "Bracken Hollow",
    biome: "broadleaf",
    x: 128,
    z: 22,
    radius: 78,
    blurb:
      "A warm dip in the land where the bracken stands waist-high by midsummer.",
  },
  {
    id: "sunder-flats",
    name: "The Sunder Flats",
    biome: "heath",
    x: 250,
    z: 214,
    radius: 104,
    blurb:
      "Where the fen finally drains away east, through the one gap the mountains left open.",
  },
];

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Falloff exponent for the blend kernel.
 *
 * Higher makes each region's core more purely itself and its border narrower;
 * lower turns the whole valley into mush. Around 3 is the point where a border
 * takes about twenty paces to cross — long enough not to be a line, short
 * enough that you notice you crossed it.
 */
const FALLOFF = 3.2;

/**
 * Softening term. Without it the weight at a region's exact centre is 1/0 —
 * infinite, and NaN once it meets another infinity in the normalisation.
 */
const SOFTEN = 0.06;

/**
 * Weights below `CULL_LO` are faded out entirely so callers aren't handed
 * fifteen entries of which twelve are noise. The fade is a ramp rather than a
 * threshold precisely because a threshold would put a hard line in the world at
 * the one-percent contour — the exact artefact this whole function exists to
 * avoid.
 */
const CULL_LO = 0.006;
const CULL_HI = 0.02;

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Scratch, so the per-region weights don't allocate on every query. */
const weightScratch = new Float64Array(REGIONS.length);

function computeWeights(x: number, z: number): number {
  let total = 0;
  for (let i = 0; i < REGIONS.length; i++) {
    const region = REGIONS[i];
    const dx = x - region.x;
    const dz = z - region.z;
    // Distance measured in region radii, so a large region reaches further
    // without needing a separate strength field.
    const u = Math.sqrt(dx * dx + dz * dz) / region.radius;
    const w = 1 / (Math.pow(u, FALLOFF) + SOFTEN);
    weightScratch[i] = w;
    total += w;
  }
  return total;
}

/** The region a point belongs to — the nearest one, measured in its own radii. */
export function regionAt(x: number, z: number): Region {
  let best = REGIONS[0];
  let bestScore = Infinity;
  for (let i = 0; i < REGIONS.length; i++) {
    const region = REGIONS[i];
    const dx = x - region.x;
    const dz = z - region.z;
    const score = (dx * dx + dz * dz) / (region.radius * region.radius);
    if (score < bestScore) {
      bestScore = score;
      best = region;
    }
  }
  return best;
}

/**
 * The biome of the region a point belongs to.
 *
 * Deliberately the *named* region's biome and not the argmax of
 * `biomeWeights`, so the biome a caller acts on always agrees with the place
 * name shown on screen. Nothing is more confusing than a banner reading
 * "Thornwake Fen" over a pine forest.
 */
export function biomeAt(x: number, z: number): BiomeId {
  return regionAt(x, z).biome;
}

/** Smooth blend weights so biomes never meet on a hard line. Sums to 1. */
export function biomeWeights(
  x: number,
  z: number
): Partial<Record<BiomeId, number>> {
  const total = computeWeights(x, z);

  // Fold the per-region weights down onto biomes: two pine regions on opposite
  // sides of the map should hand a caller one "pine" number, not two.
  const merged: Partial<Record<BiomeId, number>> = {};
  for (let i = 0; i < REGIONS.length; i++) {
    const biome = REGIONS[i].biome;
    const share = weightScratch[i] / total;
    merged[biome] = (merged[biome] ?? 0) + share;
  }

  let kept = 0;
  for (const key of Object.keys(merged) as BiomeId[]) {
    const faded =
      (merged[key] as number) *
      smoothstep(((merged[key] as number) - CULL_LO) / (CULL_HI - CULL_LO));
    if (faded <= 0) delete merged[key];
    else {
      merged[key] = faded;
      kept += faded;
    }
  }

  // Renormalise after the fade so the contract still holds.
  if (kept > 0) {
    for (const key of Object.keys(merged) as BiomeId[]) {
      merged[key] = (merged[key] as number) / kept;
    }
  } else {
    // Unreachable with the current table — the kernel has infinite support —
    // but if every region were ever culled, fall back to the nearest one rather
    // than handing back an empty map that sums to zero.
    merged[regionAt(x, z).biome] = 1;
  }

  return merged;
}

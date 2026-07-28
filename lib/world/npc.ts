/**
 * Who lives here.
 *
 * A valley with buildings and no people in it reads as an evacuation. This is
 * the census: every person and animal in the world, where they belong, and how
 * far they will stray from it.
 *
 * The rule the whole file follows is that *nobody is placed abstractly*. A
 * merchant stands at a market stall because there is a market stall there; a
 * fisher is at a dock; monks are at the chapel; deer are in the deep pinewood
 * and nowhere near a road. Settlements come from `settlements.ts` and wild
 * country from `regions.ts`, so if a village moves its villagers move with it
 * and nothing has to be re-authored.
 *
 * Everything is deterministic — integer hashes, no `Math.random()` — so the
 * same forty-odd people stand in the same places on every load and on every
 * machine. Spawn points are also validated at build time against the terrain
 * (above water, off cliffs) and against structure footprints, so an NPC starts
 * on ground it could actually stand on. The one case that cannot be settled
 * here is a spawn that lands inside a collider registered later at runtime;
 * `components/world/NPCs.tsx` runs `nearestClearPoint` once on its first frame
 * to shake those loose.
 */

import type { Collider } from "./collision";
import { REGIONS, type BiomeId } from "./regions";
import { SETTLEMENTS, STRUCTURES, type Settlement, type Structure, type StructureKind } from "./settlements";
import { WATERS, WATER_LEVEL, WORLD_SIZE, heightAt, nearestRoadPoint, slopeAt } from "./terrain";

export type NpcKind =
  | "villager"
  | "merchant"
  | "guard"
  | "farmer"
  | "child"
  | "monk"
  | "hunter"
  | "fisher"
  | "sheep"
  | "chicken"
  | "deer"
  | "cow"
  | "goat";

export type NpcSpawn = {
  id: string;
  kind: NpcKind;
  name?: string;
  x: number;
  z: number;
  /** Settlement id, where the NPC belongs to one. */
  homeId?: string;
  wanderRadius: number;
  /** Metres per second at a comfortable pace. */
  speed: number;
  /** Deterministic index into the per-kind palette table in `humanoid.ts`. */
  palette: number;
};

/** The kinds drawn as instanced animals rather than as articulated rigs. */
export const ANIMAL_KINDS = ["sheep", "chicken", "deer", "cow", "goat"] as const;
export type NpcAnimalKind = (typeof ANIMAL_KINDS)[number];

const ANIMAL_SET: ReadonlySet<string> = new Set<string>(ANIMAL_KINDS);

export function isAnimal(kind: NpcKind): kind is NpcAnimalKind {
  return ANIMAL_SET.has(kind);
}

/** How many appearances a kind can produce. `palette` indexes this range. */
export const PALETTE_COUNT = 32;

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/**
 * Integer hash -> [0, 1). Lifted from `terrain.ts`.
 *
 * `Math.imul` is not decoration. A plain `*` on these constants runs past 2^53
 * and the float quietly drops its low bits — which are the whole output of a
 * hash. This exact mistake has shipped in this repo before and pushed every
 * scattered prop into one corner of the map; a spawn table written that way
 * would put the entire population in one field.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Behaviour by kind
// ---------------------------------------------------------------------------

type Behaviour = {
  /** Metres per second. */
  speed: number;
  /** Default leash length from the spawn point. */
  wander: number;
  /** Body radius, for collision and for keeping out of each other's way. */
  radius: number;
};

/**
 * Speeds are ambles, not marches. A person crossing a village at a true 1.4 m/s
 * looks like they are late for something, and forty people all late for
 * something reads as a fire drill.
 */
const BEHAVIOUR: Record<NpcKind, Behaviour> = {
  villager: { speed: 1.02, wander: 10, radius: 0.34 },
  // Minding a stall. He moves around it, not away from it.
  merchant: { speed: 0.76, wander: 4.5, radius: 0.36 },
  guard: { speed: 1.12, wander: 7, radius: 0.4 },
  farmer: { speed: 0.94, wander: 16, radius: 0.36 },
  child: { speed: 1.55, wander: 13, radius: 0.24 },
  monk: { speed: 0.7, wander: 8, radius: 0.34 },
  hunter: { speed: 1.26, wander: 26, radius: 0.36 },
  fisher: { speed: 0.88, wander: 7, radius: 0.36 },
  sheep: { speed: 0.48, wander: 12, radius: 0.42 },
  chicken: { speed: 0.7, wander: 5, radius: 0.16 },
  deer: { speed: 1.7, wander: 34, radius: 0.46 },
  cow: { speed: 0.4, wander: 15, radius: 0.62 },
  goat: { speed: 0.6, wander: 14, radius: 0.36 },
};

export function npcRadius(kind: NpcKind): number {
  return BEHAVIOUR[kind].radius;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const GIVEN = [
  "Aldith", "Bryn", "Cadoc", "Deri", "Efa", "Gethin", "Hilda", "Idris",
  "Kelda", "Lowri", "Maelor", "Nesta", "Orin", "Peris", "Rhian", "Selwyn",
  "Tegan", "Ulf", "Vann", "Wyn", "Aneira", "Brochan", "Cerys", "Dafyd",
  "Enid", "Fenwick", "Gwilym", "Hedd", "Ivor", "Jonet",
];

const FAMILY = [
  "Ashdown", "Barrow", "Coppice", "Dunmore", "Elmroot", "Fallow", "Garrow",
  "Haywood", "Ingleby", "Kettle", "Larkspur", "Millward", "Netherby",
  "Oakhand", "Pyefinch", "Quarles", "Redfern", "Sallow", "Thistlewaite",
  "Underhill", "Vance", "Wexford", "Yarrow", "Ashgrove",
];

function nameFor(seed: number): string {
  const given = GIVEN[Math.floor(hash2(seed, 3121) * GIVEN.length) % GIVEN.length];
  const family = FAMILY[Math.floor(hash2(seed, 5333) * FAMILY.length) % FAMILY.length];
  return `${given} ${family}`;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** Inset from the mesh edge, so nobody stands off the end of the world. */
const EDGE = (WORLD_SIZE / 2) * 0.94;

/** Distance out to the nearest standing water; negative inside it. */
function waterGap(x: number, z: number): number {
  let best = Infinity;
  for (const water of WATERS) {
    const gap = Math.hypot(x - water.x, z - water.z) - water.radius;
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * Structures within reach of an anchor.
 *
 * Gathered once per anchor and then reused across every candidate position, so
 * the inner rejection loop never touches the full structure list. A linear scan
 * is fine at this granularity — there are a few dozen anchors in the world, and
 * this runs once at module load.
 */
function structuresNear(x: number, z: number, radius: number): Structure[] {
  const out: Structure[] = [];
  for (const structure of STRUCTURES) {
    if (Math.hypot(structure.x - x, structure.z - z) <= radius + structure.radius) {
      out.push(structure);
    }
  }
  return out;
}

type PlaceOptions = {
  min: number;
  max: number;
  /** Gap to leave outside a structure's footprint. */
  clearance: number;
  maxSlope: number;
  /** Stay at least this far from open water. Negative allows the shallows. */
  minWater: number;
  local: readonly Structure[];
};

/**
 * A standable spot in an annulus around an anchor.
 *
 * Rejection sampling, first acceptable candidate wins. Where nothing is
 * acceptable — a goat on a crag, a hut wedged between two barns — the least
 * steep candidate is returned rather than nothing: losing an NPC entirely is a
 * worse failure than one standing somewhere awkward, and the runtime un-stick
 * pass will move them if they are genuinely inside geometry.
 */
function place(
  anchorX: number,
  anchorZ: number,
  seed: number,
  options: PlaceOptions
): { x: number; z: number } {
  const { min, max, clearance, maxSlope, minWater, local } = options;

  let bestX = anchorX;
  let bestZ = anchorZ;
  let bestSlope = Infinity;

  for (let i = 0; i < 20; i++) {
    const angle = hash2(seed + i * 7, seed * 13 + i) * TAU;
    // sqrt, or every group comes out with a ring around an empty middle.
    const radius = min + Math.sqrt(hash2(seed * 3 + i, seed + i * 11)) * (max - min);
    const x = anchorX + Math.cos(angle) * radius;
    const z = anchorZ + Math.sin(angle) * radius;

    if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) continue;

    let blocked = false;
    for (const structure of local) {
      if (Math.hypot(structure.x - x, structure.z - z) < structure.radius + clearance) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    if (waterGap(x, z) < minWater) continue;
    if (heightAt(x, z) < WATER_LEVEL + 0.5) continue;

    const slope = slopeAt(x, z);
    if (slope <= maxSlope) return { x, z };
    if (slope < bestSlope) {
      bestSlope = slope;
      bestX = x;
      bestZ = z;
    }
  }

  return { x: bestX, z: bestZ };
}

// ---------------------------------------------------------------------------
// Who stands where
// ---------------------------------------------------------------------------

type Post = {
  kind: NpcKind;
  /** Structures this role belongs beside, in order of preference. */
  near: StructureKind[];
  min: number;
  max: number;
};

const POSTS: Record<string, Post> = {
  villager: {
    kind: "villager",
    near: ["cottage", "longhouse", "well", "inn", "forge"],
    min: 3.5,
    max: 12,
  },
  merchant: {
    kind: "merchant",
    near: ["market_stall", "cart", "inn"],
    min: 1.8,
    max: 4.5,
  },
  guard: {
    kind: "guard",
    near: ["gate", "watchtower", "bridge"],
    min: 2.4,
    max: 6,
  },
  farmer: {
    kind: "farmer",
    near: ["barn", "windmill", "haystack", "fence"],
    min: 4,
    max: 20,
  },
  child: {
    kind: "child",
    near: ["well", "market_stall", "cottage"],
    min: 3,
    max: 13,
  },
  monk: {
    kind: "monk",
    near: ["chapel", "shrine", "standing_stones"],
    min: 3,
    max: 10,
  },
  hunter: {
    kind: "hunter",
    near: ["camp", "ruin", "woodpile"],
    min: 3,
    max: 15,
  },
  fisher: {
    kind: "fisher",
    near: ["dock", "bridge"],
    min: 2,
    max: 8,
  },
};

/**
 * The crew of each kind of settlement.
 *
 * Sized so a plausible spread of settlements lands around fifty people — busy
 * enough that a town has a crowd in it and a hamlet does not, without either
 * becoming a rig-count problem.
 */
const ROSTERS: Record<Settlement["kind"], string[]> = {
  town: ["villager", "merchant", "villager", "guard", "merchant", "child", "villager", "farmer"],
  village: ["villager", "merchant", "villager", "child", "guard"],
  hamlet: ["villager", "farmer", "child"],
  port: ["fisher", "merchant", "fisher", "villager", "guard"],
  holy: ["monk", "monk", "monk", "villager"],
  camp: ["hunter", "hunter", "villager"],
  industry: ["villager", "villager", "guard"],
  ruin: ["hunter"],
};

/** What is kept, penned or scratching about at each kind of settlement. */
const STOCK: Record<Settlement["kind"], NpcKind[]> = {
  town: ["chicken", "chicken", "cow"],
  village: ["chicken", "chicken", "chicken", "sheep", "sheep"],
  hamlet: ["chicken", "chicken", "sheep", "goat"],
  port: ["chicken", "chicken"],
  holy: ["goat", "goat", "chicken"],
  camp: [],
  industry: ["goat"],
  ruin: [],
};

/**
 * What lives in wild country, by biome.
 *
 * Deer belong where nobody goes — the deep pine and the closed broadleaf — and
 * the moment they are also standing in the meadow beside the road they stop
 * being wildlife and become scenery. Grazing stock is the opposite: it belongs
 * on worked ground, because somebody put it there.
 */
const WILDLIFE: Partial<Record<BiomeId, NpcKind[]>> = {
  farmland: ["sheep", "sheep", "sheep", "sheep", "cow", "cow", "cow", "chicken"],
  meadow: ["sheep", "sheep", "sheep", "goat", "goat", "deer"],
  heath: ["goat", "goat", "goat", "sheep", "sheep", "deer"],
  orchard: ["goat", "goat", "chicken", "chicken", "sheep"],
  pine: ["deer", "deer", "deer", "deer"],
  broadleaf: ["deer", "deer", "deer"],
  highland: ["goat", "goat", "goat"],
  shore: ["goat", "sheep"],
  marsh: ["deer"],
  badlands: [],
};

/**
 * Ceiling on articulated bodies.
 *
 * Animals are instanced and effectively free; people are not — each one is a
 * dozen meshes and a joint hierarchy. If the settlement layer ever grows past
 * this the extra villages get animals and scenery but no crowd, which is far
 * less noticeable than a frame budget spent entirely on people nobody is
 * looking at.
 */
const MAX_PEOPLE = 56;

// ---------------------------------------------------------------------------
// The census
// ---------------------------------------------------------------------------

function buildNpcs(): NpcSpawn[] {
  const spawns: NpcSpawn[] = [];
  let serial = 0;
  let people = 0;

  const emit = (
    kind: NpcKind,
    x: number,
    z: number,
    homeId: string | undefined,
    wanderScale: number
  ) => {
    const seed = serial * 2654435761 + 40503;
    const behaviour = BEHAVIOUR[kind];
    const animal = isAnimal(kind);

    spawns.push({
      id: `${kind}-${serial}`,
      kind,
      name: animal ? undefined : nameFor(seed),
      x,
      z,
      homeId,
      wanderRadius: behaviour.wander * wanderScale,
      // A crowd that all moves at exactly the same speed reads as a formation.
      speed: behaviour.speed * (0.86 + hash2(seed, 71) * 0.3),
      palette: Math.floor(hash2(seed, 97) * PALETTE_COUNT) % PALETTE_COUNT,
    });

    serial++;
    if (!animal) people++;
  };

  // --- Settlements --------------------------------------------------------

  const bySettlement = new Map<string, Structure[]>();
  for (const structure of STRUCTURES) {
    if (!structure.settlementId) continue;
    const list = bySettlement.get(structure.settlementId);
    if (list) list.push(structure);
    else bySettlement.set(structure.settlementId, [structure]);
  }

  for (const settlement of SETTLEMENTS) {
    const owned = bySettlement.get(settlement.id) ?? [];
    // Anything standing in this settlement, whether or not it was tagged with
    // the settlement id — a bridge or a fence placed by the terrain pass still
    // blocks a doorway.
    const local = structuresNear(settlement.x, settlement.z, settlement.radius + 24);

    const roster = ROSTERS[settlement.kind] ?? ROSTERS.hamlet;
    for (let i = 0; i < roster.length; i++) {
      if (people >= MAX_PEOPLE) break;
      const post = POSTS[roster[i]];
      if (!post) continue;

      // Anchor on the best matching building this settlement actually has,
      // cycling through the matches so five villagers live in five cottages
      // rather than all queueing outside the first one.
      let anchorX = settlement.x;
      let anchorZ = settlement.z;
      let min = post.min;
      let max = Math.min(post.max, Math.max(post.min + 4, settlement.radius * 0.75));

      const matches: Structure[] = [];
      for (const wanted of post.near) {
        for (const structure of owned) {
          if (structure.kind === wanted) matches.push(structure);
        }
        if (matches.length > 0) break;
      }

      if (matches.length > 0) {
        const chosen = matches[i % matches.length];
        anchorX = chosen.x;
        anchorZ = chosen.z;
        min = Math.max(post.min, chosen.radius + 0.8);
        max = Math.max(min + 2.5, post.max);
      }

      const spot = place(anchorX, anchorZ, serial * 977 + 13, {
        min,
        max,
        clearance: 0.9,
        maxSlope: 0.42,
        // Fishers work the waterline; everyone else keeps their boots dry.
        minWater: post.kind === "fisher" ? -1.5 : 2.5,
        local,
      });

      emit(post.kind, spot.x, spot.z, settlement.id, 1);
    }

    const stock = STOCK[settlement.kind] ?? [];
    for (const kind of stock) {
      const spot = place(settlement.x, settlement.z, serial * 613 + 71, {
        min: settlement.radius * 0.3,
        max: Math.max(settlement.radius * 0.9, 14),
        clearance: 1.2,
        maxSlope: 0.4,
        minWater: 3,
        local,
      });
      // Penned stock does not roam the way a hill flock does.
      emit(kind, spot.x, spot.z, settlement.id, 0.55);
    }
  }

  // --- Wild country -------------------------------------------------------

  for (const region of REGIONS) {
    const wild = WILDLIFE[region.biome];
    if (!wild || wild.length === 0) continue;

    const local = structuresNear(region.x, region.z, region.radius * 0.75 + 20);

    // One herd centre per species, then everybody within a few paces of it.
    // Scattering animals independently over a hundred metres is not a flock, it
    // is wallpaper — the clumping is most of what makes a field read as pasture
    // rather than as terrain with sheep sprinkled on.
    const counts = new Map<NpcKind, number>();
    for (const kind of wild) counts.set(kind, (counts.get(kind) ?? 0) + 1);

    let herdIndex = 0;
    for (const [kind, count] of counts) {
      herdIndex++;
      const shy = kind === "deer";

      const centre = place(region.x, region.z, serial * 733 + herdIndex * 101, {
        min: region.radius * 0.15,
        max: region.radius * 0.6,
        clearance: 6,
        // Deer keep to broken ground; stock wants somewhere it can stand.
        maxSlope: shy ? 0.55 : 0.36,
        minWater: 5,
        local,
      });

      for (let i = 0; i < count; i++) {
        const spot = place(centre.x, centre.z, serial * 449 + 29, {
          min: 1.5,
          max: shy ? 22 : 11,
          clearance: 1.4,
          maxSlope: shy ? 0.6 : 0.42,
          minWater: 2.5,
          local,
        });
        emit(kind, spot.x, spot.z, undefined, shy ? 1 : 0.8);
      }
    }
  }

  // --- Travellers ---------------------------------------------------------

  // A floor under the population, and the only spawns not tied to a building.
  // If the settlement pass produced little — an empty table during integration,
  // a world generated without settlements — the roads still have people on
  // them, which is the difference between a quiet valley and an abandoned one.
  if (people < 14) {
    const walkable: BiomeId[] = ["meadow", "farmland", "orchard", "broadleaf", "shore"];
    const kinds: NpcKind[] = ["villager", "merchant", "hunter", "farmer", "monk"];
    let index = 0;

    for (const region of REGIONS) {
      if (people >= 14) break;
      if (!walkable.includes(region.biome)) continue;

      // Snapped to the road network: a traveller belongs on a road, and it is
      // also the one line through the wilderness guaranteed to be walkable.
      const road = nearestRoadPoint(region.x, region.z);
      const spot = place(road.x, road.z, serial * 271 + 7, {
        min: 2,
        max: 9,
        clearance: 1.2,
        maxSlope: 0.4,
        minWater: 3,
        local: structuresNear(road.x, road.z, 40),
      });

      emit(kinds[index % kinds.length], spot.x, spot.z, undefined, 2.4);
      index++;
    }
  }

  return spawns;
}

export const NPCS: NpcSpawn[] = buildNpcs();

/**
 * Footprints for the collision registry.
 *
 * Every one is `solid: false`, and that is deliberate rather than lazy. The
 * registry is static — there is no way to move a collider once registered — but
 * these are the only things in the world that walk. A solid footprint left at a
 * spawn point would become a phantom wall the moment its owner strolled away
 * from it, and forty invisible walls scattered through the villages is a far
 * worse bug than being able to walk through a sheep.
 *
 * NPCs avoid each other through the live neighbour grid in
 * `components/world/NPCs.tsx` instead. What these entries are for is queries:
 * `collidersNear` gives anything asking "who is standing here" a name and a
 * kind to work with.
 */
export function npcColliders(): Collider[] {
  return NPCS.map((npc) => ({
    id: `npc:${npc.id}`,
    x: npc.x,
    z: npc.z,
    radius: BEHAVIOUR[npc.kind].radius,
    solid: false,
    kind: `npc:${npc.kind}`,
    label: npc.name,
  }));
}

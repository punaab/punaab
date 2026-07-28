/**
 * Walkable surface height — terrain plus decks that sit above it.
 *
 * `heightAt` is the ground. Bridges and docks are road/water structures whose
 * decks float above that ground; without them the bard (and anyone else)
 * samples the riverbed under a span and walks *through* the deck.
 */

import {
  GROUND_FOOTPRINTS,
  STRUCTURES,
  type Structure,
  type StructureKind,
} from "./settlements";
import { heightAt, WATER_LEVEL } from "./terrain";
import { bridgeDeckWorldY, bridgeParam, bridgeProfile } from "./bridges";

/** Local deck-top Y for kinds whose mesh origin is not the walkable plane. */
const DECK_LOCAL_Y: Partial<Record<StructureKind, number>> = {
  // Deck boards sit at local y ≈ 0.95; group origin is the waterline.
  dock: 0.95,
  // Bridge deck boxes are centred at y = -0.13 with height 0.26 → top at 0.
  bridge: 0,
};

const WALKABLE_KINDS = new Set<StructureKind>(["bridge", "dock"]);

const DECKS: Structure[] = STRUCTURES.filter((s) => WALKABLE_KINDS.has(s.kind));

/**
 * World → structure-local XZ. Matches the three.js Y-rotation convention used
 * by Architecture / lowestGroundUnder: local +X → (cos, −sin), local +Z → (sin, cos).
 */
function localXZ(s: Structure, x: number, z: number): { lx: number; lz: number } {
  const dx = x - s.x;
  const dz = z - s.z;
  const cos = Math.cos(s.rotation);
  const sin = Math.sin(s.rotation);
  return {
    lx: dx * cos - dz * sin,
    lz: dx * sin + dz * cos,
  };
}

function onWalkableDeck(s: Structure, x: number, z: number): boolean {
  const footprint = GROUND_FOOTPRINTS[s.kind];
  const { lx, lz } = localXZ(s, x, z);
  // Inset a little so parapet / edge stones do not count as the road surface.
  const inset = s.kind === "bridge" ? 0.2 : 0.12;
  const hw = footprint.halfWidth * s.scale - inset;
  const hd = footprint.halfDepth * s.scale - inset;
  if (hw <= 0 || hd <= 0) return false;
  return Math.abs(lx) <= hw && Math.abs(lz) <= hd;
}

function deckTopY(s: Structure): number {
  const local = DECK_LOCAL_Y[s.kind] ?? 0;
  // Architecture places docks at WATER_LEVEL; bridges/gates keep structure.y.
  const originY = s.kind === "dock" ? WATER_LEVEL : s.y;
  return originY + local * s.scale;
}

/**
 * The terrain LOD plan, handed over by `Terrain.tsx` when it builds the mesh.
 *
 * Footing has to agree with what is actually DRAWN, and what is drawn is flat
 * triangles between vertices — not the smooth height function between them.
 * Wherever the ground is concave the mesh spans the hollow and sits *above*
 * `heightAt`, so a character placed by the function walks through the visible
 * surface. Measured against the real terrain that is up to 0.69m at the finest
 * LOD and 1.12m at the coarsest: thigh-deep on a 1.8m bard.
 *
 * So this mirrors the mesh's own interpolation instead. The plan is pushed in
 * rather than recomputed here, because a second copy of the chunk scoring
 * would be a second opinion about where the ground is, and the entire point is
 * that there is only one.
 */
type TerrainLod = {
  chunks: number;
  chunkSize: number;
  /** Segments per chunk, indexed by the chunk's level. */
  bySegments: number[];
  /** Level per chunk, row-major. */
  levels: Uint8Array;
};

let lod: TerrainLod | null = null;

export function setTerrainLod(plan: TerrainLod): void {
  lod = plan;
}

/** Whether the mesh has published its plan yet. Used as a dev tripwire. */
export function terrainLodReady(): boolean {
  return lod !== null;
}

/**
 * Terrain height as the mesh draws it: bilinear across the quad, split on the
 * same diagonal three tessellates on.
 *
 * Exported because footing is not the only thing that has to agree with the
 * drawn surface. Anything *rooted* in the ground — grass, flowers, scattered
 * props — has the same problem in mirror image: where the ground is convex the
 * mesh cuts the corner and sits BELOW the height function, so a blade planted
 * at `heightAt` hangs in the air above the hilltop it is supposed to be growing
 * out of.
 */
export function drawnHeightAt(x: number, z: number): number {
  if (!lod) return heightAt(x, z);

  const half = (lod.chunks * lod.chunkSize) / 2;
  const ci = Math.floor((x + half) / lod.chunkSize);
  const cj = Math.floor((z + half) / lod.chunkSize);
  // Off the edge of the mesh there is nothing drawn to agree with.
  if (ci < 0 || cj < 0 || ci >= lod.chunks || cj >= lod.chunks) {
    return heightAt(x, z);
  }

  const segments = lod.bySegments[lod.levels[cj * lod.chunks + ci]];
  if (!segments) return heightAt(x, z);

  const cell = lod.chunkSize / segments;
  const gx = Math.floor(x / cell);
  const gz = Math.floor(z / cell);
  const fx = x / cell - gx;
  const fz = z / cell - gz;

  const h00 = heightAt(gx * cell, gz * cell);
  const h10 = heightAt((gx + 1) * cell, gz * cell);
  const h01 = heightAt(gx * cell, (gz + 1) * cell);
  const h11 = heightAt((gx + 1) * cell, (gz + 1) * cell);

  return fx + fz < 1
    ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
    : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

/**
 * Height the soles should meet at (x, z): the higher of the terrain and any
 * walkable structure deck covering that point.
 */
export function surfaceAt(x: number, z: number): number {
  let y = drawnHeightAt(x, z);

  for (let i = 0; i < DECKS.length; i++) {
    const s = DECKS[i];
    const reach = s.radius + 0.5;
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz > reach * reach) continue;

    // A bridge deck is an arch, not a plane. Reading it as a plane is what
    // made stepping onto one a jump: the flat top disagreed with the approach
    // road by up to two thirds of a metre, and the deck-snap below turned that
    // disagreement into a visible hop. Sampling the curve means the deck meets
    // the road exactly at the ends and simply rises underfoot in between.
    if (s.kind === "bridge") {
      const footprint = GROUND_FOOTPRINTS[s.kind];
      const halfWidth = footprint.halfWidth * s.scale - 0.2;
      const hit = bridgeParam(s, x, z, halfWidth);
      if (!hit) continue;
      const top = bridgeDeckWorldY(bridgeProfile(s), hit.t);
      if (top > y) y = top;
      continue;
    }

    if (!onWalkableDeck(s, x, z)) continue;
    const top = deckTopY(s);
    if (top > y) y = top;
  }

  return y;
}

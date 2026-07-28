/**
 * Populates the collision registry.
 *
 * `lib/world/collision.ts` is a registry with no opinion about what goes in it,
 * and every consumer — the bard's pathing, every NPC's steering — only ever
 * *reads* it. Something has to do the writing, and this is that something.
 *
 * It matters that this exists as an explicit, idempotent call rather than a
 * module-level side effect in `settlements.ts`. A bare top-level
 * `registerColliders(...)` only runs if some module happens to import that file
 * first, which makes whether the world is solid depend on bundler import order
 * and tree-shaking. That failure is silent and total: the registry stays empty,
 * `resolveMove` finds nothing to collide with, and everyone walks calmly
 * through the buildings — which is exactly the state this file was written to
 * fix.
 */

import { allColliders, clearColliders, registerColliders } from "./collision";
import { floraObstacleColliders } from "./flora-obstacles";
import { npcColliders } from "./npc";
import { budgetFor, type QualityBudget } from "./quality";
import { structureColliders } from "./settlements";

let installedKey = "";

/**
 * Loads every static collider in the world. Safe to call repeatedly — the
 * scene mounts and unmounts on navigation and in React strict mode, and
 * registering twice would double every building's blocking footprint.
 *
 * Pass the active quality budget so tree/rock/shrub counts match the flora
 * you can see. Defaults to medium when called without one.
 */
export function ensureWorldColliders(budget?: QualityBudget): void {
  const active = budget ?? budgetFor("medium");
  const key = active.tier;
  if (installedKey === key) return;

  clearColliders();

  const structures = structureColliders();
  const npcs = npcColliders();
  const flora = floraObstacleColliders(active);

  registerColliders(structures);
  registerColliders(npcs);
  registerColliders(flora);

  installedKey = key;

  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[punaab] colliders installed: ${structures.length} structure + ${npcs.length} npc + ${flora.length} flora = ${allColliders().length} live`
    );
  }
}

/** Number of colliders currently installed. Used by the scene's debug readout. */
export function worldColliderCount(): number {
  return allColliders().length;
}

/** Drops every collider. Only for tests and teardown. */
export function resetWorldColliders(): void {
  clearColliders();
  installedKey = "";
}

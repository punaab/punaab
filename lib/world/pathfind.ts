/**
 * Coarse grid pathfinding on the XZ plane.
 *
 * Uses the live collider registry (`isBlocked`) plus a shallow-water test so
 * routes bend around buildings, rocks, trunks, and lakes instead of grinding
 * into them. Roads get a soft cost discount so he still prefers the highway
 * when it is not much longer.
 */

import { isBlocked } from "@/lib/world/collision";
import {
  ROAD_HALF_WIDTH,
  WATER_LEVEL,
  WORLD_SIZE,
  distanceToRoad,
  heightAt,
} from "@/lib/world/terrain";

export type PathPoint = { x: number; z: number };

const CELL = 2.6;
const HALF = WORLD_SIZE / 2;
const GRID = Math.ceil(WORLD_SIZE / CELL);
const MAX_EXPAND = 18_000;

/** How much wider than the walker's body a planned route keeps clear of trunks. */
const PLAN_PAD = 1.28;

function toCell(x: number, z: number): { i: number; j: number } {
  return {
    i: Math.max(0, Math.min(GRID - 1, Math.floor((x + HALF) / CELL))),
    j: Math.max(0, Math.min(GRID - 1, Math.floor((z + HALF) / CELL))),
  };
}

function cellCenter(i: number, j: number): PathPoint {
  return {
    x: -HALF + (i + 0.5) * CELL,
    z: -HALF + (j + 0.5) * CELL,
  };
}

function key(i: number, j: number): number {
  return i + j * GRID;
}

function walkable(x: number, z: number, radius: number): boolean {
  if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) return false;
  if (heightAt(x, z) < WATER_LEVEL + 0.35) return false;
  if (isBlocked(x, z, radius)) return false;
  return true;
}

function nearRoad(x: number, z: number): boolean {
  return distanceToRoad(x, z) < ROAD_HALF_WIDTH + 2.4;
}

/**
 * A* from start → goal on a coarse world grid.
 * Returns waypoints including the goal (not the start), or null if unreachable.
 */
export function findClearPath(
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  radius: number
): PathPoint[] | null {
  // Plan with a fatter footprint so routes bend around trunks instead of
  // threading the gap between bark and the walker's shoulders.
  const planRadius = radius * PLAN_PAD;
  if (!walkable(goalX, goalZ, planRadius)) {
    // Goal itself may be tight against a tree — still try with the true radius.
    if (!walkable(goalX, goalZ, radius)) return null;
  }

  const start = toCell(startX, startZ);
  const goal = toCell(goalX, goalZ);
  if (start.i === goal.i && start.j === goal.j) {
    return [{ x: goalX, z: goalZ }];
  }

  const startKey = key(start.i, start.j);
  const goalKey = key(goal.i, goal.j);

  const cameFrom = new Int32Array(GRID * GRID).fill(-1);
  const gScore = new Float32Array(GRID * GRID).fill(Infinity);
  const fScore = new Float32Array(GRID * GRID).fill(Infinity);
  const closed = new Uint8Array(GRID * GRID);

  gScore[startKey] = 0;
  fScore[startKey] = Math.hypot(goal.i - start.i, goal.j - start.j);

  // Binary heap of cell keys, ordered by fScore.
  const heap: number[] = [startKey];
  const less = (a: number, b: number) => fScore[a] < fScore[b];
  const siftUp = (idx: number) => {
    let i = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      const t = heap[i];
      heap[i] = heap[p];
      heap[p] = t;
      i = p;
    }
  };
  const siftDown = (idx: number) => {
    let i = idx;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let best = i;
      if (l < heap.length && less(heap[l], heap[best])) best = l;
      if (r < heap.length && less(heap[r], heap[best])) best = r;
      if (best === i) break;
      const t = heap[i];
      heap[i] = heap[best];
      heap[best] = t;
      i = best;
    }
  };

  let expanded = 0;
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  while (heap.length && expanded < MAX_EXPAND) {
    const current = heap[0];
    heap[0] = heap[heap.length - 1];
    heap.pop();
    if (heap.length) siftDown(0);

    if (closed[current]) continue;
    closed[current] = 1;
    expanded++;

    if (current === goalKey) {
      const cells: PathPoint[] = [];
      let cursor = goalKey;
      while (cursor !== startKey && cursor >= 0) {
        const ci = cursor % GRID;
        const cj = (cursor / GRID) | 0;
        cells.push(cellCenter(ci, cj));
        cursor = cameFrom[cursor];
      }
      cells.reverse();
      // Snap the final point to the exact clear goal.
      if (cells.length) cells[cells.length - 1] = { x: goalX, z: goalZ };
      else cells.push({ x: goalX, z: goalZ });
      return simplifyPath(cells, planRadius);
    }

    const ci = current % GRID;
    const cj = (current / GRID) | 0;

    for (const [di, dj] of neighbors) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue;
      const nk = key(ni, nj);
      if (closed[nk]) continue;

      const center = cellCenter(ni, nj);
      if (!walkable(center.x, center.z, planRadius)) continue;

      const step = Math.hypot(di, dj);
      // Prefer graded road when the detour is modest.
      const roadBias = nearRoad(center.x, center.z) ? 0.72 : 1;
      const tentative = gScore[current] + step * roadBias;
      if (tentative >= gScore[nk]) continue;

      cameFrom[nk] = current;
      gScore[nk] = tentative;
      fScore[nk] =
        tentative + Math.hypot(goal.i - ni, goal.j - nj) * 0.95;
      heap.push(nk);
      siftUp(heap.length - 1);
    }
  }

  return null;
}

/** Drop collinear / redundant waypoints while keeping clear line-of-sight. */
function simplifyPath(points: PathPoint[], radius: number): PathPoint[] {
  if (points.length <= 2) return points;
  const out: PathPoint[] = [points[0]];
  let anchor = 0;
  for (let i = 1; i < points.length - 1; i++) {
    if (!lineClear(points[anchor], points[i + 1], radius)) {
      out.push(points[i]);
      anchor = i;
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

function lineClear(a: PathPoint, b: PathPoint, radius: number): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.01) return true;
  // Fine enough to catch a trunk between coarse A* cells (~0.85m samples).
  const steps = Math.max(2, Math.ceil(dist / 0.85));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    if (!walkable(x, z, radius)) return false;
  }
  return true;
}

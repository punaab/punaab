/**
 * What the world is made of, as far as anything that walks is concerned.
 *
 * The terrain says where the ground is; this says where you cannot stand. Every
 * building, fence, cart and grazing sheep registers a footprint here, and the
 * bard, the NPCs and the camera all resolve their movement against the same
 * registry — so nobody walks through a wall that somebody else bounced off.
 *
 * Two things about the shape of this module are deliberate:
 *
 * 1. Queries go through a uniform spatial hash. `resolveMove` runs once per
 *    entity per frame, and with a few hundred structures a linear scan would
 *    cost more than the rest of the scene put together.
 * 2. Movement *slides*. An entity that stops dead the instant it touches a
 *    corner reads as broken; one that scrapes along the wall and keeps going
 *    reads as alive. Sliding is most of what makes the world feel solid rather
 *    than sticky.
 *
 * Nothing here touches three.js or the terrain — it is flat 2D geometry on the
 * XZ plane, which keeps it cheap enough to call at 60fps for every NPC.
 */

export type Collider = {
  id: string;
  x: number;
  z: number;
  /** Bounding circle in metres. For boxes this is the circumscribed radius. */
  radius: number;
  /** Optional rotated rectangle, in the collider's own frame. */
  box?: { halfWidth: number; halfDepth: number; rotation: number };
  /** false = walkable decoration; still queryable, never blocking. */
  solid: boolean;
  kind: string;
  label?: string;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Bucket size. Roughly the footprint of a cottage: small enough that a query
 * reads two or three cells, large enough that a longhouse doesn't smear itself
 * across forty of them.
 */
const CELL = 8;

/**
 * Cell indices are packed into one number so the bucket map can key on an
 * integer instead of a string. String keys mean an allocation and a hash per
 * lookup, and this is called several thousand times a second.
 */
const CELL_BIAS = 4096;

let colliders: Collider[] = [];
let buckets = new Map<number, number[]>();

/**
 * Per-collider visit stamps, so a query that reads nine cells doesn't report
 * the same building nine times. An epoch counter beats a `Set` here because it
 * never allocates: bump the epoch, and every stamp from the previous query is
 * stale by construction.
 */
let stamps = new Int32Array(0);
let epoch = 0;

function cellKey(cx: number, cz: number): number {
  return (cx + CELL_BIAS) * 8192 + (cz + CELL_BIAS);
}

function boundingRadius(collider: Collider): number {
  if (!collider.box) return collider.radius;
  // Trust the declared radius, but never let it under-report the corners —
  // a box whose radius was set to its half-width would fall out of the buckets
  // it actually overlaps and silently stop colliding on the diagonal.
  return Math.max(
    collider.radius,
    Math.hypot(collider.box.halfWidth, collider.box.halfDepth)
  );
}

export function registerColliders(list: Collider[]): void {
  for (const collider of list) {
    const index = colliders.length;
    colliders.push(collider);

    const reach = boundingRadius(collider);
    const minX = Math.floor((collider.x - reach) / CELL);
    const maxX = Math.floor((collider.x + reach) / CELL);
    const minZ = Math.floor((collider.z - reach) / CELL);
    const maxZ = Math.floor((collider.z + reach) / CELL);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = cellKey(cx, cz);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
    }
  }

  if (stamps.length < colliders.length) {
    // Freshly zeroed. Safe because `epoch` only ever increases, so a zero
    // stamp can never be mistaken for a hit from the current query.
    stamps = new Int32Array(colliders.length + 128);
  }
}

export function clearColliders(): void {
  colliders = [];
  buckets = new Map();
  stamps = new Int32Array(0);
}

export function allColliders(): readonly Collider[] {
  return colliders;
}

// ---------------------------------------------------------------------------
// Broad phase
// ---------------------------------------------------------------------------

/**
 * Two reusable candidate buffers rather than one. `resolveMove` gathers the
 * whole neighbourhood once and then probes several positions inside it, while
 * the point queries gather per call; sharing a single buffer between the two
 * would have the inner call stomp the outer one's list.
 */
const sweepBuffer: number[] = [];
const pointBuffer: number[] = [];

/** Fills `out` with collider indices whose cells touch the query disc. */
function gather(x: number, z: number, radius: number, out: number[]): number {
  epoch++;
  let count = 0;

  const minX = Math.floor((x - radius) / CELL);
  const maxX = Math.floor((x + radius) / CELL);
  const minZ = Math.floor((z - radius) / CELL);
  const maxZ = Math.floor((z + radius) / CELL);

  for (let cx = minX; cx <= maxX; cx++) {
    for (let cz = minZ; cz <= maxZ; cz++) {
      const bucket = buckets.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const index = bucket[i];
        if (stamps[index] === epoch) continue;
        stamps[index] = epoch;
        out[count++] = index;
      }
    }
  }

  return count;
}

export function collidersNear(x: number, z: number, radius: number): Collider[] {
  const count = gather(x, z, radius, pointBuffer);
  const results: Collider[] = [];
  for (let i = 0; i < count; i++) {
    const collider = colliders[pointBuffer[i]];
    // The buckets are conservative; trim to the disc that was actually asked
    // for so callers can trust the result as a proximity list.
    const gap =
      Math.hypot(collider.x - x, collider.z - z) - boundingRadius(collider);
    if (gap <= radius) results.push(collider);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Narrow phase
// ---------------------------------------------------------------------------

/**
 * Result of the last overlap test. Module-level rather than returned, because
 * every entity in the world runs this a few dozen times a frame and the object
 * churn shows up in the GC.
 */
const contact = { depth: 0, nx: 0, nz: 0 };

/** Golden angle. Used to pick a stable direction out of a degenerate overlap. */
const GOLDEN_ANGLE = 2.399963229728653;

/**
 * Overlap between a query circle and one collider.
 *
 * Returns false and leaves `contact` untouched when they are clear. When they
 * overlap, `contact` holds the penetration depth and the unit normal pointing
 * from the collider toward the query point — the direction you push to separate.
 */
function overlaps(index: number, px: number, pz: number, radius: number): boolean {
  const collider = colliders[index];
  const dx = px - collider.x;
  const dz = pz - collider.z;

  if (collider.box) {
    const { halfWidth, halfDepth, rotation } = collider.box;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // World -> box local. This is the inverse of the Y rotation three.js
    // applies to the matching mesh, so a structure's collider sits exactly
    // under the structure rather than 90 degrees off it.
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;

    const nearX = lx < -halfWidth ? -halfWidth : lx > halfWidth ? halfWidth : lx;
    const nearZ = lz < -halfDepth ? -halfDepth : lz > halfDepth ? halfDepth : lz;

    const ox = lx - nearX;
    const oz = lz - nearZ;
    const distance = Math.sqrt(ox * ox + oz * oz);

    let localX: number;
    let localZ: number;

    if (distance > 1e-6) {
      if (distance >= radius) return false;
      contact.depth = radius - distance;
      localX = ox / distance;
      localZ = oz / distance;
    } else {
      // Dead centre of the box, or anywhere inside it: there is no meaningful
      // outward direction from the closest-point test, so leave through the
      // nearest face instead. Without this branch the normal is 0/0.
      const outX = halfWidth - Math.abs(lx);
      const outZ = halfDepth - Math.abs(lz);
      if (outX < outZ) {
        localX = lx >= 0 ? 1 : -1;
        localZ = 0;
        contact.depth = outX + radius;
      } else {
        localX = 0;
        localZ = lz >= 0 ? 1 : -1;
        contact.depth = outZ + radius;
      }
    }

    // Box local -> world.
    contact.nx = localX * cos + localZ * sin;
    contact.nz = -localX * sin + localZ * cos;
    return true;
  }

  const reach = collider.radius + radius;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance >= reach) return false;

  contact.depth = reach - distance;
  if (distance > 1e-6) {
    contact.nx = dx / distance;
    contact.nz = dz / distance;
  } else {
    // Standing exactly on a collider's centre. Any direction is as good as any
    // other; derive one from the index so it is deterministic and so two
    // entities stuck on neighbouring props don't both squirt the same way.
    const angle = index * GOLDEN_ANGLE;
    contact.nx = Math.cos(angle);
    contact.nz = Math.sin(angle);
  }
  return true;
}

/**
 * Deepest penetration at a point across a pre-gathered candidate list, and the
 * normal that goes with it. Zero means clear.
 */
let deepestNx = 0;
let deepestNz = 0;

function deepestOverlap(
  px: number,
  pz: number,
  radius: number,
  list: number[],
  count: number
): number {
  let worst = 0;
  deepestNx = 0;
  deepestNz = 0;
  for (let i = 0; i < count; i++) {
    const index = list[i];
    if (!colliders[index].solid) continue;
    if (!overlaps(index, px, pz, radius)) continue;
    if (contact.depth > worst) {
      worst = contact.depth;
      deepestNx = contact.nx;
      deepestNz = contact.nz;
    }
  }
  return worst;
}

export function isBlocked(x: number, z: number, radius: number): boolean {
  const count = gather(x, z, radius, pointBuffer);
  for (let i = 0; i < count; i++) {
    const index = pointBuffer[i];
    if (!colliders[index].solid) continue;
    if (overlaps(index, x, z, radius)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * Slide-along-surface movement resolution.
 *
 * The order of the attempts is the whole trick. Straight through first, then
 * the tangent of whatever stopped us, then a halved tangent for tight corners,
 * then each axis alone. Only when all of those fail does the entity actually
 * stand still — and by then it is genuinely wedged, which is rare enough that
 * standing still is the right answer.
 *
 * Anything that starts *inside* geometry (a spawn placed badly, a collider
 * registered underneath a walker) is not treated as immovable: a move that
 * reduces its penetration is always allowed, so it works its way out instead of
 * freezing in the wall forever.
 */
export function resolveMove(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number
): { x: number; z: number; blocked: boolean } {
  const moveX = toX - fromX;
  const moveZ = toZ - fromZ;

  // One gather covering the whole swept path plus the body, reused by every
  // probe below.
  const midX = (fromX + toX) * 0.5;
  const midZ = (fromZ + toZ) * 0.5;
  const reach = Math.hypot(moveX, moveZ) * 0.5 + radius + CELL;
  const count = gather(midX, midZ, reach, sweepBuffer);
  if (count === 0) return { x: toX, z: toZ, blocked: false };

  const startDepth = deepestOverlap(fromX, fromZ, radius, sweepBuffer, count);
  const accepts = (px: number, pz: number) => {
    const depth = deepestOverlap(px, pz, radius, sweepBuffer, count);
    return depth <= 0 || depth < startDepth - 1e-4;
  };

  if (accepts(toX, toZ)) return { x: toX, z: toZ, blocked: false };

  // `deepestOverlap` above left the blocking normal in place. Capture it before
  // the next probe overwrites it.
  const nx = deepestNx;
  const nz = deepestNz;

  const into = moveX * nx + moveZ * nz;
  const slideX = moveX - nx * into;
  const slideZ = moveZ - nz * into;

  if (accepts(fromX + slideX, fromZ + slideZ)) {
    return { x: fromX + slideX, z: fromZ + slideZ, blocked: true };
  }
  // Half a slide clears the common case of two walls meeting at a shallow
  // angle, where the full tangent overshoots into the second one.
  if (accepts(fromX + slideX * 0.5, fromZ + slideZ * 0.5)) {
    return { x: fromX + slideX * 0.5, z: fromZ + slideZ * 0.5, blocked: true };
  }

  if (accepts(toX, fromZ)) return { x: toX, z: fromZ, blocked: true };
  if (accepts(fromX, toZ)) return { x: fromX, z: toZ, blocked: true };

  // Last resort: push straight back out along the blocking normal. This never
  // makes progress along the intended path, but it stops an entity that has
  // been shoved into geometry from staying there.
  if (startDepth > 0) {
    const escapeX = fromX + nx * (startDepth + 0.01);
    const escapeZ = fromZ + nz * (startDepth + 0.01);
    if (accepts(escapeX, escapeZ)) {
      return { x: escapeX, z: escapeZ, blocked: true };
    }
  }

  return { x: fromX, z: fromZ, blocked: true };
}

/**
 * Nearest position with no overlap, for spawning and un-sticking.
 *
 * Samples a golden-angle spiral rather than concentric rings: it covers the
 * disc evenly at every count, so the search can stop the moment it finds room
 * without having biased the result toward one compass direction.
 */
export function nearestClearPoint(
  x: number,
  z: number,
  radius: number
): { x: number; z: number } {
  if (!isBlocked(x, z, radius)) return { x, z };

  const SAMPLES = 512;
  const STEP = 0.7;

  let bestX = x;
  let bestZ = z;
  let bestDepth = Infinity;

  for (let i = 1; i <= SAMPLES; i++) {
    const angle = i * GOLDEN_ANGLE;
    // sqrt spacing keeps the sample density constant as the spiral widens.
    const distance = STEP * Math.sqrt(i);
    const px = x + Math.cos(angle) * distance;
    const pz = z + Math.sin(angle) * distance;

    const count = gather(px, pz, radius, pointBuffer);
    const depth = deepestOverlap(px, pz, radius, pointBuffer, count);
    if (depth <= 0) return { x: px, z: pz };
    if (depth < bestDepth) {
      bestDepth = depth;
      bestX = px;
      bestZ = pz;
    }
  }

  // Boxed in on every side within ~16m. Return the shallowest overlap found so
  // the caller at least ends up as close to open ground as the world allows.
  return { x: bestX, z: bestZ };
}

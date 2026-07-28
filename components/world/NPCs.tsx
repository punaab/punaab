"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { nearestClearPoint, resolveMove } from "@/lib/world/collision";
import {
  animalTint,
  buildAnimal,
  buildHumanoid,
  createCharacterMaterial,
  humanoidLook,
  poseHumanoid,
  restHumanoid,
  type AnimalKind,
  type AnimalModel,
  type Humanoid,
} from "@/lib/world/humanoid";
import { NPCS, isAnimal, npcRadius, type NpcSpawn } from "@/lib/world/npc";
import type { QualityBudget } from "@/lib/world/quality";
import { WATER_LEVEL, heightAt, normalAt } from "@/lib/world/terrain";

/**
 * The living world: villagers, monks, guards, sheep, deer, chickens.
 *
 * The shape of this file is dictated by one number. There are well over a
 * hundred of these, and forty-odd of them are articulated skeletons — which
 * means none of them can be a React component doing its own per-frame work.
 * Each `useFrame` callback is a closure R3F invokes separately, each rig would
 * be its own reconciliation subtree, and the cost of *coordinating* a crowd
 * that way dwarfs the cost of animating it.
 *
 * So there is exactly one `useFrame` here, and everything below it is plain
 * data: one flat array of agents with one shape, iterated in one loop. That
 * monomorphism is deliberate — people and animals share a single object layout
 * even though half the fields are unused by each, because a loop over one
 * hidden class is dramatically faster than a loop over two.
 *
 * The four things that make it hold up:
 *
 * - **They do not walk through buildings.** Every step goes through
 *   `resolveMove`, which slides along a wall rather than stopping dead, so a
 *   villager who clips a barn scrapes past it instead of standing there
 *   twitching.
 * - **They do not pile up.** A uniform neighbour grid is rebuilt each frame and
 *   every agent is pushed out of everyone else's personal space. Without it a
 *   flock converges on one point and becomes a single sheep with sixteen heads.
 * - **The gait is driven by the distance actually covered**, not the distance
 *   intended. Stride frequency *and* stride length both scale with real ground
 *   speed, which is what stops a slow walk from reading as a moonwalk and an
 *   NPC pressed against a wall from running on the spot.
 * - **Distant NPCs stop being animated.** Past the pose radius the rig is
 *   dropped into a standing pose once and left there; past the view radius it
 *   is hidden and simulated at a trickle. Animals are instanced throughout, so
 *   every sheep, cow, goat, deer and chicken in the valley is ten draw calls.
 */

const TAU = Math.PI * 2;

/**
 * Integer hash -> [0, 1). As in `terrain.ts` — and `Math.imul` matters here for
 * the same reason it matters there.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Thins an ordered list to a cap by taking an even stride through it.
 *
 * `NPCS` is ordered settlement by settlement and then region by region, so a
 * stride keeps a proportional share of every one of them. Sampling by a per-NPC
 * random threshold gives the same *count* and will occasionally empty a hamlet
 * completely, which is far more noticeable than a hamlet of two.
 */
function takeEvenly<T>(list: readonly T[], limit: number): T[] {
  if (list.length <= limit) return list.slice();
  const out: T[] = [];
  for (let i = 0; i < limit; i++) {
    out.push(list[Math.floor((i * list.length) / limit)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

type Herd = {
  kind: AnimalKind;
  model: AnimalModel;
  body: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
};

/**
 * One object layout for everybody.
 *
 * A person leaves `herd` null and an animal leaves `rig` null. Splitting this
 * into two types would be tidier to read and slower to run: the update loop
 * would see two hidden classes on every property access and lose its inline
 * caches on the hottest code in the scene.
 */
type Agent = {
  spawn: NpcSpawn;
  index: number;
  seed: number;
  radius: number;

  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  y: number;
  heading: number;
  targetX: number;
  targetZ: number;

  /** Retarget counter. Every runtime decision hangs off this, not off a clock. */
  step: number;
  pause: number;
  /** How long this agent has been scraping something. */
  stuck: number;
  /** Intended speed, ramped. */
  speed: number;
  /** Ground actually covered last tick, per second. This is what drives gait. */
  ground: number;
  /** Time banked for agents that tick at less than once a frame. */
  carry: number;
  /** Multiplier on how long this kind stands about between errands. */
  restless: number;

  /** Walk cycle for people; body bob for animals. */
  phase: number;
  pitch: number;
  roll: number;
  pitchTarget: number;
  rollTarget: number;
  slopeTimer: number;

  rig: Humanoid | null;
  look: number;
  lookTarget: number;
  lookTimer: number;
  lookTick: number;
  lod: number;

  herd: Herd | null;
  slot: number;
  scale: number;
  /** 0 head up, 1 head in the grass. */
  graze: number;
};

/** How far in front of an agent counts as "arrived". */
const ARRIVE = 0.6;
/** Radians per second an agent can turn. */
const TURN_RATE = 3.2;
/** How hard neighbours push each other apart, metres per second at full overlap. */
const SEPARATION = 2.4;
/**
 * Neighbour grid cell. Must exceed the largest interaction distance — a cow is
 * 0.62m, so two of them plus the margin is 1.54m and a 3.2m cell covers it in
 * the three-by-three block the query reads.
 */
const SEP_CELL = 3.2;

type NpcWorld = {
  root: THREE.Group;
  update(delta: number, camera: THREE.Camera): void;
  dispose(): void;
};

function createNpcWorld(budget: QualityBudget): NpcWorld {
  const root = new THREE.Group();
  root.name = "Population";

  const material = createCharacterMaterial();
  const agents: Agent[] = [];
  const herds: Herd[] = [];

  // Scratch, declared before anything that uses it because the herd builder
  // below writes its instance matrices immediately: `InstancedMesh` allocates
  // its matrix buffer as zeros, not identities, so a herd left unwritten until
  // the first frame renders as a single degenerate point.
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const headPosition = new THREE.Vector3();
  const headQuaternion = new THREE.Quaternion();
  const unit = new THREE.Vector3(1, 1, 1);
  const bodyMatrix = new THREE.Matrix4();
  const headLocal = new THREE.Matrix4();
  const headMatrix = new THREE.Matrix4();

  let time = 0;
  let settled = false;

  // Every distance comes from the shared budget rather than a private table, so
  // the crowd fades out in step with the trees and the buildings around it.
  //
  // `lodNear` is where flora drops to simplified geometry, which is a good
  // place to stop computing a walk cycle nobody can resolve. `drawDistance` is
  // where the scattered world ends, and a person the same distance away is a
  // handful of pixels. The shadow radius matches the shadow camera's own reach,
  // beyond which a caster contributes nothing but a shadow-map draw.
  const poseRadius2 = budget.lodNear * budget.lodNear;
  const viewRadius2 = budget.drawDistance * budget.drawDistance;
  const shadowRadius2 = budget.shadowDistance * budget.shadowDistance;
  const detail: "full" | "simple" = budget.tier === "low" ? "simple" : "full";

  // --- Selection ----------------------------------------------------------

  const allFolk: NpcSpawn[] = [];
  const allBeasts: NpcSpawn[] = [];
  for (const spawn of NPCS) {
    if (isAnimal(spawn.kind)) allBeasts.push(spawn);
    else allFolk.push(spawn);
  }

  // Two separate caps, because the two cost wildly different things: an animal
  // is a matrix in an instance buffer, a person is a dozen meshes and a joint
  // hierarchy the CPU poses every frame.
  const folk = takeEvenly(allFolk, budget.npcs);

  const flocks = new Map<AnimalKind, NpcSpawn[]>();
  for (const spawn of takeEvenly(allBeasts, budget.animals)) {
    const kind = spawn.kind;
    if (!isAnimal(kind)) continue;
    const list = flocks.get(kind);
    if (list) list.push(spawn);
    else flocks.set(kind, [spawn]);
  }

  function makeAgent(spawn: NpcSpawn): Agent {
    const seed = agents.length * 2654435761 + 7;
    const animal = isAnimal(spawn.kind);
    return {
      spawn,
      index: agents.length,
      seed,
      radius: npcRadius(spawn.kind),
      homeX: spawn.x,
      homeZ: spawn.z,
      x: spawn.x,
      z: spawn.z,
      y: heightAt(spawn.x, spawn.z),
      heading: hash2(seed, 5) * TAU,
      targetX: spawn.x,
      targetZ: spawn.z,
      step: 0,
      // Staggered, or the whole valley sets off on the same frame.
      pause: hash2(seed, 3) * 5,
      stuck: 0,
      speed: 0,
      ground: 0,
      carry: 0,
      restless:
        spawn.kind === "child"
          ? 0.35
          : spawn.kind === "deer"
            ? 0.9
            : spawn.kind === "merchant"
              ? 2.2
              : animal
                ? 2.8
                : 1,
      phase: hash2(seed, 11) * TAU,
      pitch: 0,
      roll: 0,
      pitchTarget: 0,
      rollTarget: 0,
      slopeTimer: hash2(seed, 13) * 0.4,
      rig: null,
      look: 0,
      lookTarget: 0,
      lookTimer: hash2(seed, 17) * 3,
      lookTick: 0,
      lod: -1,
      herd: null,
      slot: 0,
      scale: 1,
      graze: 0,
    };
  }

  // --- People -------------------------------------------------------------

  for (const spawn of folk) {
    const agent = makeAgent(spawn);
    const look = humanoidLook(spawn.kind, spawn.palette);
    const rig = buildHumanoid({
      seed: agent.seed,
      look,
      material,
      detail,
    });
    // The spawn table's radius is a behaviour figure; the body knows how wide
    // it actually is, and separation reads better off the real shoulders.
    agent.radius = Math.max(agent.radius, rig.radius);
    agent.rig = rig;
    rig.root.position.set(agent.x, agent.y, agent.z);
    rig.root.rotation.y = agent.heading;
    restHumanoid(rig);
    root.add(rig.root);
    agents.push(agent);
  }

  // --- Animals ------------------------------------------------------------

  const colour = new THREE.Color();

  for (const [kind, members] of flocks) {
    const model = buildAnimal(kind);
    const body = new THREE.InstancedMesh(model.body, material, members.length);
    const head = new THREE.InstancedMesh(model.head, material, members.length);
    const herd: Herd = { kind, model, body, head };

    for (const mesh of [body, head]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Rewritten every frame. Left on the default static hint the driver
      // re-uploads the whole buffer as if it were immutable data.
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Animals of a kind are spread across the whole 640m valley, so a single
      // bounding sphere is on screen no matter where the camera is. Culling it
      // can only ever cost the test, and skipping the test lets the bounding
      // sphere go stale without consequence.
      mesh.frustumCulled = false;
      mesh.name = `${kind}s`;
      root.add(mesh);
    }

    for (let i = 0; i < members.length; i++) {
      const agent = makeAgent(members[i]);
      agent.herd = herd;
      agent.slot = i;
      // Not every ewe in a flock is the same size, and a field of identical
      // animals is the loudest instancing tell there is.
      agent.scale = 0.86 + hash2(agent.seed, 19) * 0.3;
      agent.radius = Math.max(agent.radius, model.radius * agent.scale);
      agents.push(agent);
      placeAnimal(agent);

      animalTint(kind, i, colour);
      body.setColorAt(i, colour);
      head.setColorAt(i, colour);
    }

    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;

    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
    herds.push(herd);
  }

  // --- Neighbour grid -----------------------------------------------------

  const cells = new Map<number, number[]>();

  function rebuildGrid() {
    // Buckets are emptied rather than dropped: the set of occupied cells barely
    // changes from frame to frame, so reusing the arrays means the whole system
    // allocates nothing at all once it has warmed up.
    for (const bucket of cells.values()) bucket.length = 0;
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const key =
        (Math.floor(agent.x / SEP_CELL) + 4096) * 8192 +
        (Math.floor(agent.z / SEP_CELL) + 4096);
      const bucket = cells.get(key);
      if (bucket) bucket.push(i);
      else cells.set(key, [i]);
    }
  }

  let sepX = 0;
  let sepZ = 0;

  function separation(agent: Agent) {
    sepX = 0;
    sepZ = 0;
    const cx = Math.floor(agent.x / SEP_CELL);
    const cz = Math.floor(agent.z / SEP_CELL);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const bucket = cells.get((cx + ox + 4096) * 8192 + (cz + oz + 4096));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const other = agents[bucket[k]];
          if (other === agent) continue;

          const dx = agent.x - other.x;
          const dz = agent.z - other.z;
          const want = agent.radius + other.radius + 0.3;
          const d2 = dx * dx + dz * dz;
          if (d2 >= want * want) continue;

          if (d2 < 1e-8) {
            // Exactly co-located, which the spawn pass can produce where two
            // anchors coincide. Any direction will do as long as it is stable
            // and the pair do not both choose the same one.
            const angle = agent.index * 2.39996;
            sepX += Math.cos(angle);
            sepZ += Math.sin(angle);
            continue;
          }

          const distance = Math.sqrt(d2);
          const push = (want - distance) / want;
          sepX += (dx / distance) * push;
          sepZ += (dz / distance) * push;
        }
      }
    }
  }

  // --- Movement -----------------------------------------------------------

  function retarget(agent: Agent) {
    agent.step++;
    const seed = agent.seed + agent.step * 7919;
    const spread = agent.spawn.wanderRadius;

    for (let attempt = 0; attempt < 3; attempt++) {
      const angle = hash2(seed + attempt * 31, seed * 13 + attempt) * TAU;
      const radius =
        Math.sqrt(hash2(seed * 5 + attempt, seed + attempt * 17)) * spread;
      const x = agent.homeX + Math.cos(angle) * radius;
      const z = agent.homeZ + Math.sin(angle) * radius;
      // The only check worth doing here: nothing that walks wants to wade.
      // Buildings are handled by the mover, which slides around them.
      if (heightAt(x, z) > WATER_LEVEL + 0.45) {
        agent.targetX = x;
        agent.targetZ = z;
        return;
      }
    }

    agent.targetX = agent.homeX;
    agent.targetZ = agent.homeZ;
  }

  function advance(agent: Agent, delta: number) {
    separation(agent);

    if (agent.pause > 0) {
      agent.pause -= delta;
      agent.speed += (0 - agent.speed) * Math.min(1, delta * 6);
      agent.ground = 0;
      // Standing still is no excuse for standing inside somebody. Even a
      // stationary agent gets shoved out of an overlap, which is what stops a
      // grazing flock from slowly fusing into one animal.
      if (sepX !== 0 || sepZ !== 0) {
        const moved = resolveMove(
          agent.x,
          agent.z,
          agent.x + sepX * SEPARATION * delta,
          agent.z + sepZ * SEPARATION * delta,
          agent.radius
        );
        agent.x = moved.x;
        agent.z = moved.z;
        // Shoved is still moved: without this a jostled animal keeps the ground
        // height of where it used to be and slowly sinks into the hill.
        agent.y = heightAt(agent.x, agent.z);
      }
      return;
    }

    const dx = agent.targetX - agent.x;
    const dz = agent.targetZ - agent.z;
    const distance = Math.hypot(dx, dz);

    if (distance < ARRIVE) {
      retarget(agent);
      const seed = agent.seed + agent.step * 131;
      agent.pause = agent.restless * (0.8 + hash2(seed, 53) * 3.2);
      agent.ground = 0;
      return;
    }

    let turn = Math.atan2(dx, dz) - agent.heading;
    while (turn > Math.PI) turn -= TAU;
    while (turn < -Math.PI) turn += TAU;
    agent.heading += turn * Math.min(1, delta * TURN_RATE);

    // Ease off on the approach. Arriving at full pace and stopping dead is the
    // single most robotic thing a wandering NPC can do.
    const wanted = agent.spawn.speed * Math.min(1, distance / 1.8);
    agent.speed += (wanted - agent.speed) * Math.min(1, delta * 3.5);

    const reach = agent.speed * delta;
    const toX = agent.x + Math.sin(agent.heading) * reach + sepX * SEPARATION * delta;
    const toZ = agent.z + Math.cos(agent.heading) * reach + sepZ * SEPARATION * delta;

    const moved = resolveMove(agent.x, agent.z, toX, toZ, agent.radius);
    const travelled = Math.hypot(moved.x - agent.x, moved.z - agent.z);
    agent.x = moved.x;
    agent.z = moved.z;
    agent.ground = delta > 1e-5 ? travelled / delta : 0;

    if (moved.blocked) {
      agent.stuck += delta;
      // Wedged in a corner the slide cannot get out of. Pick somewhere else
      // rather than shuffling against a wall forever.
      if (agent.stuck > 1.1) {
        agent.stuck = 0;
        retarget(agent);
      }
    } else {
      agent.stuck = 0;
    }

    agent.y = heightAt(agent.x, agent.z);
  }

  function readSlope(agent: Agent, delta: number, strength: number) {
    agent.slopeTimer -= delta;
    if (agent.slopeTimer <= 0) {
      // Four `heightAt` calls a pop. Three times a second is plenty for
      // something that changes over metres, and it is the difference between
      // this being free and it being the most expensive thing in the frame.
      agent.slopeTimer = 0.34;
      const normal = normalAt(agent.x, agent.z, 0.9);
      const forwardX = Math.sin(agent.heading);
      const forwardZ = Math.cos(agent.heading);
      const alongForward = normal.x * forwardX + normal.z * forwardZ;
      // Right-hand side of a body facing +Z is -X.
      const alongRight = -normal.x * forwardZ + normal.z * forwardX;
      // A normal tilted backwards means the ground rises ahead, so lean into it.
      agent.pitchTarget = -Math.atan2(alongForward, normal.y) * strength;
      agent.rollTarget = Math.atan2(alongRight, normal.y) * strength * 0.7;
    }
    const rate = Math.min(1, delta * 4);
    agent.pitch += (agent.pitchTarget - agent.pitch) * rate;
    agent.roll += (agent.rollTarget - agent.roll) * rate;
  }

  // --- Frame --------------------------------------------------------------

  /** Composes an animal's body and head matrices into its herd's instances. */
  function placeAnimal(agent: Agent) {
    const herd = agent.herd;
    if (!herd) return;

    const gait = Math.min(1.3, agent.ground / Math.max(0.2, agent.spawn.speed));
    const bob = Math.sin(agent.phase) * herd.model.shoulderHeight * 0.022 * gait;
    const sway = Math.sin(agent.phase * 0.5) * 0.06 * gait;

    position.set(agent.x, agent.y + bob, agent.z);
    euler.set(agent.pitch, agent.heading, agent.roll + sway, "YXZ");
    quaternion.setFromEuler(euler);
    scale.set(agent.scale, agent.scale, agent.scale);
    bodyMatrix.compose(position, quaternion, scale);
    herd.body.setMatrixAt(agent.slot, bodyMatrix);

    // Nibbling while grazing, a slow scan of the horizon while not. The chicken
    // ends up pecking because its graze angle is the steepest of the lot.
    // The phase offset is the herd slot, not the seed: `Math.sin` of a number
    // in the hundreds of billions has lost most of its precision by the time it
    // gets there, and a whole flock ends up nodding in unison.
    const offset = agent.slot * 1.71;
    const nibble = Math.sin(time * 3.4 + offset) * 0.09 * agent.graze;
    const scan = Math.sin(time * 0.31 + offset) * 0.5 * (1 - agent.graze);

    headPosition.copy(herd.model.headOffset);
    euler.set(herd.model.grazeAngle * agent.graze + nibble, scan, 0, "YXZ");
    headQuaternion.setFromEuler(euler);
    headLocal.compose(headPosition, headQuaternion, unit);
    // The body matrix carries the per-animal scale, so composing the head
    // through it scales the neck offset with the animal rather than leaving a
    // small sheep with a full-sized head floating in front of it.
    headMatrix.multiplyMatrices(bodyMatrix, headLocal);
    herd.head.setMatrixAt(agent.slot, headMatrix);
  }

  /**
   * Shakes everybody out of anything they spawned inside.
   *
   * Cannot happen at build time: the spawn table is a module constant, and the
   * structure colliders it would need to test against are registered by the
   * scene at mount. Running it on the first frame is the earliest point the
   * registry is guaranteed complete, and `nearestClearPoint` early-outs on the
   * overwhelmingly common case of already being clear.
   */
  function settle() {
    for (const agent of agents) {
      const clear = nearestClearPoint(agent.x, agent.z, agent.radius);
      agent.x = clear.x;
      agent.z = clear.z;
      agent.homeX = clear.x;
      agent.homeZ = clear.z;
      agent.targetX = clear.x;
      agent.targetZ = clear.z;
      agent.y = heightAt(clear.x, clear.z);
    }
  }

  function updatePerson(agent: Agent, delta: number, distance2: number) {
    const rig = agent.rig;
    if (!rig) return;

    const lod = distance2 > viewRadius2 ? 2 : distance2 > poseRadius2 ? 1 : 0;
    if (lod !== agent.lod) {
      agent.lod = lod;
      rig.root.visible = lod < 2;
      // Freeze into a standing pose rather than into whatever half-stride the
      // last animated frame happened to leave. A body held mid-step forever is
      // the one thing at this distance that reads as broken.
      if (lod === 1) restHumanoid(rig);
    }
    rig.setShadows(lod === 0 && distance2 < shadowRadius2);

    if (lod === 0) {
      advance(agent, delta);
    } else {
      // Still living their lives, just not on every frame.
      agent.carry += delta;
      const interval = lod === 1 ? 0.09 : 0.5;
      if (agent.carry >= interval) {
        advance(agent, agent.carry);
        agent.carry = 0;
      }
    }

    if (lod === 2) return;

    readSlope(agent, delta, 0.5);

    rig.root.position.set(agent.x, agent.y, agent.z);
    rig.root.rotation.y = agent.heading;
    rig.root.rotation.x = agent.pitch;
    rig.root.rotation.z = agent.roll;

    if (lod !== 0) return;

    // Gait. Stride length shrinks with pace as well as frequency — scale only
    // the frequency and a dawdling NPC glides through full-length strides,
    // which is exactly what moonwalking is.
    const nominal = Math.max(0.2, agent.spawn.speed);
    const stride = Math.min(1.2, agent.ground / nominal);
    const step = rig.strideLength * Math.max(0.4, stride);
    const advanceBy = (agent.ground / (2 * step)) * TAU * delta;
    // A resolved move can jump an agent (an un-stick, a big banked delta);
    // capping the increment keeps that from spinning the legs.
    agent.phase = (agent.phase + Math.min(advanceBy, 0.7)) % TAU;

    agent.lookTimer -= delta;
    if (agent.lookTimer <= 0) {
      agent.lookTick++;
      const seed = agent.seed + agent.lookTick * 6151;
      // Mostly small glances, occasionally a proper look over the shoulder.
      const wide = hash2(seed, 17) < 0.22;
      agent.lookTarget = (hash2(seed, 29) - 0.5) * (wide ? 2.1 : 0.7);
      agent.lookTimer = 1.6 + hash2(seed, 37) * 4.5;
    }
    // Someone walking looks where they are going.
    const wanted = agent.lookTarget * (1 - Math.min(1, stride) * 0.65);
    agent.look += (wanted - agent.look) * Math.min(1, delta * 2.6);

    poseHumanoid(rig, {
      phase: agent.phase,
      stride,
      time,
      look: agent.look,
      // Hurrying leans forward, and so does climbing.
      lean: stride * 0.08 + Math.max(0, agent.pitch) * 0.5,
    });
  }

  function updateAnimal(agent: Agent, delta: number, distance2: number) {
    if (!agent.herd) return;

    // Animals have no rig to freeze, so there is nothing to gain from hiding
    // them — they are already one draw call each way for the whole species.
    // What is worth saving is the simulation, which is where the collision
    // queries and terrain samples are.
    const near = distance2 < poseRadius2 * 2.5;
    if (near) {
      advance(agent, delta);
    } else {
      agent.carry += delta;
      const interval = distance2 > viewRadius2 ? 0.6 : 0.12;
      if (agent.carry >= interval) {
        advance(agent, agent.carry);
        agent.carry = 0;
      }
    }

    // Head down while standing, up while moving — the whole behavioural
    // repertoire of a sheep, and enough to make a field look occupied.
    const wantGraze = agent.pause > 0 ? 1 : 0;
    agent.graze +=
      (wantGraze - agent.graze) * Math.min(1, delta * (wantGraze > 0 ? 1.4 : 3.5));

    if (near) {
      readSlope(agent, delta, 0.75);
      // Four legs, no articulation: the gait is a bob and a roll on the barrel.
      // At the distance livestock is seen from, nobody counts hooves.
      const gait = Math.min(1.3, agent.ground / Math.max(0.2, agent.spawn.speed));
      agent.phase = (agent.phase + delta * (2.4 + gait * 7)) % TAU;
    }

    placeAnimal(agent);
  }

  function update(delta: number, camera: THREE.Camera) {
    if (!settled) {
      settle();
      settled = true;
    }

    time += delta;
    rebuildGrid();

    const cameraX = camera.position.x;
    const cameraZ = camera.position.z;

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const dx = agent.x - cameraX;
      const dz = agent.z - cameraZ;
      const distance2 = dx * dx + dz * dz;

      if (agent.rig) updatePerson(agent, delta, distance2);
      else updateAnimal(agent, delta, distance2);
    }

    for (const herd of herds) {
      herd.body.instanceMatrix.needsUpdate = true;
      herd.head.instanceMatrix.needsUpdate = true;
    }
  }

  function dispose() {
    for (const agent of agents) agent.rig?.dispose();
    for (const herd of herds) {
      herd.model.body.dispose();
      herd.model.head.dispose();
      herd.body.dispose();
      herd.head.dispose();
    }
    material.dispose();
    root.clear();
    cells.clear();
    agents.length = 0;
    herds.length = 0;
  }

  return { root, update, dispose };
}

// ---------------------------------------------------------------------------

export function NPCs({ budget }: { budget: QualityBudget }) {
  const holder = useRef<THREE.Group>(null);
  const world = useRef<NpcWorld | null>(null);

  useEffect(() => {
    const parent = holder.current;
    if (!parent) return;

    const built = createNpcWorld(budget);
    parent.add(built.root);
    world.current = built;

    return () => {
      parent.remove(built.root);
      built.dispose();
      world.current = null;
    };
  }, [budget]);

  useFrame((state, rawDelta) => {
    const built = world.current;
    if (!built) return;
    // A backgrounded tab hands back a delta measured in seconds. Stepping a
    // hundred agents through it in one go walks half of them through a wall,
    // because a single swept move that long clears the geometry between its
    // endpoints.
    built.update(Math.min(rawDelta, 0.05), state.camera);
  });

  return <group ref={holder} name="NPCs" />;
}

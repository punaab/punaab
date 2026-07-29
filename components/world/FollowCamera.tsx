"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { heightAt } from "@/lib/world/terrain";
import { isBlocked } from "@/lib/world/collision";
import type { Activity } from "@/lib/bard/adventure";

/** How much air the camera keeps between itself and a wall / ridge. */
const CAMERA_CLEARANCE = 0.7;
/**
 * Extra lift when the look-line hits a building. Colliders are flat footprints
 * with no roof height, so this is the cottage-scale clearance that keeps the
 * lens above thatch instead of parking inside the gable.
 */
const STRUCTURE_LIFT = 5.2;
/**
 * Closest the boom may pull in, in metres from his eyes.
 *
 * Roughly arm's length. Any nearer and the camera is inside his shoulders and
 * the near plane starts slicing him open, which looks far worse than briefly
 * seeing a corner of wall.
 */
const MIN_BOOM = 1.9;

/** Air the lens keeps above whatever ground it ends up over. */
const GROUND_CLEARANCE = 1.15;
/** Samples along bard → camera for terrain / structure clearance. */
const LOS_STEPS = 12;

/**
 * A third-person camera that travels with Punaab.
 *
 * Three things make a follow camera feel like cinematography rather than a
 * rig bolted to a character's back:
 *
 *  1. **Damping, not parenting.** The camera chases a target position with a
 *     spring. Parented cameras inherit every twitch of the walk cycle.
 *  2. **It changes shot for what he's doing.** Walking gets a trailing
 *     over-the-shoulder; performing gets a slow arc round to his face, so you
 *     see him sing. A single fixed angle for eight minutes is a screensaver.
 *  3. **It never clips through the world.** When a ridge or a wall gets between
 *     the lens and the bard, the boom *shortens* — the camera slides in along
 *     the line towards him until it is in front of the obstruction. This is how
 *     third-person cameras have always solved it, and it is much calmer than
 *     the alternative this used to do, which was to hoist the whole camera up
 *     over the obstacle. Lifting works, but it swings the framing wildly every
 *     time he walks past a cottage, and on a mountainside it never settles.
 */

type Shot = {
  /** Metres behind him. */
  distance: number;
  /** Metres above his feet. */
  height: number;
  /** Sideways offset — a slight one is much more natural than dead-centre. */
  side: number;
  /** How fast the camera chases. Lower is lazier and more cinematic. */
  stiffness: number;
  /** Radians/sec the camera arcs around him. */
  orbitSpeed: number;
  /** Height of the look-at point above his feet. */
  lookHeight: number;
};

const SHOTS: Record<"travelling" | "performing" | "close", Shot> = {
  // Following him down the road: behind, high, wide enough to show the valley.
  travelling: {
    distance: 6.4,
    height: 3.1,
    side: 1.5,
    // Lazier than it was. The spring is what turns his walk cycle and every
    // correction the boom makes into camera movement, so softening it is the
    // single biggest thing that makes the shot feel held rather than driven.
    stiffness: 1.1,
    // Effectively parked. Orbiting while travelling meant the valley slid
    // sideways for the entire length of a road, which is the drift that reads
    // as the camera never settling.
    orbitSpeed: 0,
    lookHeight: 1.45,
  },
  // Singing or resting: closer, lower, arcing slowly round to his face.
  performing: {
    distance: 4.2,
    height: 2.0,
    side: -2.1,
    stiffness: 0.7,
    // Kept, but halved. Coming round to his face while he sings is the one
    // place the movement is the point — it just does not need to be brisk.
    orbitSpeed: 0.055,
    lookHeight: 1.5,
  },
  // Trading or talking: conversational two-shot distance.
  close: {
    distance: 4.6,
    height: 2.3,
    side: 1.9,
    stiffness: 0.9,
    orbitSpeed: 0.018,
    lookHeight: 1.52,
  },
};

function shotFor(activity: Activity): Shot {
  if (activity === "performing" || activity === "resting") return SHOTS.performing;
  if (activity === "trading" || activity === "talking" || activity === "wondering") {
    return SHOTS.close;
  }
  return SHOTS.travelling;
}

/**
 * Shorten the boom until the lens has a clear view of him.
 *
 * Walks the line from the bard's eyes out to where the camera wants to be and
 * finds the first point blocked by ground or a building. The camera is then
 * placed just short of it, still on that line — so the shot keeps its angle and
 * only its length changes.
 *
 * This replaces lifting the camera up over obstacles. Lifting is correct in the
 * narrow sense that it clears the obstruction, but it moves the camera on the
 * axis the eye is most sensitive to, and it has to move *far*: clearing a
 * cottage from six metres back means climbing most of the cottage's height in
 * the fraction of a second it takes to walk past. Every wall he passes throws
 * the framing. Pulling in travels a much shorter distance for the same result,
 * along an axis that reads as the camera closing on him rather than as the
 * world tilting.
 *
 * The near clamp is the important safety rail: never so close that the lens
 * ends up inside his head.
 */
function clearLineOfSight(
  focusX: number,
  focusY: number,
  focusZ: number,
  desired: THREE.Vector3
): void {
  const eyeY = focusY + 1.45;
  const dx = desired.x - focusX;
  const dy = desired.y - eyeY;
  const dz = desired.z - focusZ;

  // How far along the boom we can get before something is in the way.
  let clear = 1;

  for (let i = 1; i <= LOS_STEPS; i++) {
    const t = i / LOS_STEPS;
    const sx = focusX + dx * t;
    const sz = focusZ + dz * t;
    const sy = eyeY + dy * t;

    const blocked =
      heightAt(sx, sz) + CAMERA_CLEARANCE > sy ||
      // Footprints carry no roof height, so anything inside one counts as solid
      // up to eaves height — enough that the lens does not slip through a wall
      // and sit inside somebody's kitchen.
      (isBlocked(sx, sz, CAMERA_CLEARANCE) &&
        heightAt(sx, sz) + STRUCTURE_LIFT > sy);

    if (blocked) {
      // Stop one step short of the hit rather than at it, so the lens sits in
      // front of the obstruction with a little air rather than touching it.
      clear = Math.max(0, (i - 1) / LOS_STEPS);
      break;
    }
  }

  if (clear < 1) {
    const boom = Math.hypot(dx, dy, dz);
    // Below this the camera is inside him. Better to accept a clipped frame for
    // a moment than to put the lens in his skull.
    const shortest = boom > 1e-3 ? Math.min(MIN_BOOM / boom, 1) : 1;
    const scale = Math.max(shortest, clear);
    desired.set(focusX + dx * scale, eyeY + dy * scale, focusZ + dz * scale);
  }

  // Whatever the boom did, the lens still has to be out of the dirt.
  const here = heightAt(desired.x, desired.z) + GROUND_CLEARANCE;
  if (desired.y < here) desired.y = here;
}

export function FollowCamera({
  target,
  activity,
  enabled = true,
}: {
  target: React.RefObject<THREE.Object3D | null>;
  activity: React.RefObject<Activity>;
  enabled?: boolean;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);

  // Smoothed shot parameters, so switching shots is a dolly, not a cut.
  const shot = useRef<Shot>({ ...SHOTS.travelling });
  const orbit = useRef(0);
  // Reused vectors, held in refs because the frame loop writes to them. Held
  // rather than allocated per frame: at 60fps that would be 180 short-lived
  // Vector3s a second feeding the garbage collector for no reason.
  const vectors = useRef({
    lookAt: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    scratch: new THREE.Vector3(),
  });
  /** True once we've hard-cut onto a grounded bard (not the Canvas default). */
  const framed = useRef(false);
  const lastBardXZ = useRef({ x: 0, z: 0 });

  // Manual look-around. Decays back to the automatic framing when released,
  // so the shot always recovers on its own.
  const userYaw = useRef(0);
  const userPitch = useRef(0);
  const userZoom = useRef(0);
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const idleSince = useRef(0);

  useEffect(() => {
    const element = gl.domElement;

    const onPointerDown = (event: PointerEvent) => {
      dragging.current = true;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) return;
      const dx = event.clientX - lastPointer.current.x;
      const dy = event.clientY - lastPointer.current.y;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      userYaw.current -= dx * 0.005;
      userPitch.current = THREE.MathUtils.clamp(
        userPitch.current + dy * 0.003,
        -0.5,
        0.75
      );
      idleSince.current = 0;
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging.current = false;
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };
    const onWheel = (event: WheelEvent) => {
      // Only take the wheel when the pointer is genuinely over the canvas, so
      // the hero never hijacks page scrolling.
      if (!event.ctrlKey && Math.abs(event.deltaY) < 2) return;
      userZoom.current = THREE.MathUtils.clamp(
        userZoom.current + event.deltaY * 0.004,
        -2.4,
        5
      );
      idleSince.current = 0;
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("wheel", onWheel);
    };
  }, [gl]);

  useFrame((state, rawDelta) => {
    if (!enabled) return;
    const focus = target.current;
    if (!focus) return;

    const delta = Math.min(rawDelta, 0.05);
    const time = state.clock.elapsedTime;

    // --- Blend toward the shot this activity calls for --------------------
    const wanted = shotFor(activity.current);
    const blend = Math.min(1, delta * 0.7);
    shot.current.distance += (wanted.distance - shot.current.distance) * blend;
    shot.current.height += (wanted.height - shot.current.height) * blend;
    shot.current.side += (wanted.side - shot.current.side) * blend;
    shot.current.stiffness += (wanted.stiffness - shot.current.stiffness) * blend;
    shot.current.orbitSpeed += (wanted.orbitSpeed - shot.current.orbitSpeed) * blend;
    shot.current.lookHeight += (wanted.lookHeight - shot.current.lookHeight) * blend;

    orbit.current += shot.current.orbitSpeed * delta;

    // --- Let manual control decay back to automatic -----------------------
    if (!dragging.current) {
      idleSince.current += delta;
      if (idleSince.current > 2.5) {
        const recover = Math.min(1, delta * 0.5);
        userYaw.current *= 1 - recover;
        userPitch.current *= 1 - recover;
        userZoom.current *= 1 - recover;
      }
    }

    // --- Desired camera position ------------------------------------------
    // Behind him relative to his facing, plus the slow orbit and any manual
    // yaw the visitor has dragged in.
    const { desired, lookAt, scratch } = vectors.current;

    const yaw = focus.rotation.y + Math.PI + orbit.current + userYaw.current;
    const distance = Math.max(2.4, shot.current.distance + userZoom.current);
    const height =
      shot.current.height + userPitch.current * distance + userZoom.current * 0.35;

    desired.set(
      focus.position.x +
        Math.sin(yaw) * distance +
        Math.cos(yaw) * shot.current.side,
      focus.position.y + height,
      focus.position.z +
        Math.cos(yaw) * distance -
        Math.sin(yaw) * shot.current.side
    );

    // Lift over ridges and roofs — including when the visitor has dragged the
    // shot into a direction that would otherwise put a mountain between them
    // and the bard. Never pull sideways into the occluder.
    clearLineOfSight(
      focus.position.x,
      focus.position.y,
      focus.position.z,
      desired
    );

    scratch.set(
      focus.position.x,
      focus.position.y + shot.current.lookHeight,
      focus.position.z
    );

    // Wait until the bard is grounded in the world (not the empty origin
    // placeholder), then hard-cut onto him once so we never open on sky/blue.
    const bardXZ = Math.hypot(focus.position.x, focus.position.z);
    const grounded = focus.position.y > 0.05;
    const readyToFrame = grounded && bardXZ > 0.5;
    const teleported =
      framed.current &&
      Math.hypot(
        focus.position.x - lastBardXZ.current.x,
        focus.position.z - lastBardXZ.current.z
      ) > 40;

    if (readyToFrame && (!framed.current || teleported)) {
      camera.position.copy(desired);
      lookAt.copy(scratch);
      camera.lookAt(lookAt);
      framed.current = true;
      lastBardXZ.current = { x: focus.position.x, z: focus.position.z };
      return;
    }

    if (!framed.current) {
      // Keep the Canvas default until he exists — don't lerp into the void.
      return;
    }

    lastBardXZ.current = { x: focus.position.x, z: focus.position.z };

    // --- Move ---------------------------------------------------------------
    const follow = 1 - Math.exp(-shot.current.stiffness * delta);
    camera.position.lerp(desired, follow);
    // Keep the live lens above ground too — the spring can lag behind a steep
    // lift and otherwise dip into a ridge for a frame.
    const liveFloor = heightAt(camera.position.x, camera.position.z) + 1.05;
    if (camera.position.y < liveFloor) camera.position.y = liveFloor;

    // A breath of handheld drift, so the rig is not mathematically still. Kept
    // well under a centimetre: at the old amplitude it was a slow wobble you
    // could follow with your eye, which is the opposite of what it is for.
    camera.position.x += Math.sin(time * 0.31) * 0.006;
    camera.position.y += Math.sin(time * 0.43 + 1.2) * 0.004;

    // --- Aim ---------------------------------------------------------------
    // Slower than the body. The lens catching up a beat after the camera has
    // moved is most of what separates a camera operator from a rig, and it
    // absorbs the last of the jitter the spring passes through.
    lookAt.lerp(scratch, 1 - Math.exp(-2.4 * delta));
    camera.lookAt(lookAt);
  });

  return null;
}

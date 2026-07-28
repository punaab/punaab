"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { heightAt } from "@/lib/world/terrain";
import { isBlocked } from "@/lib/world/collision";
import type { Activity } from "@/lib/bard/adventure";

/** How much air the camera keeps between itself and a wall. */
const CAMERA_CLEARANCE = 0.55;
/** Never dolly closer than this, however tight the space. */
const MIN_CAMERA_DISTANCE = 1.8;

/**
 * A third-person camera that travels with Punaab.
 *
 * Three things make a follow camera feel like cinematography rather than a
 * rig bolted to a character's back:
 *
 *  1. **Damping, not parenting.** The camera chases a target position with a
 *     spring. Parented cameras inherit every twitch of the walk cycle.
 *  2. **It changes shot for what he's doing.** Walking gets a trailing
 *     over-the-shoulder; performing gets a slow arc round to his front, so you
 *     see him sing. A single fixed angle for eight minutes is a screensaver.
 *  3. **It never clips through the world.** The ground is sampled under the
 *     camera every frame and it lifts to stay above it.
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
    stiffness: 1.5,
    orbitSpeed: 0.015,
    lookHeight: 1.45,
  },
  // Singing or resting: closer, lower, arcing slowly round to his face.
  performing: {
    distance: 4.2,
    height: 2.0,
    side: -2.1,
    stiffness: 0.85,
    orbitSpeed: 0.11,
    lookHeight: 1.5,
  },
  // Trading or talking: conversational two-shot distance.
  close: {
    distance: 4.6,
    height: 2.3,
    side: 1.9,
    stiffness: 1.1,
    orbitSpeed: 0.05,
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

    // --- Keep it out of the ground ----------------------------------------
    // Sampling the height function directly is far cheaper than a raycast and
    // exact, since the terrain *is* that function.
    const groundHere = heightAt(desired.x, desired.z);
    const minimum = groundHere + 1.1;
    if (desired.y < minimum) desired.y = minimum;

    // Also check the midpoint, so a ridge between camera and bard pushes the
    // camera up and over rather than letting the hill eat him.
    const midX = (desired.x + focus.position.x) / 2;
    const midZ = (desired.z + focus.position.z) / 2;
    const groundMid = heightAt(midX, midZ) + 1.4;
    if (desired.y < groundMid) desired.y = groundMid;

    // --- Keep it out of the buildings -------------------------------------
    //
    // The world now has 600+ structures, and a camera parked six metres behind
    // the bard lands inside a wall the moment he walks past a cottage — you end
    // up staring at the inside of somebody's masonry.
    //
    // Sample along the line from him to the camera and stop at the first solid
    // thing. Marching from the bard OUTWARD rather than from the camera inward
    // matters: it guarantees the camera ends up on his side of any wall, which
    // is the whole point. A wall between the two would otherwise be "resolved"
    // by leaving the camera exactly where it already was — behind it.
    const toX = desired.x - focus.position.x;
    const toZ = desired.z - focus.position.z;
    const span = Math.hypot(toX, toZ);
    if (span > 0.01) {
      const steps = 8;
      let allowed = span;
      for (let i = 1; i <= steps; i++) {
        const t = (i / steps) * span;
        const sx = focus.position.x + (toX / span) * t;
        const sz = focus.position.z + (toZ / span) * t;
        // A generous probe radius, so the near clip plane never ends up flush
        // against a wall it technically cleared.
        if (isBlocked(sx, sz, CAMERA_CLEARANCE)) {
          allowed = Math.max(MIN_CAMERA_DISTANCE, t - CAMERA_CLEARANCE);
          break;
        }
      }
      if (allowed < span) {
        const scale = allowed / span;
        desired.x = focus.position.x + toX * scale;
        desired.z = focus.position.z + toZ * scale;
        // Pulling in shortens the shot, so lift a little to keep him framed
        // rather than filling the screen with the back of his hood.
        desired.y += (1 - scale) * 1.2;
        // Re-check the ground at the new, closer position.
        const pulledGround = heightAt(desired.x, desired.z) + 1.1;
        if (desired.y < pulledGround) desired.y = pulledGround;
      }
    }

    // --- Move ---------------------------------------------------------------
    // Exponential smoothing framed in per-second terms, so the feel of the
    // damping doesn't change with frame rate.
    const follow = 1 - Math.exp(-shot.current.stiffness * delta);
    camera.position.lerp(desired, follow);

    // A gentle handheld drift. Small enough to be subliminal, and the single
    // cheapest thing that stops a camera move looking machine-generated.
    camera.position.x += Math.sin(time * 0.37) * 0.016;
    camera.position.y += Math.sin(time * 0.53 + 1.2) * 0.012;

    // --- Aim ---------------------------------------------------------------
    scratch.set(
      focus.position.x,
      focus.position.y + shot.current.lookHeight,
      focus.position.z
    );
    lookAt.lerp(scratch, 1 - Math.exp(-3.2 * delta));
    camera.lookAt(lookAt);
  });

  return null;
}

"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AdventureDirector, type Activity } from "@/lib/bard/adventure";
import {
  PUNAAB_BACKPACK_URL,
  PUNAAB_IDLE_URL,
  PUNAAB_LOOT_URL,
  PUNAAB_STRUM_IDLE_URL,
  PUNAAB_WALK_URL,
} from "@/lib/bard/punaab-model";
import { heightAt, normalAt } from "@/lib/world/terrain";
import { SongAura } from "@/components/world/SongAura";
import type { MusicLevels } from "@/lib/bard/performance";
import { walkAmbience } from "@/lib/bard/walk-ambience";

/** Idle / strum-idle play at half speed — unhurried. */
const IDLE_RATE = 0.5;

function pickLongestClip(
  clips: THREE.AnimationClip[]
): THREE.AnimationClip | null {
  return clips.reduce<THREE.AnimationClip | null>(
    (best, clip) => (!best || clip.duration > best.duration ? clip : best),
    null
  );
}

/**
 * Divisor for walk clip timeScale. Tuned so full travel pace plays at ~0.5×
 * (the unhurried cadence), even though ground speed is faster than that.
 */
const WALK_CLIP_SPEED = 1.16;

/**
 * Sole sits a hair above the heightfield so the shoe mesh never clips. Kept
 * tiny — larger clearance reads as floating once the LOD terrain mesh sits
 * slightly below the analytic heightAt sample.
 */
const FOOT_CLEARANCE = 0.006;
/** Cap plant-lift so a bad toe sample cannot hoist him a handspan off the dirt. */
const MAX_FOOT_LIFT = 0.05;

/** How fast he blends into the standing strum. */
const PLAY_FOLLOW = 4.5;
/** Slower leave so the lute hand-off into idle isn't a hard cut. */
const PLAY_RELEASE = 1.65;
/** Stand in idle after a song before the road takes him again. */
const POST_SONG_IDLE = 2.8;

/**
 * loot.glb is ~1.9 m along +Y (neck at +Y). Parenting to the hand bone
 * inherits the strum wrist twist and flips the instrument. We mount it on
 * the character root in metres and aim the neck at the left hand each frame.
 */
const LOOT_WORLD_SCALE = 0.42;
/** Distance from mesh origin to neck tip after scale (~half of 1.9 * scale). */
const LOOT_NECK_HALF = 0.95 * LOOT_WORLD_SCALE;

/** Backpack mesh is ~1.9 m tall; scale ~52 → ~1.0 m pack on his back (~2×). */
const BACKPACK_BONE_SCALE = 52;

/** Footfalls per metre of travel — drives the pack bob. */
const BACKPACK_STEPS_PER_METRE = 1.7;
const BACKPACK_BOB_CM = 1.15;
const BACKPACK_TILT = 0.055;

type Locomotion = {
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  strumIdle: THREE.AnimationAction;
};

/**
 * Punaab in the valley: authored GLB mesh with idle / walk clips, plus a
 * standing strum used for the whole song. While music plays he is held still —
 * no walking strum — and cradles the loot prop in his arms.
 */
export function Bard({
  director,
  onFrame,
  pluckSignal: _pluckSignal,
  singing: _singing,
  playingMusic,
  activity: _activity,
  bardRef,
  headAnchorRef,
  sampleMusic,
}: {
  director: AdventureDirector;
  onFrame?: (position: THREE.Vector3, activity: Activity) => void;
  pluckSignal: React.RefObject<number>;
  singing: React.RefObject<boolean>;
  /** True for the whole song, not just sung notes — drives standing strum. */
  playingMusic: React.RefObject<boolean>;
  activity: React.RefObject<Activity>;
  bardRef: React.RefObject<THREE.Object3D | null>;
  headAnchorRef: React.RefObject<THREE.Object3D | null>;
  sampleMusic: React.RefObject<() => MusicLevels>;
}) {
  const idleGltf = useGLTF(PUNAAB_IDLE_URL);
  const walkGltf = useGLTF(PUNAAB_WALK_URL);
  const strumIdleGltf = useGLTF(PUNAAB_STRUM_IDLE_URL);
  const lootGltf = useGLTF(PUNAAB_LOOT_URL);
  const backpackGltf = useGLTF(PUNAAB_BACKPACK_URL);

  const model = useMemo(() => {
    const clone = cloneSkinned(idleGltf.scene);
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (
          material &&
          "envMapIntensity" in material &&
          typeof material.envMapIntensity === "number"
        ) {
          material.envMapIntensity = 0.55;
        }
      }
    });
    return clone;
  }, [idleGltf.scene]);

  const loot = useMemo(() => {
    const prop = lootGltf.scene.clone(true);
    prop.name = "LootProp";
    prop.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    prop.scale.setScalar(LOOT_WORLD_SCALE);
    prop.visible = false;
    return prop;
  }, [lootGltf.scene]);

  const leftHand = useMemo(
    () =>
      model.getObjectByName("LeftHand") ??
      model.getObjectByName("LeftForeArm"),
    [model]
  );
  const spineHold = useMemo(
    () =>
      model.getObjectByName("Spine02") ??
      model.getObjectByName("Spine01") ??
      model.getObjectByName("Spine") ??
      model,
    [model]
  );

  /** Mount stays fixed on the spine; bob group is nudged each footfall. */
  const backpackBob = useMemo(() => {
    const mount = new THREE.Group();
    mount.name = "BackpackMount";
    // Upper back, further behind the ribs so the larger pack clears his torso.
    // Bone-local centimetres; -Z is out through his back.
    mount.position.set(0, 12, -34);
    mount.rotation.set(0.12, Math.PI, 0);

    const bob = new THREE.Group();
    bob.name = "BackpackBob";
    mount.add(bob);

    const pack = backpackGltf.scene.clone(true);
    pack.name = "Backpack";
    pack.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    pack.scale.setScalar(BACKPACK_BONE_SCALE);
    bob.add(pack);

    const hold =
      model.getObjectByName("Spine02") ??
      model.getObjectByName("Spine01") ??
      model.getObjectByName("Spine") ??
      model;
    hold.add(mount);
    return bob;
  }, [backpackGltf.scene, model]);

  const headAnchor = useMemo(() => {
    const anchor = new THREE.Object3D();
    anchor.name = "SpeechAnchor";
    const crown =
      model.getObjectByName("head_end") ?? model.getObjectByName("Head");
    if (crown?.name === "head_end") {
      anchor.position.set(0, 6, 0);
    } else {
      anchor.position.set(0, 28, 4);
    }
    (crown ?? model).add(anchor);
    return anchor;
  }, [model]);

  // Prefer Foot (sole) over ToeBase — toes sit a few centimetres higher and
  // were biasing plant-lift so he hovered after each step.
  const leftToe = useMemo(
    () =>
      model.getObjectByName("LeftFoot") ??
      model.getObjectByName("LeftToeBase"),
    [model]
  );
  const rightToe = useMemo(
    () =>
      model.getObjectByName("RightFoot") ??
      model.getObjectByName("RightToeBase"),
    [model]
  );

  const wrapperRef = useRef<THREE.Group>(null);
  const locomotionRef = useRef<Locomotion | null>(null);
  const heading = useRef(0);
  const smoothedSpeed = useRef(0);
  const walkWeight = useRef(0);
  const playWeight = useRef(0);
  /** loose → song (held) → rest (held, idle) → loose (walking again). */
  const performPhase = useRef<"loose" | "song" | "rest">("loose");
  const restRemaining = useRef(0);
  const packStepPhase = useRef(0);
  /** Smoothed root height — snaps up out of dirt, eases down so he never tunnels. */
  const groundedY = useRef<number | null>(null);
  const leftFootWorld = useMemo(() => new THREE.Vector3(), []);
  const rightFootWorld = useMemo(() => new THREE.Vector3(), []);
  const handWorld = useMemo(() => new THREE.Vector3(), []);
  const chestWorld = useMemo(() => new THREE.Vector3(), []);
  const neckDir = useMemo(() => new THREE.Vector3(), []);
  const faceDir = useMemo(() => new THREE.Vector3(), []);
  const sideDir = useMemo(() => new THREE.Vector3(), []);
  const lootBasis = useMemo(() => new THREE.Matrix4(), []);
  const lootWorldQuat = useMemo(() => new THREE.Quaternion(), []);
  const lootRollQuat = useMemo(() => new THREE.Quaternion(), []);
  const rootWorldQuat = useMemo(() => new THREE.Quaternion(), []);

  const idleClip = useMemo(
    () => pickLongestClip(idleGltf.animations),
    [idleGltf.animations]
  );
  const walkClip = useMemo(
    () => pickLongestClip(walkGltf.animations),
    [walkGltf.animations]
  );
  const strumIdleClip = useMemo(
    () => pickLongestClip(strumIdleGltf.animations),
    [strumIdleGltf.animations]
  );

  useEffect(() => {
    if (!idleClip || !walkClip || !strumIdleClip) return;

    const mixer = new THREE.AnimationMixer(model);
    const idle = mixer.clipAction(idleClip);
    const walk = mixer.clipAction(walkClip);
    const strumIdle = mixer.clipAction(strumIdleClip);

    for (const action of [idle, walk]) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      action.setEffectiveWeight(0);
    }
    // Ping-pong the strum so the loop never snaps back to frame 0 mid-song.
    strumIdle.setLoop(THREE.LoopPingPong, Infinity);
    strumIdle.play();
    strumIdle.setEffectiveWeight(0);

    idle.setEffectiveWeight(1);
    idle.setEffectiveTimeScale(IDLE_RATE);
    strumIdle.setEffectiveTimeScale(IDLE_RATE);
    walk.setEffectiveTimeScale(1);

    locomotionRef.current = { mixer, idle, walk, strumIdle };

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      locomotionRef.current = null;
    };
  }, [model, idleClip, walkClip, strumIdleClip]);

  useEffect(() => {
    bardRef.current = wrapperRef.current;
    headAnchorRef.current = headAnchor;
    return () => {
      bardRef.current = null;
      headAnchorRef.current = null;
      walkAmbience.setWalking(0);
    };
  }, [bardRef, headAnchorRef, headAnchor]);

  useFrame((_state, rawDelta) => {
    const root = wrapperRef.current;
    const loco = locomotionRef.current;
    if (!root || !loco) return;

    const delta = Math.min(rawDelta, 0.05);

    const playing = playingMusic.current;
    if (playing && performPhase.current !== "song") {
      performPhase.current = "song";
      restRemaining.current = 0;
      director.hold(true);
    } else if (!playing && performPhase.current === "song") {
      // Song just ended / was silenced — linger in standing idle before walking.
      performPhase.current = "rest";
      restRemaining.current = POST_SONG_IDLE;
    } else if (performPhase.current === "rest") {
      restRemaining.current -= delta;
      if (restRemaining.current <= 0) {
        performPhase.current = "loose";
        // Song is done — keep lingering to talk/trade if he was at a stop.
        director.hold(false);
      }
    }

    const resting = performPhase.current === "rest";
    const heldStill = performPhase.current !== "loose";

    const adventure = director.update(delta);
    const { x, z } = adventure.position;
    root.position.x = x;
    root.position.z = z;

    let angleDelta = adventure.heading - heading.current;
    while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
    while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
    heading.current += angleDelta * Math.min(1, delta * 8);
    root.rotation.y = heading.current;

    // Mild slope lean only — hard tilt was lifting one foot off the dirt.
    const groundNormal = normalAt(x, z, 1.2);
    const slopePitch = Math.atan2(groundNormal.z, groundNormal.y);
    const slopeRoll = -Math.atan2(groundNormal.x, groundNormal.y);
    root.rotation.x += (slopePitch * 0.08 - root.rotation.x) * delta * 4;
    root.rotation.z += (slopeRoll * 0.08 - root.rotation.z) * delta * 4;

    // Songs + post-song rest: stand still. Travel: blend idle↔walk from speed.
    const speed = heldStill ? 0 : adventure.speed;
    smoothedSpeed.current +=
      (speed - smoothedSpeed.current) * Math.min(1, delta * 6);
    const shownSpeed = smoothedSpeed.current;
    const targetWalk =
      !heldStill && shownSpeed > 0.04
        ? Math.min(1, shownSpeed / Math.max(0.12, director.walkSpeed * 0.6))
        : 0;
    walkWeight.current += (targetWalk - walkWeight.current) * Math.min(1, delta * 5);

    const targetPlay = playing ? 1 : 0;
    const playFollow = playing ? PLAY_FOLLOW : PLAY_RELEASE;
    playWeight.current +=
      (targetPlay - playWeight.current) * Math.min(1, delta * playFollow);

    // During rest, bias hard into idle so he never freezes on a dead strum pose.
    if (resting && playWeight.current < 0.2) {
      walkWeight.current *= 0.85;
    }

    const w = walkWeight.current;
    const p = playWeight.current;
    loco.idle.setEffectiveWeight((1 - w) * (1 - p));
    loco.walk.setEffectiveWeight(w * (1 - p));
    // Full standing strum while a song is on — never a walking strum.
    loco.strumIdle.setEffectiveWeight(p);

    // Grass loop follows the walk blend; silent while he stands or strums.
    walkAmbience.setWalking(w * (1 - p));

    // Loot only while he is mid-song (or blending in/out of it).
    loot.visible = p > 0.08;
    loot.scale.setScalar(LOOT_WORLD_SCALE * Math.min(1, p * 1.15));

    // Pack bobs once per footfall — soft settle when he stands still.
    packStepPhase.current += shownSpeed * delta * BACKPACK_STEPS_PER_METRE * Math.PI;
    const bobStrength = w * w;
    const bob = Math.sin(packStepPhase.current) * BACKPACK_BOB_CM * bobStrength;
    const sway = Math.sin(packStepPhase.current * 0.5) * BACKPACK_TILT * bobStrength;
    backpackBob.position.y = THREE.MathUtils.damp(
      backpackBob.position.y,
      bob,
      14,
      delta
    );
    backpackBob.rotation.x = THREE.MathUtils.damp(
      backpackBob.rotation.x,
      -bob * 0.02 + sway * 0.35,
      12,
      delta
    );
    backpackBob.rotation.z = THREE.MathUtils.damp(
      backpackBob.rotation.z,
      sway,
      12,
      delta
    );

    const walkRate = Math.min(0.55, Math.max(0.3, shownSpeed / WALK_CLIP_SPEED));
    loco.walk.setEffectiveTimeScale(heldStill ? 0 : walkRate);
    loco.idle.setEffectiveTimeScale(IDLE_RATE);
    loco.strumIdle.setEffectiveTimeScale(playing ? IDLE_RATE : IDLE_RATE * 0.85);
    loco.mixer.update(delta);

    // Grounding: place the root on the heightfield, then only PUSH UP if a
    // sole digs in. Follow both up and down so a crest plant cannot leave him
    // hovering for half a stride.
    const baseY = heightAt(x, z) + FOOT_CLEARANCE;
    root.position.y = baseY;
    root.updateMatrixWorld(true);

    let extraLift = 0;
    if (leftToe && rightToe) {
      leftToe.getWorldPosition(leftFootWorld);
      rightToe.getWorldPosition(rightFootWorld);
      const leftLift =
        heightAt(leftFootWorld.x, leftFootWorld.z) +
        FOOT_CLEARANCE -
        leftFootWorld.y;
      const rightLift =
        heightAt(rightFootWorld.x, rightFootWorld.z) +
        FOOT_CLEARANCE -
        rightFootWorld.y;
      extraLift = Math.min(
        MAX_FOOT_LIFT,
        Math.max(0, leftLift, rightLift)
      );
    }

    const targetY = baseY + extraLift;
    if (groundedY.current === null) {
      groundedY.current = targetY;
    } else {
      const rate = targetY >= groundedY.current ? 24 : 18;
      groundedY.current +=
        (targetY - groundedY.current) * Math.min(1, delta * rate);
    }
    root.position.y = groundedY.current;

    root.updateMatrixWorld(true);

    // Cradle the lute in front of the chest: neck (+Y) aims at the left
    // hand, soundboard (+Z) faces outward so it never clips the beard.
    if (p > 0.08 && leftHand && spineHold) {
      leftHand.getWorldPosition(handWorld);
      spineHold.getWorldPosition(chestWorld);

      // Body sits mid-torso, a little forward and down from the spine.
      root.getWorldQuaternion(rootWorldQuat);
      faceDir.set(0, 0, 1).applyQuaternion(rootWorldQuat);
      sideDir.set(1, 0, 0).applyQuaternion(rootWorldQuat);
      chestWorld.addScaledVector(faceDir, 0.16);
      chestWorld.addScaledVector(sideDir, 0.04);
      chestWorld.y -= 0.08;

      neckDir.subVectors(handWorld, chestWorld);
      if (neckDir.lengthSq() < 1e-6) {
        neckDir.set(0.2, 0.9, 0.1).applyQuaternion(rootWorldQuat);
      }
      neckDir.normalize();

      // Place the mesh so the neck tip lands near the left-hand grip.
      chestWorld.copy(handWorld).addScaledVector(neckDir, -LOOT_NECK_HALF * 0.92);

      // Facing him: lift into the hands and shift toward screen-right (his left / +X).
      sideDir.set(1, 0, 0).applyQuaternion(rootWorldQuat);
      chestWorld.addScaledVector(sideDir, 0.08);
      chestWorld.y += 0.28;

      // Orthonormal basis: +Y = neck, +Z ≈ character forward (soundboard out).
      faceDir.set(0, 0, 1).applyQuaternion(rootWorldQuat);
      faceDir.addScaledVector(neckDir, -faceDir.dot(neckDir));
      if (faceDir.lengthSq() < 1e-6) {
        faceDir.set(0, 1, 0).applyQuaternion(rootWorldQuat);
        faceDir.addScaledVector(neckDir, -faceDir.dot(neckDir));
      }
      faceDir.normalize();
      sideDir.crossVectors(neckDir, faceDir).normalize();
      faceDir.crossVectors(sideDir, neckDir).normalize();
      lootBasis.makeBasis(sideDir, neckDir, faceDir);
      lootWorldQuat.setFromRotationMatrix(lootBasis);
      // Negative roll reads counterclockwise from the front.
      lootRollQuat.setFromAxisAngle(faceDir, -0.32);
      lootWorldQuat.premultiply(lootRollQuat);

      root.worldToLocal(chestWorld);
      loot.position.copy(chestWorld);
      // Local = inverse(root) * world
      loot.quaternion
        .copy(rootWorldQuat)
        .invert()
        .multiply(lootWorldQuat);
    }

    onFrame?.(root.position, adventure.activity);
  });

  return (
    <group ref={wrapperRef}>
      <primitive object={model} />
      <primitive object={loot} />
      <group position={[0, 1.35, 0.1]}>
        <SongAura intensity={playWeight} sampleMusic={sampleMusic} />
      </group>
    </group>
  );
}

useGLTF.preload(PUNAAB_IDLE_URL);
useGLTF.preload(PUNAAB_WALK_URL);
useGLTF.preload(PUNAAB_STRUM_IDLE_URL);
useGLTF.preload(PUNAAB_LOOT_URL);
useGLTF.preload(PUNAAB_BACKPACK_URL);

"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AdventureDirector, type Activity } from "@/lib/bard/adventure";
import {
  PUNAAB_BACKPACK_URL,
  PUNAAB_IDLE_URL,
  PUNAAB_LOOT_URL,
  PUNAAB_STRUM_IDLE_URL,
  PUNAAB_WALK_URL,
} from "@/lib/bard/punaab-model";
import { normalAt } from "@/lib/world/terrain";
import { surfaceAt } from "@/lib/world/surfaces";
import { SongAura } from "@/components/world/SongAura";
import type { MusicLevels } from "@/lib/bard/performance";
import { walkAmbience } from "@/lib/bard/walk-ambience";
import { daylight } from "@/lib/world/daylight";
import { detectQuality, type QualityBudget } from "@/lib/world/quality";

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
 * Sole sits a hair above the walkable surface so the shoe mesh never clips.
 * Tiny — the LOD terrain mesh sits slightly below the analytic sample, and a
 * larger gap reads as floating.
 */
const FOOT_CLEARANCE = 0.012;
/** Cap plant-lift so a bad sole sample cannot hoist him a handspan off the dirt. */
const MAX_FOOT_LIFT = 0.04;
/** Allow a small downward correction when both soles are floating. */
const MAX_FOOT_DROP = 0.03;
/** Snap onto elevated decks (bridges) instead of easing up through the span. */
const DECK_SNAP = 0.1;

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

// ---------------------------------------------------------------------------
// The lantern on his pack
// ---------------------------------------------------------------------------

/**
 * Every length below is in the backpack mount's units, which are *bone-local
 * centimetres*, not metres.
 *
 * The skeleton is authored at 100× and the character root scales it back down,
 * so the mount that sits `-34` behind his spine sits 34 centimetres behind it —
 * and a lantern written in metres, at the same `-34`, would trail him by a third
 * of the valley. The pack itself is the proof: a 1.9-unit mesh at `scale 52`
 * comes out ~99 units tall and reads as a metre of canvas on his back.
 *
 * The point light is the exception. `distance` and `decay` are consumed in world
 * space by the renderer, which reads only the translation out of the light's
 * matrix — so those two stay in metres however deeply scaled the parent is.
 */
const LANTERN_CORD_CM = 4;
const LANTERN_RADIUS_CM = 3.8;
const LANTERN_CAGE_CM = 7.5;

/**
 * Peak candela, before `lampFactor` and the flame.
 *
 * Sized against the sun's 2.15: a metre and a half down, on the dirt he is
 * standing on, this lands near 2 — a pool bright enough to walk by — and by six
 * metres it is a wash worth a tenth of that. The valley is 640 metres across and
 * nothing beyond his own clearing should be able to tell he is carrying a light.
 */
const LANTERN_PEAK = 4.5;
/** Hard cutoff. Past here the falloff has nothing left to contribute anyway. */
const LANTERN_RANGE_M = 14;
/**
 * Softer than inverse-square, on purpose.
 *
 * The nearest surface to this light is his own pack, thirty centimetres away,
 * and a true `1/d²` at that range does not read as a lantern — it reads as a
 * white hole where the canvas used to be. Pulling the exponent down flattens the
 * near field without meaningfully extending the reach.
 */
const LANTERN_DECAY = 1.75;

/** Peak pendulum swing, radians, at a full walking stride. */
const LANTERN_SWING = 0.22;
/**
 * How far behind the pack's footfall the lantern hangs, in radians of step.
 *
 * A hanging thing does not arrive where its hook does at the same instant, and
 * that lag is the entire difference between "hanging off the pack" and
 * "modelled onto the pack". It reuses `packStepPhase` rather than a clock of its
 * own so the two can never drift apart — a second oscillator at a slightly
 * different rate would beat against the pack every few seconds, which looks
 * exactly like the animation is broken.
 */
const LANTERN_LAG = 0.9;

type Lantern = {
  /** Rides the pack's bob group; the fixed point the lantern hangs from. */
  hook: THREE.Group;
  /** Pivots at the hook. Everything below it swings. */
  swing: THREE.Group;
  /** Null on the low tier, which cannot afford a live light. */
  light: THREE.PointLight | null;
  glass: THREE.MeshStandardMaterial;
  dispose(): void;
};

/**
 * A hooded lantern lashed to the flank of his pack.
 *
 * Sited off the pack's measured bounding box rather than off numbers typed in
 * here, because the pack is an authored GLB: the day somebody re-exports it a
 * size larger, a hard-coded offset puts the lantern inside the canvas, and a
 * lantern buried in a bag is a bug nobody thinks to look for. Just outside the
 * widest point is the one place that stays clear whatever silhouette the mesh
 * has.
 *
 * It hangs on his right. The lute is cradled towards his left whenever he plays,
 * and two props fighting over the same half of his body is the kind of clipping
 * that only shows up on camera.
 */
function buildLantern(
  packBox: THREE.Box3,
  tier: QualityBudget["tier"]
): Lantern {
  const hook = new THREE.Group();
  hook.name = "LanternHook";
  // Mount space is turned 180° about Y so the pack faces out of his back, which
  // flips X with it: +X here is his right.
  hook.position.set(packBox.max.x * 1.02, packBox.max.y * 0.62, packBox.max.z * 0.45);

  const swing = new THREE.Group();
  swing.name = "LanternSwing";
  hook.add(swing);

  const drop = LANTERN_CORD_CM;
  const radius = LANTERN_RADIUS_CM;
  const bailRadius = radius * 0.58;
  const bailY = -(drop + bailRadius);
  const capHeight = 2.8;
  const capY = bailY - bailRadius * 0.62 - capHeight * 0.5;
  const cageTop = capY - capHeight * 0.5;
  const cageY = cageTop - LANTERN_CAGE_CM * 0.5;
  const baseHeight = 1.6;
  const baseY = cageTop - LANTERN_CAGE_CM - baseHeight * 0.5;

  // Everything metal merges to one geometry — a lantern is six primitives, and
  // six draw calls hung off a bone is six too many for a prop this size.
  const parts: THREE.BufferGeometry[] = [];

  const cord = new THREE.CylinderGeometry(0.26, 0.26, drop, 4);
  cord.translate(0, -drop * 0.5, 0);
  parts.push(cord);

  const cap = new THREE.ConeGeometry(radius * 1.06, capHeight, 6);
  cap.translate(0, capY, 0);
  parts.push(cap);

  const base = new THREE.CylinderGeometry(radius * 0.82, radius * 0.94, baseHeight, 6);
  base.translate(0, baseY, 0);
  parts.push(base);

  if (tier !== "low") {
    // The cage is what makes it read as a lantern rather than a glowing bead,
    // but it is also four thin boxes that are two pixels wide at the distance
    // the camera actually sits — the first thing the cheap tier can lose.
    const posts = radius * 0.62;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const post = new THREE.BoxGeometry(0.5, LANTERN_CAGE_CM, 0.5);
      post.translate(Math.cos(angle) * posts, cageY, Math.sin(angle) * posts);
      parts.push(post);
    }
    const bail = new THREE.TorusGeometry(bailRadius, 0.28, 4, 10);
    bail.translate(0, bailY, 0);
    parts.push(bail);
  }

  const frameGeometry = mergeGeometries(parts, false) ?? parts[0];
  for (const part of parts) {
    if (part !== frameGeometry) part.dispose();
  }

  // Same numbers the buildings' ironwork uses, so his lantern and a smithy's
  // hinges are demonstrably the same metal.
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: "#2b2620",
    roughness: 0.52,
    metalness: 0.6,
    flatShading: true,
  });
  const frame = new THREE.Mesh(frameGeometry, frameMaterial);
  // No shadow: it is a centimetre of iron against a metre of pack, and the
  // shadow camera is spending its resolution on him.
  frame.castShadow = false;
  frame.receiveShadow = false;
  swing.add(frame);

  const glassGeometry = new THREE.SphereGeometry(radius * 0.66, 8, 6);
  glassGeometry.translate(0, cageY, 0);
  // Horn-coloured and dead by day, driven above the bloom threshold at night —
  // the same trick the lit windows use, and the reason the lantern is visible
  // from across a field without the point light having to reach that far.
  const glass = new THREE.MeshStandardMaterial({
    color: "#c9b189",
    emissive: new THREE.Color("#ff9a3c"),
    emissiveIntensity: 0,
    roughness: 0.35,
    metalness: 0,
  });
  const glassMesh = new THREE.Mesh(glassGeometry, glass);
  glassMesh.castShadow = false;
  glassMesh.receiveShadow = false;
  swing.add(glassMesh);

  let light: THREE.PointLight | null = null;
  if (tier !== "low") {
    light = new THREE.PointLight("#ffb15e", 0, LANTERN_RANGE_M, LANTERN_DECAY);
    light.name = "LanternFlame";
    // Inside the glass, where a flame would be. Never a shadow caster: a point
    // light's shadow is six renders of the scene, for a lamp whose whole job is
    // a warm circle on the dirt.
    light.castShadow = false;
    light.position.set(0, cageY, 0);
    swing.add(light);
  }

  return {
    hook,
    swing,
    light,
    glass,
    dispose() {
      hook.removeFromParent();
      frameGeometry.dispose();
      frameMaterial.dispose();
      glassGeometry.dispose();
      glass.dispose();
    },
  };
}

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
  budget,
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
  /**
   * Optional so the scene keeps working before the integrator threads it
   * through. `detectQuality` is a pure read of the device and the query string,
   * so falling back to it yields the same tier `BardWorld` already chose — but
   * it is a fallback, not a second source of truth: pass the budget down and
   * a `?quality=` override stays honoured everywhere at once.
   */
  budget?: QualityBudget;
}) {
  const quality = useMemo(() => budget ?? detectQuality(), [budget]);
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
  const { bob: backpackBob, box: packBox } = useMemo(() => {
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

    // Measured before it joins the skeleton, which is the only moment the box
    // comes out in mount-local centimetres — once the bone owns it, the same
    // call would hand back a world-space box that moves every time he does.
    // Anything that has to sit *on* the pack (the lantern) is placed off this.
    const box = new THREE.Box3().setFromObject(pack);
    bob.add(pack);

    const hold =
      model.getObjectByName("Spine02") ??
      model.getObjectByName("Spine01") ??
      model.getObjectByName("Spine") ??
      model;
    hold.add(mount);
    return { bob, box };
  }, [backpackGltf.scene, model]);

  /**
   * The lantern, hung off the pack once the pack exists.
   *
   * Separate from the pack's own memo so re-measuring the bag does not rebuild
   * the light, and so the disposal has a single owner: `buildLantern` hands
   * back its own teardown and this effect is the only thing that calls it.
   */
  const lantern = useMemo(
    () => buildLantern(packBox, quality.tier),
    [packBox, quality.tier]
  );

  useEffect(() => {
    backpackBob.add(lantern.hook);
    return () => lantern.dispose();
  }, [backpackBob, lantern]);

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
        director.hold(false);
      }
    }

    const resting = performPhase.current === "rest";
    const heldStill =
      performPhase.current === "song" || performPhase.current === "rest";

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

    // Freeze locomotion while he sings — no walk blend bleed-through.
    const speed = heldStill ? 0 : adventure.speed;
    smoothedSpeed.current +=
      (speed - smoothedSpeed.current) * Math.min(1, delta * 6);
    const shownSpeed = smoothedSpeed.current;
    const targetWalk =
      heldStill || shownSpeed <= 0.04
        ? 0
        : Math.min(1, shownSpeed / Math.max(0.12, director.walkSpeed * 0.6));
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
    // Full size while held — no shrink-away; it just disappears when he stops.
    loot.visible = p > 0.08;
    loot.scale.setScalar(LOOT_WORLD_SCALE);

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

    // The lantern hangs, so it arrives late. Reading the pack's own step phase
    // one `LANTERN_LAG` behind is the whole trick: it swings with him, always
    // trailing, and can never beat against the pack the way a second clock at a
    // slightly different rate would.
    const swingPhase = packStepPhase.current - LANTERN_LAG;
    lantern.swing.rotation.z = THREE.MathUtils.damp(
      lantern.swing.rotation.z,
      Math.sin(swingPhase) * LANTERN_SWING * bobStrength,
      9,
      delta
    );
    lantern.swing.rotation.x = THREE.MathUtils.damp(
      lantern.swing.rotation.x,
      Math.cos(swingPhase * 0.5) * LANTERN_SWING * 0.45 * bobStrength,
      9,
      delta
    );

    // Lit by the same curve that lights every window in the valley, so he is
    // never the only one walking with a lamp at noon. Three incommensurable
    // rates for the flame: any two would settle into an audible-looking beat.
    const lampLevel = daylight.lampFactor;
    if (lampLevel > 0.002) {
      const t = _state.clock.elapsedTime;
      const flicker =
        0.82 +
        Math.sin(t * 9.7) * 0.09 +
        Math.sin(t * 5.3 + 1.7) * 0.06 +
        Math.sin(t * 21.9 + 0.4) * 0.03;
      lantern.glass.emissiveIntensity = lampLevel * flicker * 2.6;
      if (lantern.light) lantern.light.intensity = lampLevel * flicker * LANTERN_PEAK;
    } else if (lantern.glass.emissiveIntensity !== 0) {
      // Settle to a hard zero once, rather than leaving a light on at 0.001
      // candela costing every lit fragment in the frame all day.
      lantern.glass.emissiveIntensity = 0;
      if (lantern.light) lantern.light.intensity = 0;
    }

    const walkRate = Math.min(0.55, Math.max(0.3, shownSpeed / WALK_CLIP_SPEED));
    loco.walk.setEffectiveTimeScale(heldStill || shownSpeed < 0.04 ? 0 : walkRate);
    loco.idle.setEffectiveTimeScale(IDLE_RATE);
    loco.strumIdle.setEffectiveTimeScale(playing ? IDLE_RATE : IDLE_RATE * 0.85);
    loco.mixer.update(delta);

    // Grounding: stand on the walkable surface (terrain or bridge/dock deck),
    // then nudge so neither sole sinks. Snap up onto decks — easing through a
    // multi-metre rise reads as walking through the bridge.
    const baseY = surfaceAt(x, z) + FOOT_CLEARANCE;
    root.position.y = baseY;
    root.updateMatrixWorld(true);

    let extraLift = 0;
    if (leftToe && rightToe) {
      leftToe.getWorldPosition(leftFootWorld);
      rightToe.getWorldPosition(rightFootWorld);
      const leftLift =
        surfaceAt(leftFootWorld.x, leftFootWorld.z) +
        FOOT_CLEARANCE -
        leftFootWorld.y;
      const rightLift =
        surfaceAt(rightFootWorld.x, rightFootWorld.z) +
        FOOT_CLEARANCE -
        rightFootWorld.y;
      // Plant the deeper sole; allow a small drop when both feet float.
      extraLift = Math.min(
        MAX_FOOT_LIFT,
        Math.max(-MAX_FOOT_DROP, leftLift, rightLift)
      );
    }

    const targetY = baseY + extraLift;
    if (groundedY.current === null) {
      groundedY.current = targetY;
    } else {
      const gap = targetY - groundedY.current;
      if (gap >= DECK_SNAP) {
        groundedY.current = targetY;
      } else {
        const rate = gap >= 0 ? 32 : 22;
        groundedY.current += gap * Math.min(1, delta * rate);
      }
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
        <SongAura
          intensity={playWeight}
          sampleMusic={sampleMusic}
          budget={quality}
        />
      </group>
    </group>
  );
}

useGLTF.preload(PUNAAB_IDLE_URL);
useGLTF.preload(PUNAAB_WALK_URL);
useGLTF.preload(PUNAAB_STRUM_IDLE_URL);
useGLTF.preload(PUNAAB_LOOT_URL);
useGLTF.preload(PUNAAB_BACKPACK_URL);

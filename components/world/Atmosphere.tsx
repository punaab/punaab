"use client";

import { Environment, Lightformer, Sparkles } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { makeCloudTexture } from "@/lib/world/textures";
import type { QualityBudget } from "@/lib/world/quality";
import { GHIBLI } from "@/lib/world/ghibli-palette";
import {
  advanceDaylight,
  daylight,
  daylightFrozen,
  seedDaylight,
} from "@/lib/world/daylight";
import { NightSky } from "./NightSky";

/**
 * Light, sky, weather — and the clock that drives all three.
 *
 * The valley runs a full day/night cycle. `lib/world/daylight.ts` owns the
 * arithmetic; this file is the only place that *advances* it, and the only
 * place that pushes its results into the renderer. Everything else in the world
 * reads the same singleton and therefore cannot disagree about what time it is.
 *
 * Nothing here is React state. The sun moves every frame, so every value that
 * follows it is written straight onto the three.js object inside `useFrame`.
 */

const SUN_DISTANCE = 220;

/**
 * Advances the clock, and applies the two things that live on the renderer and
 * the scene rather than on any object: exposure and fog.
 *
 * It runs at a negative frame priority so the clock is already correct for this
 * frame before any other component reads it. Without that ordering, half the
 * world would render one frame behind the other half — which is invisible at
 * noon and very visible during the ninety seconds either side of sunset, when
 * the light is changing fastest.
 */
function DaylightClock() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const frozen = useMemo(() => daylightFrozen(), []);

  // Seed before first paint. An effect would run *after* the first frame had
  // already been drawn at whatever time the module was last left at. Seeding is
  // itself once-per-page-load rather than once-per-mount — see `seedDaylight`.
  useMemo(() => seedDaylight(), []);

  useFrame((_state, rawDelta) => {
    // A tab left in the background hands back a delta of many seconds. Letting
    // that through would teleport the sun; clamping means a returning visitor
    // simply resumes where they left, which is what they expect to see.
    if (!frozen) advanceDaylight(Math.min(rawDelta, 0.1));

    gl.toneMappingExposure = daylight.exposure;

    const fog = scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.color.copy(daylight.fogColor);
      fog.density = daylight.fogDensity;
    }

    // The environment map is baked once and is therefore a *daytime* sky
    // forever. Rather than pay to re-bake it, its contribution is dialled down
    // after dark — otherwise every polished surface in the valley goes on
    // reflecting a sunlit horizon hours after sunset.
    scene.environmentIntensity = 0.12 + (1 - daylight.nightFactor) * 0.88;
  }, -10);

  return null;
}

/**
 * The Preetham sky dome.
 *
 * Driven imperatively off three's own `Sky` object rather than through drei's
 * declarative wrapper, because every one of these parameters changes each frame
 * and the wrapper's props would mean reconciling a component sixty times a
 * second to write four floats.
 */
function SkyDome() {
  const sky = useMemo(() => {
    const dome = new Sky();
    dome.scale.setScalar(450000);
    dome.name = "SkyDome";
    return dome;
  }, []);

  useEffect(() => () => {
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
  }, [sky]);

  useFrame(() => {
    const uniforms = sky.material.uniforms;
    uniforms.turbidity.value = daylight.turbidity;
    uniforms.rayleigh.value = daylight.rayleigh;
    uniforms.mieCoefficient.value = daylight.mieCoefficient;
    uniforms.mieDirectionalG.value = daylight.mieDirectionalG;
    uniforms.sunPosition.value.copy(daylight.sunDir);
  });

  return <primitive object={sky} />;
}

/**
 * The one shadow-casting light in the valley — the sun by day, the moon by
 * night. `daylight` arranges for both to be at zero intensity at the moment the
 * direction swaps, so the handover cannot be seen and the scene never pays for
 * a second shadow map.
 */
function KeyLight({
  target,
  budget,
}: {
  target: React.RefObject<THREE.Object3D | null>;
  budget: QualityBudget;
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const anchor = useMemo(() => new THREE.Object3D(), []);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    scene.add(anchor);
    return () => {
      scene.remove(anchor);
    };
  }, [scene, anchor]);

  useFrame(() => {
    const light = lightRef.current;
    const focus = target.current;
    if (!light || !focus) return;

    anchor.position.copy(focus.position);
    anchor.updateMatrixWorld();

    light.position
      .copy(focus.position)
      .addScaledVector(daylight.keyDir, SUN_DISTANCE);
    light.target = anchor;
    light.color.copy(daylight.keyColor);
    light.intensity = daylight.keyIntensity;
    // Skipping the shadow pass outright once the light is dark is most of the
    // reason night is not more expensive than day: the moon is dim enough that
    // its shadows are barely present anyway. Low tier never pays for maps.
    light.castShadow = budget.shadows && daylight.keyIntensity > 0.05;
  });

  return (
    <directionalLight
      ref={lightRef}
      castShadow={budget.shadows}
      intensity={2.15}
      color={GHIBLI.sun}
      shadow-mapSize-width={budget.shadowMapSize}
      shadow-mapSize-height={budget.shadowMapSize}
      shadow-camera-left={-16}
      shadow-camera-right={16}
      shadow-camera-top={16}
      shadow-camera-bottom={-16}
      shadow-camera-near={SUN_DISTANCE - 40}
      shadow-camera-far={SUN_DISTANCE + 40}
      shadow-bias={-0.0004}
      shadow-normalBias={0.035}
    />
  );
}

function Clouds({ count }: { count: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);

  // Materials are built here rather than in JSX so the cycle can retint them.
  // They stay one-per-puff because each carries its own opacity, and a shared
  // material would need the alpha moved into a vertex attribute to keep it —
  // twenty-odd colour copies a frame is not worth that.
  const { texture, geometry, puffs } = useMemo(() => {
    const tex = makeCloudTexture(128, 3);
    const geo = new THREE.PlaneGeometry(1, 0.55);
    const generated = Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + Math.sin(i * 2.3);
      const radius = 150 + ((i * 37) % 130);
      return {
        position: new THREE.Vector3(
          Math.cos(angle) * radius,
          88 + ((i * 13) % 48),
          Math.sin(angle) * radius
        ),
        scale: 38 + ((i * 19) % 34),
        opacity: 0.22 + ((i * 7) % 10) * 0.03,
        drift: 0.28 + ((i * 11) % 7) * 0.07,
        material: new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.22 + ((i * 7) % 10) * 0.03,
          depthWrite: false,
          color: new THREE.Color(GHIBLI.cloudBody),
          toneMapped: false,
        }),
      };
    });
    return { texture: tex, geometry: geo, puffs: generated };
  }, [count]);

  useEffect(
    () => () => {
      texture.dispose();
      geometry.dispose();
      for (const puff of puffs) puff.material.dispose();
    },
    [texture, geometry, puffs]
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    for (let i = 0; i < group.children.length; i++) {
      const puff = group.children[i];
      puff.position.x += puffs[i].drift * delta;
      if (puff.position.x > 300) puff.position.x = -300;
      puff.lookAt(camera.position);
      // Clouds are the most obvious thing in frame still lit by a sun that has
      // set, so they take the cycle's tint directly. Fading them out at night
      // as well keeps them from reading as pale holes punched in the stars.
      puffs[i].material.color.copy(daylight.cloudColor);
      puffs[i].material.opacity =
        puffs[i].opacity * (1 - daylight.nightFactor * 0.55);
    }
  });

  return (
    <group ref={groupRef} name="Clouds">
      {puffs.map((puff, i) => (
        <mesh
          key={i}
          position={puff.position}
          scale={puff.scale}
          geometry={geometry}
          material={puff.material}
        />
      ))}
    </group>
  );
}

type BirdRig = {
  root: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  radius: number;
  height: number;
  speed: number;
  phase: number;
  flapRate: number;
  flapOffset: number;
  centre: THREE.Vector3;
  prevAngle: number;
};

function makeBirdGeometries() {
  // Body — elongated teardrop silhouette.
  const body = new THREE.ConeGeometry(0.11, 0.42, 5, 1, false);
  body.rotateX(Math.PI / 2);
  body.translate(0, 0, 0.02);

  // Wing — tapered plane, pivot at the inner edge (body join).
  const wing = new THREE.BufferGeometry();
  wing.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        0, 0, 0.02, 0.55, 0.04, -0.04, 0.52, -0.02, 0.06, 0, 0, 0.02, 0.48,
        0.02, 0.1, 0.22, -0.01, 0.08,
      ],
      3
    )
  );
  wing.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
  wing.computeVertexNormals();

  const tail = new THREE.BufferGeometry();
  tail.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, -0.16, -0.12, 0.02, -0.34, 0.12, 0.02, -0.34],
      3
    )
  );
  tail.computeVertexNormals();

  return { body, wing, tail };
}

function Birds() {
  const flockRef = useRef<THREE.Group>(null);
  const rigsRef = useRef<BirdRig[]>([]);

  const materials = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({
        color: "#2a2c34",
        roughness: 0.92,
        metalness: 0.05,
      }),
      wing: new THREE.MeshStandardMaterial({
        color: "#1f2128",
        roughness: 0.88,
        metalness: 0.04,
        side: THREE.DoubleSide,
      }),
    }),
    []
  );

  useEffect(() => {
    const flock = flockRef.current;
    if (!flock) return;

    const geos = makeBirdGeometries();
    const rigs: BirdRig[] = [];

    for (let i = 0; i < 11; i++) {
      const root = new THREE.Group();
      root.name = `Bird-${i}`;

      const body = new THREE.Mesh(geos.body, materials.body);
      body.castShadow = false;
      root.add(body);

      const tail = new THREE.Mesh(geos.tail, materials.wing);
      root.add(tail);

      const leftWing = new THREE.Mesh(geos.wing, materials.wing);
      leftWing.position.set(-0.04, 0.02, 0.02);
      leftWing.scale.x = -1;
      root.add(leftWing);

      const rightWing = new THREE.Mesh(geos.wing, materials.wing);
      rightWing.position.set(0.04, 0.02, 0.02);
      root.add(rightWing);

      const scale = 1.15 + (i % 4) * 0.12;
      root.scale.setScalar(scale);
      flock.add(root);

      rigs.push({
        root,
        leftWing,
        rightWing,
        radius: 28 + (i % 5) * 8,
        height: 24 + (i % 6) * 3.5,
        speed: 0.11 + (i % 4) * 0.035,
        phase: (i / 11) * Math.PI * 2,
        flapRate: 7.5 + (i % 3) * 1.4,
        flapOffset: i * 0.85,
        centre: new THREE.Vector3(
          Math.sin(i * 2.1) * 26,
          0,
          Math.cos(i * 1.7) * 26
        ),
        prevAngle: 0,
      });
    }

    rigsRef.current = rigs;

    return () => {
      for (const rig of rigs) {
        flock.remove(rig.root);
      }
      geos.body.dispose();
      geos.wing.dispose();
      geos.tail.dispose();
      materials.body.dispose();
      materials.wing.dispose();
      rigsRef.current = [];
    };
  }, [materials]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (const bird of rigsRef.current) {
      const angle = bird.phase + t * bird.speed;
      const x = bird.centre.x + Math.cos(angle) * bird.radius;
      const z = bird.centre.z + Math.sin(angle) * bird.radius;
      const y =
        bird.height +
        Math.sin(t * 0.55 + bird.phase) * 1.8 +
        Math.sin(t * bird.flapRate + bird.flapOffset) * 0.25;

      bird.root.position.set(x, y, z);

      // Face along the flight path and bank into the turn.
      const heading = -angle + Math.PI / 2;
      const turn = angle - bird.prevAngle;
      bird.prevAngle = angle;
      const bank = THREE.MathUtils.clamp(turn * 18, -0.55, 0.55);
      const pitch = -0.12 + Math.sin(t * 0.4 + bird.phase) * 0.06;
      bird.root.rotation.set(pitch, heading, bank);

      // Real flap: wings hinge at the body, up-stroke / down-stroke.
      const flap =
        Math.sin(t * bird.flapRate + bird.flapOffset) * 0.85 +
        Math.sin(t * bird.flapRate * 2.1 + bird.flapOffset) * 0.12;
      bird.leftWing.rotation.z = flap;
      bird.rightWing.rotation.z = -flap;
      bird.leftWing.rotation.x = -0.08 + Math.abs(flap) * 0.1;
      bird.rightWing.rotation.x = -0.08 + Math.abs(flap) * 0.1;
    }
  });

  return <group ref={flockRef} name="Birds" />;
}

const POLLEN_OPACITY = 0.45;

/**
 * Daytime pollen. It has to go at night, or the meadow is full of bright motes
 * competing with the fireflies that are supposed to have taken over.
 *
 * Fading it is more awkward than it looks. drei's `Sparkles` carries opacity as
 * a **per-vertex attribute**, not a uniform, and its fragment shader ignores
 * the material's own `opacity` entirely — so the obvious `material.opacity = x`
 * compiles, runs, and does absolutely nothing.
 *
 * The one supported lever is that `Sparkles` accepts a `Float32Array` for
 * `opacity` and uses it verbatim rather than building its own. So this owns
 * that array, writes the faded value into it, and flags the attribute. Three
 * hundred floats a frame is nothing, and it goes through drei's public prop
 * rather than reaching into its internals.
 */
function DriftingPollen({ count }: { count: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const attributeRef = useRef<THREE.BufferAttribute | null>(null);
  const opacities = useMemo(
    () => new Float32Array(count).fill(POLLEN_OPACITY),
    [count]
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;

    const fade = 1 - THREE.MathUtils.smoothstep(daylight.nightFactor, 0.15, 0.7);
    group.visible = fade > 0.01;
    if (!group.visible) return;

    if (!attributeRef.current) {
      group.traverse((object) => {
        const attribute = (object as THREE.Points).geometry?.attributes
          ?.opacity as THREE.BufferAttribute | undefined;
        if (attribute) attributeRef.current = attribute;
      });
    }

    const attribute = attributeRef.current;
    if (!attribute) return;
    const target = POLLEN_OPACITY * fade;
    // Nothing to upload when the value has not moved, which is most of the day.
    if (Math.abs(opacities[0] - target) < 0.002) return;
    opacities.fill(target);
    attribute.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <Sparkles
        count={count}
        scale={[70, 14, 70]}
        position={[0, 6, 0]}
        size={2.4}
        speed={0.2}
        opacity={opacities}
        color={GHIBLI.gTrans}
        noise={0.55}
      />
    </group>
  );
}

export function Atmosphere({
  target,
  budget,
}: {
  target: React.RefObject<THREE.Object3D | null>;
  budget: QualityBudget;
}) {
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const fogRef = useRef<THREE.FogExp2>(null);

  useFrame(() => {
    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.copy(daylight.hemiSky);
      hemi.groundColor.copy(daylight.hemiGround);
      hemi.intensity = daylight.hemiIntensity;
    }
    const ambient = ambientRef.current;
    if (ambient) {
      ambient.color.copy(daylight.ambientColor);
      ambient.intensity = daylight.ambientIntensity;
    }
    // Belt and braces with DaylightClock: r3f attaches fog by replacing
    // `scene.fog`, and this ref is the one guaranteed handle on the instance
    // this component actually created.
    const fog = fogRef.current;
    if (fog) {
      fog.color.copy(daylight.fogColor);
      fog.density = daylight.fogDensity;
    }
  });

  return (
    <>
      <DaylightClock />
      <SkyDome />
      <NightSky budget={budget} />

      <Environment resolution={128} frames={1}>
        <Lightformer
          intensity={2.6}
          color={GHIBLI.sun}
          position={[-8, 2.5, 4]}
          scale={[12, 12, 1]}
        />
        <Lightformer
          intensity={0.85}
          color={GHIBLI.ambSky}
          position={[6, 8, -6]}
          scale={[16, 16, 1]}
        />
        <Lightformer
          form="ring"
          intensity={1.25}
          color={GHIBLI.skyHorizonSun}
          position={[0, 10, 0]}
          scale={[20, 20, 1]}
          rotation={[Math.PI / 2, 0, 0]}
        />
        <Lightformer
          intensity={0.48}
          color={GHIBLI.bounce}
          position={[0, -6, 0]}
          scale={[24, 24, 1]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
      </Environment>

      <KeyLight target={target} budget={budget} />

      <hemisphereLight
        ref={hemiRef}
        args={[GHIBLI.ambSky, GHIBLI.ambGround, 1.05]}
      />
      <ambientLight ref={ambientRef} intensity={0.32} color={GHIBLI.mist} />

      <fogExp2 ref={fogRef} attach="fog" args={[GHIBLI.mist, 0.002]} />

      <Clouds count={budget.tier === "low" ? 6 : 22} />
      {budget.tier !== "low" && <Birds />}

      {budget.tier !== "low" && (
        <DriftingPollen count={budget.tier === "high" ? 280 : 140} />
      )}
    </>
  );
}

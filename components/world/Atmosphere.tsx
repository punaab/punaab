"use client";

import { Environment, Lightformer, Sky, Sparkles } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { makeCloudTexture } from "@/lib/world/textures";
import type { QualityBudget } from "@/lib/world/quality";
import { GHIBLI, ghibliSunDirection } from "@/lib/world/ghibli-palette";

/**
 * Light, sky, weather — soft Ghibli-inspired late afternoon.
 *
 * Palette and sun angle drawn from the valley look reference.
 */

const SUN_DIRECTION = new THREE.Vector3(...ghibliSunDirection()).normalize();
const SUN_DISTANCE = 220;

function Sun({
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
      .addScaledVector(SUN_DIRECTION, SUN_DISTANCE);
    light.target = anchor;
  });

  return (
    <directionalLight
      ref={lightRef}
      castShadow
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

  const { texture, puffs } = useMemo(() => {
    const tex = makeCloudTexture(128, 3);
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
      };
    });
    return { texture: tex, puffs: generated };
  }, [count]);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    for (let i = 0; i < group.children.length; i++) {
      const puff = group.children[i];
      puff.position.x += puffs[i].drift * delta;
      if (puff.position.x > 300) puff.position.x = -300;
      puff.lookAt(camera.position);
    }
  });

  return (
    <group ref={groupRef} name="Clouds">
      {puffs.map((puff, i) => (
        <mesh key={i} position={puff.position} scale={puff.scale}>
          <planeGeometry args={[1, 0.55]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={puff.opacity}
            depthWrite={false}
            color={GHIBLI.cloudBody}
            toneMapped={false}
          />
        </mesh>
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

export function Atmosphere({
  target,
  budget,
}: {
  target: React.RefObject<THREE.Object3D | null>;
  budget: QualityBudget;
}) {
  const sunPosition = useMemo(
    () => SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE),
    []
  );

  return (
    <>
      <Sky
        distance={4500}
        sunPosition={sunPosition}
        turbidity={9.2}
        rayleigh={1.85}
        mieCoefficient={0.0075}
        mieDirectionalG={0.88}
      />

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

      <Sun target={target} budget={budget} />

      <hemisphereLight args={[GHIBLI.ambSky, GHIBLI.ambGround, 1.05]} />
      <ambientLight intensity={0.32} color={GHIBLI.mist} />

      <fogExp2 attach="fog" args={[GHIBLI.mist, 0.002]} />

      <Clouds count={budget.tier === "low" ? 12 : 22} />
      <Birds />

      {budget.tier !== "low" && (
        <Sparkles
          count={budget.tier === "high" ? 280 : 140}
          scale={[70, 14, 70]}
          position={[0, 6, 0]}
          size={2.4}
          speed={0.2}
          opacity={0.45}
          color={GHIBLI.gTrans}
          noise={0.55}
        />
      )}
    </>
  );
}

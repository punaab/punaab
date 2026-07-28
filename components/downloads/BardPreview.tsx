"use client";

import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { BardPalette } from "@/lib/bard/build-bard";
import {
  PUNAAB_HEIGHT,
  PUNAAB_IDLE_URL,
  PUNAAB_STRUM_IDLE_URL,
  PUNAAB_WALK_URL,
} from "@/lib/bard/punaab-model";

export type PreviewAnim = "idle" | "walk" | "strum-idle";

const CLIP_RATE = 0.5;

const URLS: Record<PreviewAnim, string> = {
  idle: PUNAAB_IDLE_URL,
  walk: PUNAAB_WALK_URL,
  "strum-idle": PUNAAB_STRUM_IDLE_URL,
};

/**
 * Turntable preview of the authored Punaab GLB.
 *
 * Each pack is its own skinned scene + clip so the mixer always binds to the
 * bones that shipped with that file.
 */
function Model({ anim }: { anim: PreviewAnim }) {
  const gltf = useGLTF(URLS[anim]);

  const model = useMemo(() => {
    const clone = cloneSkinned(gltf.scene);
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    return clone;
  }, [gltf.scene]);

  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    const clip = gltf.animations[0];
    if (!clip) return;

    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.setEffectiveTimeScale(CLIP_RATE);
    action.setEffectiveWeight(1);
    action.enabled = true;
    action.reset().play();
    mixerRef.current = mixer;

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      mixerRef.current = null;
    };
  }, [model, gltf.animations]);

  useFrame((state, delta) => {
    mixerRef.current?.update(Math.min(delta, 0.05));
    const group = groupRef.current;
    if (group) group.rotation.y = state.clock.elapsedTime * 0.35;
  });

  return (
    <group ref={groupRef} position={[0, -PUNAAB_HEIGHT * 0.5, 0]}>
      <primitive object={model} />
    </group>
  );
}

export function BardPreview({
  palette: _palette,
  anim,
  playing,
}: {
  palette: BardPalette;
  anim?: PreviewAnim;
  /** Embed toggle — walk when true, idle when false. Ignored if `anim` is set. */
  playing?: boolean;
}) {
  const mode: PreviewAnim =
    anim !== undefined ? anim : playing ? "walk" : "idle";

  return (
    <div className="bard-preview">
      <Canvas
        shadows
        frameloop="always"
        dpr={[1, 1.75]}
        camera={{ position: [0, 0.15, 4.6], fov: 34 }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <Suspense fallback={null}>
          <directionalLight
            castShadow
            position={[3, 5, 4]}
            intensity={2.4}
            color="#ffe0b8"
            shadow-mapSize={[1024, 1024]}
            shadow-camera-left={-2}
            shadow-camera-right={2}
            shadow-camera-top={3}
            shadow-camera-bottom={-1}
            shadow-normalBias={0.03}
          />
          <directionalLight position={[-4, 2, 2]} intensity={0.55} color="#9fc7ff" />
          <directionalLight position={[0, 3, -5]} intensity={1.5} color="#ffd0a0" />
          <ambientLight intensity={0.35} />

          <Environment resolution={64} frames={1}>
            <Lightformer
              intensity={2}
              color="#ffd9a0"
              position={[-4, 2, 3]}
              scale={[6, 6, 1]}
            />
            <Lightformer
              intensity={1.1}
              color="#a8c8ff"
              position={[4, 3, -2]}
              scale={[8, 8, 1]}
            />
          </Environment>

          <Model key={mode} anim={mode} />

          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -PUNAAB_HEIGHT * 0.5, 0]}
            receiveShadow
          >
            <circleGeometry args={[2.4, 48]} />
            <shadowMaterial opacity={0.32} />
          </mesh>
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload(PUNAAB_IDLE_URL);
useGLTF.preload(PUNAAB_WALK_URL);
useGLTF.preload(PUNAAB_STRUM_IDLE_URL);

"use client";

import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

const CLIP_RATE = 0.85;
/** Extra space so walk/strum limb swings stay inside the frame. */
const FRAME_PADDING = 1.28;

const URLS: Record<PreviewAnim, string> = {
  idle: PUNAAB_IDLE_URL,
  walk: PUNAAB_WALK_URL,
  "strum-idle": PUNAAB_STRUM_IDLE_URL,
};

type Frame = {
  offset: [number, number, number];
  centerY: number;
  height: number;
};

function pickClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  if (!clips.length) return null;
  // Prefer a real loop — some Meshy packs ship a near-zero stub alongside the clip.
  return clips.reduce((best, clip) =>
    clip.duration > best.duration ? clip : best
  );
}

function measureFrame(model: THREE.Object3D): Frame {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) {
    return {
      offset: [0, -PUNAAB_HEIGHT * 0.5, 0],
      centerY: PUNAAB_HEIGHT * 0.5,
      height: PUNAAB_HEIGHT,
    };
  }

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // Feet on the shadow plane, torso centered on X/Z (models are often off-origin).
  const height = Math.max(size.y, PUNAAB_HEIGHT * 0.85);
  return {
    offset: [-center.x, -box.min.y, -center.z],
    centerY: height * 0.5,
    height,
  };
}

/** Pull the camera back so the full standing figure fits with animation padding. */
function FitCamera({ frame }: { frame: Frame }) {
  const { camera, size } = useThree();

  useLayoutEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.degToRad(perspective.fov);
    const aspect = Math.max(0.5, size.width / Math.max(1, size.height));

    const paddedHeight = frame.height * FRAME_PADDING;
    const paddedWidth = paddedHeight * 0.55;
    const distForHeight = paddedHeight / 2 / Math.tan(fov / 2);
    const distForWidth = paddedWidth / 2 / (Math.tan(fov / 2) * aspect);
    const distance = Math.max(distForHeight, distForWidth, 2.6);

    perspective.position.set(0, frame.centerY, distance);
    perspective.near = 0.1;
    perspective.far = Math.max(40, distance * 4);
    perspective.lookAt(0, frame.centerY, 0);
    perspective.updateProjectionMatrix();
  }, [camera, frame, size.width, size.height]);

  return null;
}

/**
 * Turntable preview of the authored Punaab GLB.
 *
 * Each pack is its own skinned scene + clip so the mixer always binds to the
 * bones that shipped with that file.
 */
function Model({
  anim,
  onFrame,
}: {
  anim: PreviewAnim;
  onFrame: (frame: Frame) => void;
}) {
  const url = URLS[anim];
  const gltf = useGLTF(url);
  const turntable = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  const model = useMemo(() => {
    const clone = cloneSkinned(gltf.scene);
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    });
    return clone;
  }, [gltf.scene]);

  const frame = useMemo(() => measureFrame(model), [model]);

  useLayoutEffect(() => {
    onFrame(frame);
  }, [frame, onFrame]);

  useEffect(() => {
    const clip = pickClip(gltf.animations);
    if (!clip) return;

    const mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(CLIP_RATE);
    action.reset().play();
    mixerRef.current = mixer;

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      mixerRef.current = null;
    };
    // Depend on the pack URL / model, not `gltf.animations` identity — a fresh
    // array reference each render would restart the mixer and freeze at frame 0.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gltf.animations from cached GLB
  }, [model, url]);

  useFrame((state, delta) => {
    mixerRef.current?.update(Math.min(delta, 0.05));
    const group = turntable.current;
    if (group) {
      // Face the camera first, then slow turntable.
      group.rotation.y = Math.PI + state.clock.elapsedTime * 0.35;
    }
  });

  return (
    <group ref={turntable}>
      <group position={frame.offset}>
        <primitive object={model} />
      </group>
    </group>
  );
}

function PreviewScene({ anim }: { anim: PreviewAnim }) {
  const [frame, setFrame] = useState<Frame>({
    offset: [0, -PUNAAB_HEIGHT * 0.5, 0],
    centerY: PUNAAB_HEIGHT * 0.5,
    height: PUNAAB_HEIGHT,
  });

  return (
    <>
      <FitCamera frame={frame} />
      <directionalLight
        castShadow
        position={[3, 5, 4]}
        intensity={2.4}
        color="#ffe0b8"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-2.5}
        shadow-camera-right={2.5}
        shadow-camera-top={3.5}
        shadow-camera-bottom={-1.5}
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

      <Model key={anim} anim={anim} onFrame={setFrame} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[2.2, 48]} />
        <shadowMaterial opacity={0.32} />
      </mesh>
    </>
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
        camera={{
          position: [0, PUNAAB_HEIGHT * 0.5, 3.8],
          fov: 32,
          near: 0.1,
          far: 50,
        }}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <Suspense fallback={null}>
          <PreviewScene anim={mode} />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload(PUNAAB_IDLE_URL);
useGLTF.preload(PUNAAB_WALK_URL);
useGLTF.preload(PUNAAB_STRUM_IDLE_URL);

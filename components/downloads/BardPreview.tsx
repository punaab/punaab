"use client";

import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { BardPalette } from "@/lib/bard/build-bard";
import {
  PUNAAB_HEIGHT,
  PUNAAB_IDLE_URL,
  PUNAAB_STATIC_2K_URL,
  PUNAAB_STATIC_8K_URL,
  PUNAAB_WALK_URL,
} from "@/lib/bard/punaab-model";

/** Extra space so the figure sits cleanly in the frame. */
const FRAME_PADDING = 1.22;
const CLIP_RATE = 0.85;
/** Radians of yaw per pixel of horizontal drag. */
const DRAG_YAW = 0.0075;
/** Slow idle spin when the player is not dragging. */
const IDLE_SPIN = 0.28;

type Frame = {
  offset: [number, number, number];
  centerY: number;
  height: number;
};

type PreviewMode = "static" | "idle" | "walk";

type Turntable = {
  yaw: MutableRefObject<number>;
  dragging: MutableRefObject<boolean>;
};

function pickClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  if (!clips.length) return null;
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
  const height = Math.max(size.y, PUNAAB_HEIGHT * 0.85);
  return {
    offset: [-center.x, -box.min.y, -center.z],
    centerY: height * 0.5,
    height,
  };
}

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

function applyMeshFlags(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });
}

function AnimatedModel({
  url,
  mode,
  onFrame,
  turntable,
}: {
  url: string;
  mode: "idle" | "walk";
  onFrame: (frame: Frame) => void;
  turntable: Turntable;
}) {
  const gltf = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  const model = useMemo(() => {
    const clone = cloneSkinned(gltf.scene);
    applyMeshFlags(clone);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- gltf.animations from cached GLB
  }, [model, url, mode]);

  useFrame((_, delta) => {
    mixerRef.current?.update(Math.min(delta, 0.05));
    if (!turntable.dragging.current) {
      turntable.yaw.current += delta * IDLE_SPIN;
    }
    const group = groupRef.current;
    if (group) group.rotation.y = turntable.yaw.current;
  });

  return (
    <group ref={groupRef}>
      <group position={frame.offset}>
        <primitive object={model} />
      </group>
    </group>
  );
}

/**
 * Static shelf preview: show the light 2K pack immediately, then quietly swap
 * to 8K once that file is in the GLTF cache — no blank stage in between.
 */
function ProgressiveStaticModel({
  onFrame,
  turntable,
}: {
  onFrame: (frame: Frame) => void;
  turntable: Turntable;
}) {
  const [url, setUrl] = useState(PUNAAB_STATIC_2K_URL);
  const gltf = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (url !== PUNAAB_STATIC_2K_URL) return;
    let cancelled = false;
    void Promise.resolve(useGLTF.preload(PUNAAB_STATIC_8K_URL)).then(() => {
      if (!cancelled) setUrl(PUNAAB_STATIC_8K_URL);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const model = useMemo(() => {
    const clone = cloneSkinned(gltf.scene);
    applyMeshFlags(clone);
    return clone;
  }, [gltf.scene]);

  const frame = useMemo(() => measureFrame(model), [model]);

  useLayoutEffect(() => {
    onFrame(frame);
  }, [frame, onFrame]);

  useFrame((_, delta) => {
    if (!turntable.dragging.current) {
      turntable.yaw.current += delta * IDLE_SPIN;
    }
    const group = groupRef.current;
    if (group) group.rotation.y = turntable.yaw.current;
  });

  return (
    <group ref={groupRef}>
      <group position={frame.offset}>
        <primitive object={model} />
      </group>
    </group>
  );
}

function Model({
  mode,
  onFrame,
  turntable,
}: {
  mode: PreviewMode;
  onFrame: (frame: Frame) => void;
  turntable: Turntable;
}) {
  if (mode === "static") {
    return <ProgressiveStaticModel onFrame={onFrame} turntable={turntable} />;
  }
  const url = mode === "walk" ? PUNAAB_WALK_URL : PUNAAB_IDLE_URL;
  return (
    <AnimatedModel
      url={url}
      mode={mode}
      onFrame={onFrame}
      turntable={turntable}
    />
  );
}

function PreviewScene({
  mode,
  turntable,
}: {
  mode: PreviewMode;
  turntable: Turntable;
}) {
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

      <Model key={mode} mode={mode} onFrame={setFrame} turntable={turntable} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[2.2, 48]} />
        <shadowMaterial opacity={0.32} />
      </mesh>
    </>
  );
}

export function BardPreview({
  palette: _palette,
  playing,
}: {
  /** Kept for embed callers; palette is authored into the GLB now. */
  palette?: BardPalette;
  /** Embed toggle — walk when true, idle when false. Downloads use static. */
  playing?: boolean;
}) {
  const mode: PreviewMode =
    playing === undefined ? "static" : playing ? "walk" : "idle";

  const yaw = useRef(Math.PI);
  const dragging = useRef(false);
  const lastX = useRef(0);
  const turntable = useMemo(() => ({ yaw, dragging }), []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    lastX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = event.clientX - lastX.current;
    lastX.current = event.clientX;
    yaw.current += dx * DRAG_YAW;
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return (
    <div
      className="bard-preview is-draggable"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label="Punaab model preview. Drag left or right to turn."
    >
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
          <PreviewScene mode={mode} turntable={turntable} />
        </Suspense>
      </Canvas>
    </div>
  );
}

// Warm the light pack only — 8K rides in after first paint.
useGLTF.preload(PUNAAB_STATIC_2K_URL);

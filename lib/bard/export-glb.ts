/**
 * Exports Punaab as a real .glb / .gltf file.
 *
 * The character handed to the exporter is the *same* `buildBard()` output the
 * hero scene renders, so what a developer downloads is exactly the character
 * they watched walk across the valley — there is no second, diverging "export
 * model" to keep in sync.
 *
 * glTF 2.0 is the right target for "works in every engine": Godot 4, Unity
 * (via glTFast/UnityGLTF), Unreal 5, three.js, Babylon, PlayCanvas and Bevy
 * all import it natively or with a first-party plugin. The file is written at
 * real-world scale in metres with +Y up and -Z forward, which is what all of
 * them expect.
 */

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { buildBard, DEFAULT_PALETTE, type BardPalette } from "./build-bard";

export type ExportFormat = "glb" | "gltf";

export type ExportOptions = {
  palette?: BardPalette;
  format?: ExportFormat;
  /** Bake the walk, idle and playing poses in as glTF animation clips. */
  includeAnimations?: boolean;
};

/**
 * Builds the animation clips shipped inside the file.
 *
 * These are keyframed onto the same node names the runtime animates, so a
 * developer can either play the baked clips directly or drive the rig
 * themselves from the Punaab API's behaviour events and get identical results.
 */
function buildClips(root: THREE.Object3D): THREE.AnimationClip[] {
  const clips: THREE.AnimationClip[] = [];

  const nodeName = (name: string) =>
    root.getObjectByName(name) ? name : null;

  // --- Walk ---------------------------------------------------------------
  // One full stride, looping. Sampled at 12fps: glTF interpolates between
  // keys, and a walk cycle has no detail finer than that.
  const WALK_DURATION = 1.2;
  const frames = 12;
  const times: number[] = [];
  for (let i = 0; i <= frames; i++) times.push((i / frames) * WALK_DURATION);

  const walkTracks: THREE.KeyframeTrack[] = [];

  const limbSwing = (
    name: string,
    amplitude: number,
    phase: number,
    axis: "x" | "z" = "x"
  ) => {
    if (!nodeName(name)) return;
    const values: number[] = [];
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (let i = 0; i <= frames; i++) {
      const t = (i / frames) * Math.PI * 2 + phase;
      euler.set(0, 0, 0);
      euler[axis] = Math.sin(t) * amplitude;
      quaternion.setFromEuler(euler);
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    walkTracks.push(
      new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values)
    );
  };

  limbSwing("LeftThigh", 0.52, 0);
  limbSwing("RightThigh", 0.52, Math.PI);
  limbSwing("LeftUpperArm", 0.2, Math.PI);
  limbSwing("RightUpperArm", 0.2, 0);
  limbSwing("Chest", 0.13, 0, "z");

  // Pelvis bob — the vertical rise and fall of a stride.
  if (nodeName("Hips")) {
    const hipValues: number[] = [];
    for (let i = 0; i <= frames; i++) {
      const t = (i / frames) * Math.PI * 2;
      hipValues.push(0, 0.95 - Math.abs(Math.sin(t)) * 0.035, 0);
    }
    walkTracks.push(
      new THREE.VectorKeyframeTrack("Hips.position", times, hipValues)
    );
  }

  if (walkTracks.length) {
    clips.push(new THREE.AnimationClip("Walk", WALK_DURATION, walkTracks));
  }

  // --- Idle ---------------------------------------------------------------
  // Breathing only. Long and slow, so it never reads as a loop.
  const IDLE_DURATION = 4;
  const idleTimes = [0, 1, 2, 3, 4];
  const idleTracks: THREE.KeyframeTrack[] = [];
  if (nodeName("Chest")) {
    const values: number[] = [];
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (let i = 0; i < idleTimes.length; i++) {
      euler.set(0.04 + Math.sin((i / 4) * Math.PI * 2) * 0.02, 0, 0);
      quaternion.setFromEuler(euler);
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    idleTracks.push(
      new THREE.QuaternionKeyframeTrack("Chest.quaternion", idleTimes, values)
    );
  }
  if (idleTracks.length) {
    clips.push(new THREE.AnimationClip("Idle", IDLE_DURATION, idleTracks));
  }

  // --- Play ---------------------------------------------------------------
  // The right hand plucking single strings. Deliberately not a strum: a sharp
  // wrist flick that returns, repeated — one note at a time.
  const PLAY_DURATION = 0.9;
  const playTimes = [0, 0.08, 0.3, 0.45, 0.53, 0.75, 0.9];
  const playTracks: THREE.KeyframeTrack[] = [];
  if (nodeName("RightHand")) {
    const flicks = [0, -0.85, -0.1, 0, -0.85, -0.1, 0];
    const values: number[] = [];
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    for (const angle of flicks) {
      euler.set(angle, 0, angle * -0.4);
      quaternion.setFromEuler(euler);
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    playTracks.push(
      new THREE.QuaternionKeyframeTrack("RightHand.quaternion", playTimes, values)
    );
  }
  if (playTracks.length) {
    clips.push(new THREE.AnimationClip("Play", PLAY_DURATION, playTracks));
  }

  return clips;
}

export type ExportResult = {
  blob: Blob;
  filename: string;
  /** Rough triangle count, for the UI to show. */
  triangles: number;
};

/** Exports the character. Browser-only — GLTFExporter needs Blob and FileReader. */
export async function exportBard(
  options: ExportOptions = {}
): Promise<ExportResult> {
  const {
    palette = DEFAULT_PALETTE,
    format = "glb",
    includeAnimations = true,
  } = options;

  const parts = buildBard(palette);
  const root = parts.root;

  // The cloak's rest pose is generated by its simulation, so it has to be
  // stepped once before export or the exported hem sits at the origin.
  parts.updateCloak(0, 0, 0);

  // Wrap in a scene so the exporter emits a well-formed glTF scene node.
  const scene = new THREE.Scene();
  scene.name = "Punaab";
  scene.add(root);
  scene.updateMatrixWorld(true);

  let triangles = 0;
  root.traverse((object) => {
    const asMesh = object as THREE.Mesh;
    if (!asMesh.isMesh) return;
    const index = asMesh.geometry.getIndex();
    triangles += index
      ? index.count / 3
      : asMesh.geometry.attributes.position.count / 3;
  });

  const animations = includeAnimations ? buildClips(root) : [];
  const exporter = new GLTFExporter();

  const output = await exporter.parseAsync(scene, {
    binary: format === "glb",
    animations,
    // Keep node names — they are the contract the engine-side code binds to.
    includeCustomExtensions: false,
    // Punaab is authored in metres already.
    trs: true,
  });

  const blob =
    output instanceof ArrayBuffer
      ? new Blob([output], { type: "model/gltf-binary" })
      : new Blob([JSON.stringify(output, null, 2)], {
          type: "model/gltf+json",
        });

  // Free the GPU-less geometry immediately; this rig was built purely to be
  // serialised and is never rendered.
  parts.dispose();

  return {
    blob,
    filename: `punaab-bard.${format}`,
    triangles: Math.round(triangles),
  };
}

/** Exports and triggers a browser download. */
export async function downloadBard(options: ExportOptions = {}) {
  const { blob, filename } = await exportBard(options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

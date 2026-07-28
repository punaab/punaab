/**
 * Bodies for everyone who is not Punaab.
 *
 * The bard is a hand-authored, hand-rigged model and he is allowed to be
 * expensive — there is one of him and the camera lives on his shoulder. There
 * are forty-odd of these, most of them a hundred metres away, and they are
 * built to a completely different brief: enough articulation to walk
 * convincingly, and nothing else.
 *
 * Three decisions carry most of the performance here:
 *
 * 1. **Colour is baked into vertices**, so every body part in the world shares
 *    one material. Per-NPC palettes would otherwise mean six materials each and
 *    a program switch per limb; this way the only thing that varies between two
 *    villagers is the contents of a buffer nobody rebinds.
 * 2. **Geometry is merged per joint.** A rig is ten to thirteen meshes, not
 *    thirty — every offset is baked into the geometry, so the meshes themselves
 *    sit at identity forever and can turn `matrixAutoUpdate` off.
 * 3. **The hierarchy is fixed and shallow.** Fifteen joints with predictable
 *    names, so the animator in `components/world/NPCs.tsx` can drive a whole
 *    crowd from one loop over a plain array without touching the scene graph.
 *
 * Proportion is the other half of the job. A humanoid built from "about a metre
 * and a half, arms about half that" reads as a garden gnome no matter how well
 * it is animated, so every length here is a fraction of standing height taken
 * from the seven-and-a-half-head canon — and children get five and a half,
 * because a child drawn with adult proportions reads as a very short adult,
 * which is unsettling in a way viewers notice without being able to say why.
 *
 * Everything faces +Z at `rotation.y = 0`, which makes the heading for a
 * movement of (dx, dz) exactly `Math.atan2(dx, dz)`.
 */

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { NpcKind } from "./npc";

const TAU = Math.PI * 2;

/**
 * Integer hash -> [0, 1). Same implementation as `terrain.ts`, and `Math.imul`
 * is load-bearing for the same reason: a plain `*` on these constants overflows
 * past 2^53 and drops exactly the low bits that are the hash's entire output.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[Math.floor(hash2(seed, salt) * list.length) % list.length];
}

/**
 * FNV-1a over the kind name.
 *
 * Seeding appearance from the *length* of the kind — the obvious shortcut —
 * gives villagers and merchants identical faces, because both words are eight
 * letters long. Hashing the whole string costs nothing and removes a class of
 * coincidence that is very visible once two of them stand together.
 */
function kindSalt(kind: string): number {
  let h = 2166136261;
  for (let i = 0; i < kind.length; i++) {
    h = Math.imul(h ^ kind.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

/**
 * Every primitive below is *indexed*. `mergeGeometries` refuses to mix indexed
 * and non-indexed sources, which rules out `IcosahedronGeometry` — hence
 * low-segment spheres everywhere a blob is wanted.
 */

const tint = new THREE.Color();

/**
 * Bakes a flat colour into a geometry's vertices.
 *
 * `Color.set` converts from sRGB into the renderer's linear working space, and
 * vertex colours are read as working-space values, so the shading maths lands
 * where it should without any per-material colour management.
 */
function paint(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  shade = 1
): THREE.BufferGeometry {
  tint.set(color);
  if (shade !== 1) tint.multiplyScalar(shade);

  const count = geometry.attributes.position.count;
  const array = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    array[i * 3] = tint.r;
    array[i * 3 + 1] = tint.g;
    array[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(array, 3));
  return geometry;
}

/** A tapered segment hanging down from the joint origin. */
function limb(
  topRadius: number,
  bottomRadius: number,
  length: number,
  color: THREE.ColorRepresentation,
  radial = 6
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    length,
    radial,
    1,
    false
  );
  geometry.translate(0, -length * 0.5, 0);
  return paint(geometry, color);
}

/** An ellipsoid centred on the origin. */
function blob(
  rx: number,
  ry: number,
  rz: number,
  color: THREE.ColorRepresentation,
  widthSegments = 7,
  heightSegments = 5
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  geometry.scale(rx, ry, rz);
  return paint(geometry, color);
}

/** The top slice of an ellipsoid — hair, hoods, helmets. */
function cap(
  rx: number,
  ry: number,
  rz: number,
  sweep: number,
  color: THREE.ColorRepresentation
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(
    1,
    8,
    4,
    0,
    TAU,
    0,
    Math.PI * sweep
  );
  geometry.scale(rx, ry, rz);
  return paint(geometry, color);
}

function box(
  width: number,
  height: number,
  depth: number,
  color: THREE.ColorRepresentation
): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(width, height, depth), color);
}

/**
 * Merges a joint's parts down to one geometry, disposing the sources.
 *
 * A failed merge would mean mismatched attributes, which cannot happen with the
 * primitives above — but returning the first part beats throwing inside a
 * render tree, so the rig comes out wrong rather than the scene coming out
 * blank.
 */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (parts.length === 1) return parts[0];
  const merged = mergeGeometries(parts, false);
  if (!merged) {
    for (let i = 1; i < parts.length; i++) parts[i].dispose();
    return parts[0];
  }
  for (const part of parts) part.dispose();
  return merged;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/**
 * One material for every person and animal in the world.
 *
 * Lambert rather than Standard: with colour in the vertices there is nothing
 * for roughness and metalness to do on a woollen tunic, and Lambert's fragment
 * shader is a fraction of the cost across a crowd. The caller owns the instance
 * and disposes it — the rigs deliberately do not, because they all share it.
 */
export function createCharacterMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

export type HumanoidPalette = {
  skin: string;
  hair: string;
  /** Upper body. */
  tunic: string;
  /** Sleeves, where they differ from the tunic. */
  sleeve: string;
  trouser: string;
  belt: string;
  boot: string;
  hat: string;
};

export type Headwear =
  | "none"
  | "cap"
  | "hood"
  | "straw"
  | "helm"
  | "kerchief"
  | "cowl";

export type Carry = "none" | "pack" | "basket" | "spear" | "staff";

/**
 * Skin and hair pools, shared by every kind. Kept broad on purpose: a valley
 * where everyone has the same face reads as a clone farm, and the tell is
 * strongest at exactly the distance NPCs are usually seen from.
 */
const SKIN = [
  "#f0cdac",
  "#e2b189",
  "#c99a72",
  "#ad7c55",
  "#8c5f41",
  "#6b452e",
  "#4d3122",
];

const HAIR = [
  "#241a13",
  "#3a2a1c",
  "#5a3f26",
  "#7c5a32",
  "#a1834f",
  "#c9b78f",
  "#7d2f1a",
  "#8f8a84",
  "#d8d3c6",
];

type KindStyle = {
  tunic: readonly string[];
  trouser: readonly string[];
  belt: string;
  boot: string;
  hat: readonly string[];
  headwear: readonly Headwear[];
  carry: readonly Carry[];
  /** Standing height range in metres. */
  height: [number, number];
  /** Body mass range, 0 slight to 1 heavy. */
  build: [number, number];
};

/**
 * Dye tells you who someone is. Peasant cloth is what the local plants give —
 * weld yellow, madder brown, woad on a good year — while a merchant can afford
 * saturation and a guard wears whatever the lord paid for. Getting this
 * hierarchy right does more for reading a settlement at a glance than any
 * amount of geometry.
 */
const STYLES: Record<string, KindStyle> = {
  villager: {
    tunic: ["#7d6a4d", "#6b5f46", "#5c6b52", "#8a7355", "#6f5a4a", "#55606b"],
    trouser: ["#4a4034", "#584a3a", "#3f3a30", "#5f5341"],
    belt: "#3a2b1e",
    boot: "#3b2c20",
    hat: ["#6b5b43", "#7a6a4e", "#4f4536"],
    headwear: ["none", "none", "cap", "kerchief"],
    carry: ["none", "none", "none", "pack"],
    height: [1.6, 1.85],
    build: [0.2, 0.85],
  },
  merchant: {
    tunic: ["#8c3a2e", "#3f4a86", "#7a5a1e", "#5c3a6b", "#2f6b5a"],
    trouser: ["#3a3244", "#42382c", "#2e3a44"],
    belt: "#5a3a1c",
    boot: "#4a3320",
    hat: ["#7a2f24", "#333f6b", "#6b551c"],
    headwear: ["cap", "cap", "kerchief", "none"],
    carry: ["pack", "basket", "none"],
    height: [1.62, 1.82],
    build: [0.35, 0.95],
  },
  guard: {
    tunic: ["#48525f", "#3f4a4f", "#54565c", "#4a4340"],
    trouser: ["#3a3a3f", "#33353a"],
    belt: "#2e2620",
    boot: "#33291f",
    hat: ["#9aa0a6", "#8c9298", "#7d858c"],
    headwear: ["helm", "helm", "cap"],
    carry: ["spear", "spear", "none"],
    height: [1.7, 1.92],
    build: [0.5, 1],
  },
  farmer: {
    tunic: ["#b0a184", "#9a8c6e", "#87805f", "#a3906b"],
    trouser: ["#5a4c38", "#4a4130", "#63543c"],
    belt: "#3f2f1f",
    boot: "#3a2b1c",
    hat: ["#c9ab5f", "#b89a52", "#d4b96c"],
    headwear: ["straw", "straw", "kerchief", "none"],
    carry: ["none", "basket", "staff"],
    height: [1.62, 1.86],
    build: [0.3, 0.9],
  },
  child: {
    tunic: ["#a86b3f", "#5b8c4a", "#4a6b9a", "#b5854a", "#8c5a7a"],
    trouser: ["#5a4c3a", "#46503a", "#4a4450"],
    belt: "#4a3a28",
    boot: "#42301f",
    hat: ["#8a6a3f", "#5a7a4a"],
    headwear: ["none", "none", "none", "cap"],
    carry: ["none"],
    height: [0.98, 1.32],
    build: [0.05, 0.4],
  },
  monk: {
    tunic: ["#4a3a28", "#2e2721", "#5c4a33", "#3f3a35"],
    trouser: ["#4a3a28", "#2e2721", "#5c4a33"],
    belt: "#c9b478",
    boot: "#332720",
    hat: ["#4a3a28", "#2e2721", "#5c4a33"],
    headwear: ["cowl", "cowl", "hood", "none"],
    carry: ["staff", "none", "none"],
    height: [1.6, 1.84],
    build: [0.2, 0.8],
  },
  hunter: {
    tunic: ["#3f4a33", "#4a4632", "#33402e", "#54492f"],
    trouser: ["#3a3527", "#443c2c"],
    belt: "#3a2a19",
    boot: "#33261a",
    hat: ["#36402c", "#42452f"],
    headwear: ["hood", "hood", "cap", "none"],
    carry: ["spear", "pack", "staff"],
    height: [1.65, 1.88],
    build: [0.25, 0.75],
  },
  fisher: {
    tunic: ["#3f5a6b", "#4a6270", "#54606b", "#5f6a5a"],
    trouser: ["#3a4450", "#414a42"],
    belt: "#3a3228",
    boot: "#2e3a3f",
    hat: ["#4a5a63", "#556069"],
    headwear: ["kerchief", "cap", "none"],
    carry: ["basket", "none", "pack"],
    height: [1.62, 1.86],
    build: [0.3, 0.9],
  },
};

const DEFAULT_STYLE = STYLES.villager;

/** Everything about how one NPC looks, derived from its palette index alone. */
export type HumanoidLook = {
  palette: HumanoidPalette;
  headwear: Headwear;
  carry: Carry;
  height: number;
  build: number;
  child: boolean;
};

/**
 * Everything about a body derives from `NpcSpawn.palette` and its kind, so one
 * small integer in the world data reproduces a person exactly — which is what
 * lets the spawn table stay serialisable while the appearance stays rich.
 */
export function humanoidLook(kind: NpcKind, index: number): HumanoidLook {
  const style = STYLES[kind] ?? DEFAULT_STYLE;
  const seed = index * 2654435761 + kindSalt(kind);

  const heightSpan = style.height[1] - style.height[0];
  const buildSpan = style.build[1] - style.build[0];

  return {
    palette: {
      skin: pick(SKIN, seed, 11),
      hair: pick(HAIR, seed, 23),
      tunic: pick(style.tunic, seed, 37),
      sleeve: pick(style.tunic, seed, 41),
      trouser: pick(style.trouser, seed, 53),
      belt: style.belt,
      boot: style.boot,
      hat: pick(style.hat, seed, 67),
    },
    headwear: pick(style.headwear, seed, 71),
    carry: pick(style.carry, seed, 83),
    height: style.height[0] + hash2(seed, 97) * heightSpan,
    build: style.build[0] + hash2(seed, 101) * buildSpan,
    child: kind === "child",
  };
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

export type HumanoidJoints = {
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  leftShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightShoulder: THREE.Group;
  rightElbow: THREE.Group;
  leftHip: THREE.Group;
  leftKnee: THREE.Group;
  leftFoot: THREE.Group;
  rightHip: THREE.Group;
  rightKnee: THREE.Group;
  rightFoot: THREE.Group;
};

export type Humanoid = {
  root: THREE.Group;
  parts: HumanoidJoints;
  /** Standing height, metres. */
  height: number;
  /** Hip pivot height in the rest pose — the baseline the walk bob returns to. */
  hipHeight: number;
  /** Half the shoulder width: collision radius and personal-space distance. */
  radius: number;
  /** Ground covered by one step at full stride. */
  strideLength: number;
  /** Peak vertical travel of the pelvis across a stride. */
  bob: number;
  /** Per-rig phase offset, so a crowd does not breathe in unison. */
  offset: number;
  setShadows(on: boolean): void;
  dispose(): void;
};

export type HumanoidOptions = {
  /** Any integer. Drives the small asymmetries a palette index does not cover. */
  seed: number;
  look: HumanoidLook;
  material: THREE.Material;
  /**
   * `simple` folds the forearms into the upper arms and the shins and boots
   * into the thighs: seven meshes instead of thirteen, at the cost of elbows
   * and knees that no longer bend. For the low quality tier and for anybody who
   * will never be seen from closer than fifty metres.
   */
  detail?: "full" | "simple";
};

export function buildHumanoid(options: HumanoidOptions): Humanoid {
  const { seed, look, material, detail = "full" } = options;
  const { palette, child } = look;

  const H = look.height;
  const bulk = look.build;
  const simple = detail === "simple";

  // Canonical landmarks as fractions of standing height. Seven and a half heads
  // for an adult, about five for a child — the child's head is the same size in
  // absolute terms as it is a couple of years from being, which is exactly why
  // scaling an adult down never works.
  const hipY = H * (child ? 0.455 : 0.53);
  const shoulderY = H * (child ? 0.76 : 0.805);
  const headBaseY = H * (child ? 0.8 : 0.868);
  const torso = shoulderY - hipY;
  const headHeight = H - headBaseY;

  const shoulderHalf = H * (child ? 0.084 : 0.098 + bulk * 0.014);
  const hipHalf = H * (child ? 0.042 : 0.046 + bulk * 0.008);
  const waistHalf = H * (child ? 0.06 : 0.068 + bulk * 0.02);

  const thighLen = hipY * 0.462;
  const shinLen = hipY * 0.438;
  const ankleY = hipY - thighLen - shinLen;
  const upperArmLen = H * (child ? 0.136 : 0.155);
  const forearmLen = H * (child ? 0.126 : 0.145);

  // One mass knob for every limb radius. Below about 0.85 a body reads as a
  // stick figure however good the proportions are.
  const girth = 0.86 + bulk * 0.34;
  const r = (fraction: number) => H * fraction * girth;

  const geometries: THREE.BufferGeometry[] = [];
  const meshes: THREE.Mesh[] = [];

  const root = new THREE.Group();
  root.name = "npc";
  // Yaw first, then pitch and roll in the body's own frame, so a slope lean is
  // "lean forward" rather than "lean north" once the NPC turns a corner.
  root.rotation.order = "YXZ";

  function joint(name: string, x: number, y: number, z: number, parent: THREE.Object3D) {
    const group = new THREE.Group();
    group.name = name;
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  }

  function attach(parent: THREE.Object3D, geometry: THREE.BufferGeometry) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    // Every offset is baked into the geometry, so this local matrix is identity
    // for the life of the rig. One `updateMatrix` now instead of one per mesh
    // per frame, across every body in the valley.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
    meshes.push(mesh);
    geometries.push(geometry);
  }

  // --- Skeleton -----------------------------------------------------------

  const hips = joint("hips", 0, hipY, 0, root);
  const spine = joint("spine", 0, torso * 0.3, 0, hips);
  const chest = joint("chest", 0, torso * 0.4, 0, spine);
  const neck = joint("neck", 0, torso * 0.3, 0, chest);
  const head = joint("head", 0, headBaseY - shoulderY, 0, neck);

  // The shoulder joint sits a little below the acromion line, which is where
  // the arm actually pivots from.
  const shoulderLocalY = torso * 0.3 - H * 0.022;
  const splay = 0.1 + bulk * 0.05;

  const leftShoulder = joint("leftShoulder", shoulderHalf, shoulderLocalY, 0, chest);
  const rightShoulder = joint("rightShoulder", -shoulderHalf, shoulderLocalY, 0, chest);
  // The rest-pose splay is baked into the geometry, so the elbow has to hang
  // off the end of a *tilted* upper arm rather than straight below the
  // shoulder. Doing it this way keeps every animated channel at zero in the
  // rest pose, which is what lets the pose function assign rather than
  // accumulate.
  const splayX = Math.sin(splay) * upperArmLen;
  const splayY = -Math.cos(splay) * upperArmLen;
  const leftElbow = joint("leftElbow", splayX, splayY, 0, leftShoulder);
  const rightElbow = joint("rightElbow", -splayX, splayY, 0, rightShoulder);

  const leftHip = joint("leftHip", hipHalf, 0, 0, hips);
  const rightHip = joint("rightHip", -hipHalf, 0, 0, hips);
  const leftKnee = joint("leftKnee", 0, -thighLen, 0, leftHip);
  const rightKnee = joint("rightKnee", 0, -thighLen, 0, rightHip);
  const leftFoot = joint("leftFoot", 0, -shinLen, 0, leftKnee);
  const rightFoot = joint("rightFoot", 0, -shinLen, 0, rightKnee);

  // --- Pelvis -------------------------------------------------------------

  const pelvisTop = torso * 0.3;
  const pelvisBottom = -H * 0.05;
  const pelvisHeight = pelvisTop - pelvisBottom;
  // Widest at the hips, narrowing to the waist. `hipHalf` is the separation of
  // the leg joints, not the width of the body around them — the greater
  // trochanter stands well outside the socket, and a pelvis modelled at joint
  // width comes out as a tube with two legs under it.
  const pelvis = new THREE.CylinderGeometry(
    waistHalf * 0.94,
    hipHalf * 1.95,
    pelvisHeight,
    7,
    1,
    false
  );
  // Hips are wider than they are deep. Doing this by scaling the whole
  // primitive rather than by using two radii keeps the cross-section elliptical
  // all the way up instead of only at the ends.
  pelvis.scale(1, 1, 0.72);
  pelvis.translate(0, pelvisBottom + pelvisHeight * 0.5, 0);

  const pelvisParts = [paint(pelvis, palette.trouser)];

  const belt = new THREE.CylinderGeometry(
    waistHalf * 1.02,
    waistHalf * 1.02,
    H * 0.022,
    7,
    1,
    false
  );
  belt.scale(1, 1, 0.74);
  belt.translate(0, pelvisTop - H * 0.012, 0);
  pelvisParts.push(paint(belt, palette.belt));

  if (look.carry === "basket") {
    // Carried at the hip, on the side the free arm is not swinging.
    const basket = new THREE.CylinderGeometry(
      H * 0.062,
      H * 0.048,
      H * 0.075,
      7,
      1,
      true
    );
    basket.rotateZ(0.22);
    basket.translate(hipHalf * 2.1, pelvisTop * 0.2, H * 0.02);
    pelvisParts.push(paint(basket, "#8a6a3c"));
  }

  attach(hips, mergeParts(pelvisParts));

  // --- Torso --------------------------------------------------------------

  const torsoHeight = torso * 0.7;
  const ribcage = new THREE.CylinderGeometry(
    shoulderHalf * 0.94,
    waistHalf * 0.98,
    torsoHeight,
    7,
    1,
    false
  );
  ribcage.scale(1, 1, 0.66);
  ribcage.translate(0, -torso * 0.4 + torsoHeight * 0.5, 0);

  const torsoParts = [paint(ribcage, palette.tunic)];

  // Deltoid caps. Without them the arm sockets are two visible holes in the
  // silhouette the moment an arm swings forward.
  for (const side of [1, -1]) {
    const deltoid = blob(
      r(0.036),
      r(0.032),
      r(0.034),
      palette.sleeve,
      6,
      4
    );
    deltoid.translate(side * shoulderHalf, shoulderLocalY, 0);
    torsoParts.push(deltoid);
  }

  // The neck runs from inside the ribcage right up into the skull. It has to
  // overlap both ends: the head pivots at the base of the skull, so a stub that
  // merely reaches the pivot leaves a visible gap, and a gap under the chin
  // reads as a floating head from any angle at all.
  const neckStub = limb(r(0.026), r(0.032), H * 0.09, palette.skin, 6);
  neckStub.translate(0, torso * 0.3 + H * 0.075, 0);
  torsoParts.push(neckStub);

  if (look.carry === "pack") {
    const pack = box(H * 0.15, H * 0.16, H * 0.085, "#6b4d30");
    pack.translate(0, torso * 0.02, -shoulderHalf * 0.9);
    torsoParts.push(pack);
  } else if (look.carry === "spear" || look.carry === "staff") {
    // Slung across the back rather than gripped. A shaft held in the fist needs
    // wrist IK to stay in it, and a spear that visibly misses the hand is far
    // more distracting than one worn over the shoulder.
    const tilt = look.carry === "spear" ? 0.42 : -0.42;
    const shaftLength = H * 0.78;
    const backZ = -shoulderHalf * 0.78;
    const backY = torso * 0.05;

    const shaft = limb(H * 0.009, H * 0.009, shaftLength, "#6b5334", 5);
    // Centre it on the origin before tilting, so it pivots about its middle
    // rather than swinging its whole length out of the body.
    shaft.translate(0, shaftLength * 0.5, 0);
    shaft.rotateZ(tilt);
    shaft.translate(0, backY, backZ);
    torsoParts.push(shaft);

    if (look.carry === "spear") {
      const point = new THREE.ConeGeometry(H * 0.016, H * 0.075, 5, 1, false);
      point.rotateZ(tilt);
      point.translate(
        -Math.sin(tilt) * shaftLength * 0.5,
        backY + Math.cos(tilt) * shaftLength * 0.5,
        backZ
      );
      torsoParts.push(paint(point, "#a8adb4"));
    }
  }

  attach(chest, mergeParts(torsoParts));

  // --- Head ---------------------------------------------------------------

  const skullRx = headHeight * 0.36;
  const skullRy = headHeight * 0.5;
  const skullRz = headHeight * 0.42;
  const skullY = headHeight * 0.5;

  const skull = blob(skullRx, skullRy, skullRz, palette.skin, 8, 5);
  skull.translate(0, skullY, 0);
  const headParts = [skull];

  const nose = blob(headHeight * 0.05, headHeight * 0.06, headHeight * 0.07, palette.skin, 5, 3);
  nose.translate(0, skullY - headHeight * 0.03, skullRz * 0.92);
  headParts.push(nose);

  // Hair only where a hat will not cover it. A bowl of hair inside a helmet is
  // invisible geometry, and there are forty of these.
  const covered = look.headwear === "helm" || look.headwear === "hood" || look.headwear === "cowl";
  if (!covered) {
    const hair = cap(skullRx * 1.05, skullRy * 1.04, skullRz * 1.05, 0.62, palette.hair);
    hair.translate(0, skullY, 0);
    headParts.push(hair);
    if (hash2(seed, 313) < 0.35) {
      // A knot at the back, so not every head is the same silhouette from
      // behind — which is the angle a follow camera sees most.
      const knot = blob(headHeight * 0.13, headHeight * 0.13, headHeight * 0.11, palette.hair, 6, 4);
      knot.translate(0, skullY + headHeight * 0.08, -skullRz * 1.02);
      headParts.push(knot);
    }
  }

  if (!child && hash2(seed, 419) < 0.32) {
    const beard = blob(skullRx * 0.82, headHeight * 0.2, skullRz * 0.78, palette.hair, 6, 4);
    beard.translate(0, headHeight * 0.16, skullRz * 0.22);
    headParts.push(beard);
  }

  const hat = headwearGeometry(look.headwear, skullRx, skullRy, skullRz, skullY, palette);
  if (hat) headParts.push(hat);

  attach(head, mergeParts(headParts));

  // --- Arms ---------------------------------------------------------------

  const sleeveLong = hash2(seed, 521) < 0.62;
  const forearmColor = sleeveLong ? palette.sleeve : palette.skin;

  for (const side of [1, -1]) {
    const shoulder = side > 0 ? leftShoulder : rightShoulder;
    const elbow = side > 0 ? leftElbow : rightElbow;

    const upper = limb(r(0.032), r(0.026), upperArmLen, palette.sleeve);
    upper.rotateZ(side * splay);

    // A dead-straight arm reads as a mannequin, so the rest pose carries a
    // little flexion — baked in, again, so the animated channels start at zero.
    const foreParts: THREE.BufferGeometry[] = [
      limb(r(0.027), r(0.019), forearmLen, forearmColor),
    ];
    const hand = blob(r(0.026), r(0.033), r(0.02), palette.skin, 5, 4);
    hand.translate(0, -forearmLen - H * 0.018, 0);
    foreParts.push(hand);
    const forearm = mergeParts(foreParts);
    forearm.rotateX(-0.16);

    if (simple) {
      // The elbow joint carries no rotation of its own — the splay lives in the
      // upper arm's geometry — so folding the forearm up into the shoulder is a
      // pure translation by where the elbow sits.
      forearm.translate(splayX * side, splayY, 0);
      attach(shoulder, mergeParts([upper, forearm]));
    } else {
      attach(shoulder, upper);
      attach(elbow, forearm);
    }
  }

  // --- Legs ---------------------------------------------------------------

  const footLength = H * 0.15;
  const footWidth = H * 0.055;

  for (const side of [1, -1]) {
    const hip = side > 0 ? leftHip : rightHip;
    const knee = side > 0 ? leftKnee : rightKnee;
    const foot = side > 0 ? leftFoot : rightFoot;

    const thigh = limb(r(0.046), r(0.034), thighLen, palette.trouser);
    const shin = limb(r(0.033), r(0.022), shinLen, palette.trouser);
    const boot = box(footWidth, ankleY * 1.15, footLength, palette.boot);
    boot.translate(0, -ankleY * 0.5, footLength * 0.2);

    if (simple) {
      shin.translate(0, -thighLen, 0);
      boot.translate(0, -thighLen - shinLen, 0);
      attach(hip, mergeParts([thigh, shin, boot]));
    } else {
      attach(hip, thigh);
      attach(knee, shin);
      attach(foot, boot);
    }
  }

  // --- Rest pose ----------------------------------------------------------

  const parts: HumanoidJoints = {
    hips,
    spine,
    chest,
    neck,
    head,
    leftShoulder,
    leftElbow,
    rightShoulder,
    rightElbow,
    leftHip,
    leftKnee,
    leftFoot,
    rightHip,
    rightKnee,
    rightFoot,
  };

  let shadows = false;

  return {
    root,
    parts,
    height: H,
    hipHeight: hipY,
    // A body's personal space is a little wider than its shoulders — people
    // stop before they touch.
    radius: shoulderHalf * 1.25,
    // Step length as a fraction of leg length. Real walking is nearer 0.75, but
    // an NPC ambling at a metre a second is not walking at cadence.
    strideLength: hipY * 0.62,
    bob: H * 0.026,
    offset: hash2(seed, 977) * TAU,
    setShadows(on: boolean) {
      if (on === shadows) return;
      shadows = on;
      for (const mesh of meshes) mesh.castShadow = on;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      meshes.length = 0;
      root.clear();
    },
  };
}

function headwearGeometry(
  kind: Headwear,
  rx: number,
  ry: number,
  rz: number,
  centreY: number,
  palette: HumanoidPalette
): THREE.BufferGeometry | null {
  switch (kind) {
    case "none":
      return null;

    case "cap": {
      const crown = cap(rx * 1.08, ry * 1.02, rz * 1.08, 0.52, palette.hat);
      crown.translate(0, centreY, 0);
      const brim = new THREE.CylinderGeometry(rx * 1.0, rx * 1.0, ry * 0.09, 8, 1, false);
      brim.scale(1, 1, 0.7);
      brim.translate(0, centreY + ry * 0.12, rz * 0.72);
      return mergeParts([crown, paint(brim, palette.hat, 0.82)]);
    }

    case "kerchief": {
      const cloth = cap(rx * 1.06, ry * 1.0, rz * 1.06, 0.6, palette.hat);
      cloth.translate(0, centreY, 0);
      const knot = blob(rx * 0.24, ry * 0.18, rz * 0.24, palette.hat, 5, 3);
      knot.translate(0, centreY + ry * 0.2, -rz * 1.02);
      return mergeParts([cloth, knot]);
    }

    case "straw": {
      // Wide enough to throw the whole face into shade, which is the entire
      // point of a field hat and reads instantly at distance.
      const brim = new THREE.ConeGeometry(rx * 2.5, ry * 0.7, 9, 1, true);
      brim.translate(0, centreY + ry * 0.95, 0);
      const crown = cap(rx * 1.05, ry * 0.6, rz * 1.05, 0.5, palette.hat);
      crown.translate(0, centreY + ry * 0.85, 0);
      return mergeParts([paint(brim, palette.hat), crown]);
    }

    case "helm": {
      const dome = cap(rx * 1.12, ry * 1.05, rz * 1.12, 0.62, palette.hat);
      dome.translate(0, centreY, 0);
      const nasal = box(rx * 0.16, ry * 0.72, rz * 0.16, palette.hat);
      nasal.translate(0, centreY + ry * 0.1, rz * 1.02);
      return mergeParts([dome, nasal]);
    }

    case "hood":
    case "cowl": {
      const sweep = kind === "hood" ? 0.86 : 0.74;
      const scale = kind === "hood" ? 1.2 : 1.1;
      const hood = cap(rx * scale, ry * scale, rz * scale, sweep, palette.hat);
      hood.translate(0, centreY, 0);
      // The peak. A hood without one is a swimming cap.
      const peak = blob(rx * 0.4, ry * 0.34, rz * 0.5, palette.hat, 5, 4);
      peak.translate(0, centreY + ry * 0.62, -rz * 0.5);
      return mergeParts([hood, peak]);
    }
  }
}

// ---------------------------------------------------------------------------
// Posing
// ---------------------------------------------------------------------------

export type HumanoidPose = {
  /** Walk cycle phase in radians. One full cycle is two steps. */
  phase: number;
  /** 0 standing, 1 walking at the NPC's normal pace. Scales stride and posture. */
  stride: number;
  /** Seconds. Drives breathing and idle drift; add the rig's own offset. */
  time: number;
  /** Head yaw in radians, for looking around. */
  look: number;
  /** Forward lean in radians. Uphill and hurrying both add to this. */
  lean: number;
};

/**
 * How far the knee is bent at a given phase.
 *
 * Knees flex one way only, and almost all of the flexion happens in the swing
 * phase just after toe-off — a leg that bends symmetrically through the cycle
 * reads as wading. The peak lands about 0.7 radians of phase after maximum
 * backward extension, which is where the heel actually comes up.
 */
function kneeBend(phase: number): number {
  const swing = Math.sin(phase - 0.7);
  return swing > 0 ? swing * 1.15 : 0;
}

/**
 * Writes a complete pose onto a rig.
 *
 * Every animated channel is *assigned*, never accumulated: the rest pose has
 * all of them at zero (splay and elbow flexion are baked into the geometry), so
 * a frame that skips a channel is a frame that leaves it exactly where the
 * previous one put it, rather than one that drifts.
 */
export function poseHumanoid(rig: Humanoid, pose: HumanoidPose): void {
  const p = rig.parts;
  const stride = pose.stride;
  const phase = pose.phase;
  const time = pose.time + rig.offset;

  // Idle behaviour fades out the moment there is any real movement — a breath
  // cycle layered over a walk reads as a limp.
  const idle = 1 - Math.min(1, stride * 2.6);
  const swing = Math.sin(phase);

  // --- Legs ---------------------------------------------------------------

  const hipSwing = swing * 0.62 * stride;
  const kneeL = kneeBend(phase) * stride + 0.06;
  const kneeR = kneeBend(phase + Math.PI) * stride + 0.06;

  p.leftHip.rotation.x = hipSwing;
  p.rightHip.rotation.x = -hipSwing;
  p.leftKnee.rotation.x = kneeL;
  p.rightKnee.rotation.x = kneeR;
  // Ankles partly cancel the thigh and shin so the sole stays near horizontal
  // through stance. Fully cancelling looks robotic; 0.72 leaves a toe-off.
  p.leftFoot.rotation.x = -(hipSwing + kneeL) * 0.72;
  p.rightFoot.rotation.x = -(-hipSwing + kneeR) * 0.72;

  // --- Arms ---------------------------------------------------------------

  // Contralateral: the left arm goes forward with the right leg. Arms swing
  // roughly three-quarters as far as legs, and the elbow closes on the
  // forward swing.
  const armSwing = -swing * 0.46 * stride;
  const idleArm = Math.sin(time * 0.73) * 0.028 * idle;

  p.leftShoulder.rotation.x = armSwing + idleArm;
  p.rightShoulder.rotation.x = -armSwing + idleArm;
  p.leftElbow.rotation.x = -Math.max(0, -armSwing) * 0.9 - 0.08 * stride;
  p.rightElbow.rotation.x = -Math.max(0, armSwing) * 0.9 - 0.08 * stride;

  // --- Spine --------------------------------------------------------------

  // Pelvis and shoulders counter-rotate. This is the single cheapest thing that
  // separates a walk from two legs on a sliding box.
  p.hips.rotation.y = swing * 0.1 * stride;
  p.chest.rotation.y = -swing * 0.16 * stride;

  const shift = Math.sin(time * 0.41) * idle;
  p.hips.rotation.z = swing * 0.045 * stride + shift * 0.035;
  p.hips.position.x = shift * rig.height * 0.007;

  // The pelvis is highest at mid-stance and lowest at double support, twice per
  // cycle. Without this the whole body glides at a constant altitude.
  p.hips.position.y =
    rig.hipHeight + (Math.cos(phase * 2) * 0.5 - 0.5) * rig.bob * stride;

  const breath = Math.sin(time * 1.15) * 0.018 * idle;
  p.spine.rotation.x = pose.lean * 0.55 + breath * 0.5;
  p.chest.rotation.x = pose.lean * 0.25 - breath;

  // --- Head ---------------------------------------------------------------

  p.neck.rotation.x = pose.lean * 0.2;
  // Counter the lean so he keeps looking where he is going, and let the head
  // bob a touch against the stride.
  p.head.rotation.x =
    -pose.lean * 0.75 - Math.sin(phase * 2) * 0.022 * stride + breath * 0.4;
  p.head.rotation.y = pose.look;
  p.head.rotation.z = -swing * 0.02 * stride;
}

/**
 * A relaxed standing pose, written once when an NPC leaves animation range.
 *
 * Freezing whatever pose the last animated frame happened to leave behind is
 * cheaper still, but at fifty metres a body caught mid-stride and then held
 * there forever is the one thing that reads as broken rather than as distant.
 */
export function restHumanoid(rig: Humanoid): void {
  const p = rig.parts;
  p.leftHip.rotation.x = 0.04;
  p.rightHip.rotation.x = -0.04;
  p.leftKnee.rotation.x = 0.06;
  p.rightKnee.rotation.x = 0.06;
  p.leftFoot.rotation.x = -0.05;
  p.rightFoot.rotation.x = -0.05;
  p.leftShoulder.rotation.x = 0;
  p.rightShoulder.rotation.x = 0;
  p.leftElbow.rotation.x = 0;
  p.rightElbow.rotation.x = 0;
  p.hips.rotation.set(0, 0, 0);
  p.hips.position.set(0, rig.hipHeight, 0);
  p.spine.rotation.x = 0;
  p.chest.rotation.set(0, 0, 0);
  p.neck.rotation.x = 0;
  p.head.rotation.set(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Animals
// ---------------------------------------------------------------------------

export type AnimalKind = "sheep" | "cow" | "goat" | "deer" | "chicken";

/**
 * An animal comes back as two geometries rather than a rig.
 *
 * Sixty-odd grazing animals cannot each be a scene graph — but a body and a
 * head are enough articulation for everything they actually do (walk, stop,
 * put their head down, lift it and look at you), and two geometries means two
 * `InstancedMesh`es per species and therefore ten draw calls for every animal
 * in the valley. Legs do not articulate; at the distance livestock are seen
 * from, a bob and a roll on the body sells the gait and nobody counts hooves.
 */
export type AnimalModel = {
  body: THREE.BufferGeometry;
  /** Neck and head together, built around a pivot at the neck's base. */
  head: THREE.BufferGeometry;
  /** That pivot, in body-local space. The body origin sits on the ground. */
  headOffset: THREE.Vector3;
  /** Nose to tail, metres. */
  length: number;
  /** Height at the withers, metres. */
  shoulderHeight: number;
  /** Collision and separation radius. */
  radius: number;
  /** Rotation about X that puts the muzzle in the grass. */
  grazeAngle: number;
};

type AnimalSpec = {
  legHeight: number;
  bodyRx: number;
  bodyRy: number;
  bodyRz: number;
  legRadius: number;
  hide: string;
  belly: string;
  leg: string;
  horn: string;
  /** Where the neck leaves the barrel, in body radii above the barrel centre. */
  neckBase: number;
  neckLength: number;
  /** Neck pitch above horizontal at rest, radians. */
  neckPitch: number;
  headScale: number;
  ears: "flop" | "up" | "none";
  horns: "none" | "goat" | "cow" | "antler";
  tail: "wool" | "switch" | "scut" | "none";
};

const ANIMALS: Record<AnimalKind, AnimalSpec> = {
  sheep: {
    legHeight: 0.34,
    bodyRx: 0.24,
    bodyRy: 0.25,
    bodyRz: 0.4,
    legRadius: 0.035,
    hide: "#ddd6c4",
    belly: "#cfc7b3",
    leg: "#4a4038",
    horn: "#b8ab8a",
    neckBase: 0.05,
    neckLength: 0.28,
    neckPitch: 0.35,
    headScale: 0.5,
    ears: "flop",
    horns: "none",
    tail: "wool",
  },
  cow: {
    legHeight: 0.72,
    bodyRx: 0.33,
    bodyRy: 0.38,
    bodyRz: 0.78,
    legRadius: 0.055,
    hide: "#7a5540",
    belly: "#e6ded0",
    leg: "#3f342c",
    horn: "#cfc2a2",
    neckBase: 0.25,
    neckLength: 0.5,
    neckPitch: 0.18,
    headScale: 0.6,
    ears: "flop",
    horns: "cow",
    tail: "switch",
  },
  goat: {
    legHeight: 0.4,
    bodyRx: 0.17,
    bodyRy: 0.2,
    bodyRz: 0.34,
    legRadius: 0.03,
    hide: "#8a7b60",
    belly: "#a8996f",
    leg: "#3a332a",
    horn: "#b0a482",
    neckBase: 0,
    neckLength: 0.3,
    neckPitch: 0.5,
    headScale: 0.42,
    ears: "flop",
    horns: "goat",
    tail: "scut",
  },
  deer: {
    legHeight: 0.62,
    bodyRx: 0.19,
    bodyRy: 0.24,
    bodyRz: 0.5,
    legRadius: 0.03,
    hide: "#8a6440",
    belly: "#d8c5a8",
    leg: "#4f3a26",
    horn: "#9b8664",
    neckBase: 0.2,
    neckLength: 0.55,
    neckPitch: 0.85,
    headScale: 0.44,
    ears: "up",
    horns: "antler",
    tail: "scut",
  },
  chicken: {
    legHeight: 0.11,
    bodyRx: 0.09,
    bodyRy: 0.1,
    bodyRz: 0.13,
    legRadius: 0.012,
    hide: "#c9a15c",
    belly: "#e0c896",
    leg: "#c98a3a",
    horn: "#c4402f",
    neckBase: 0.55,
    neckLength: 0.11,
    neckPitch: 1.15,
    headScale: 0.34,
    ears: "none",
    horns: "none",
    tail: "none",
  },
};

export function buildAnimal(kind: AnimalKind): AnimalModel {
  const spec = ANIMALS[kind];
  const bodyY = spec.legHeight + spec.bodyRy;

  const parts: THREE.BufferGeometry[] = [];

  const barrel = blob(spec.bodyRx, spec.bodyRy, spec.bodyRz, spec.hide, 8, 6);
  barrel.translate(0, bodyY, 0);
  parts.push(barrel);

  // A lighter underside. Countershading is the one piece of animal colouring
  // that reads at any distance, and it is what stops a sheep from looking like
  // a painted egg.
  const under = blob(
    spec.bodyRx * 0.86,
    spec.bodyRy * 0.6,
    spec.bodyRz * 0.9,
    spec.belly,
    7,
    4
  );
  under.translate(0, bodyY - spec.bodyRy * 0.42, 0);
  parts.push(under);

  const legZ = spec.bodyRz * 0.62;
  const legX = spec.bodyRx * 0.72;
  const legPositions: Array<[number, number]> =
    kind === "chicken"
      ? [
          [legX * 0.7, 0],
          [-legX * 0.7, 0],
        ]
      : [
          [legX, legZ],
          [-legX, legZ],
          [legX, -legZ],
          [-legX, -legZ],
        ];

  for (const [x, z] of legPositions) {
    const leg = limb(
      spec.legRadius,
      spec.legRadius * 0.78,
      spec.legHeight + spec.bodyRy * 0.5,
      spec.leg,
      5
    );
    leg.translate(x, spec.legHeight + spec.bodyRy * 0.5, z);
    parts.push(leg);
  }

  if (spec.tail === "wool") {
    const tail = blob(spec.bodyRx * 0.3, spec.bodyRx * 0.32, spec.bodyRx * 0.26, spec.hide, 5, 4);
    tail.translate(0, bodyY + spec.bodyRy * 0.3, -spec.bodyRz * 1.02);
    parts.push(tail);
  } else if (spec.tail === "switch") {
    const tail = limb(spec.legRadius * 0.5, spec.legRadius * 0.3, spec.bodyRy * 1.5, spec.leg, 4);
    tail.translate(0, bodyY + spec.bodyRy * 0.7, -spec.bodyRz * 1.0);
    parts.push(tail);
  } else if (spec.tail === "scut") {
    const tail = blob(spec.bodyRx * 0.22, spec.bodyRx * 0.3, spec.bodyRx * 0.18, spec.belly, 5, 3);
    tail.translate(0, bodyY + spec.bodyRy * 0.5, -spec.bodyRz * 1.02);
    parts.push(tail);
  }

  // --- Neck and head ------------------------------------------------------

  // The neck belongs to the *head* instance, not the body.
  //
  // Put it on the body and the head can only ever pivot at the skull, which
  // gets a cow's muzzle no closer to the grass than its own chest — the animal
  // ends up nodding at the horizon instead of grazing. Hanging the whole
  // neck-and-head assembly off a pivot at the shoulders costs nothing extra
  // (it is still one instanced draw) and lets the head swing all the way down.
  const pitch = spec.neckPitch;
  const neckLength = spec.neckLength;
  // The pivot sits at the *front* of the barrel, not its centre: a neck rooted
  // amidships swings straight through the animal's own ribs on the way down to
  // the grass.
  const headOffset = new THREE.Vector3(
    0,
    bodyY + spec.bodyRy * spec.neckBase,
    spec.bodyRz * 0.9
  );

  const hs = spec.headScale;
  const headParts: THREE.BufferGeometry[] = [];

  // `limb` hangs down; a quarter turn plus the pitch swings it out along
  // (0, sin p, cos p), i.e. forward and up out of the shoulders.
  const neck = limb(
    spec.bodyRx * 0.5,
    spec.bodyRx * 0.38,
    neckLength * 1.12,
    spec.hide,
    6
  );
  neck.rotateX(-(Math.PI / 2 + pitch));
  headParts.push(neck);

  const skullY = Math.sin(pitch) * neckLength;
  const skullZ = Math.cos(pitch) * neckLength;

  const skull = blob(spec.bodyRx * hs, spec.bodyRx * hs * 1.05, spec.bodyRz * hs * 0.9, spec.hide, 6, 5);
  skull.translate(0, skullY, skullZ);
  headParts.push(skull);

  const muzzle = blob(
    spec.bodyRx * hs * 0.6,
    spec.bodyRx * hs * 0.62,
    spec.bodyRz * hs * 0.6,
    kind === "chicken" ? spec.horn : spec.belly,
    5,
    4
  );
  muzzle.translate(0, skullY - spec.bodyRx * hs * 0.3, skullZ + spec.bodyRz * hs);
  headParts.push(muzzle);

  if (spec.ears !== "none") {
    for (const side of [1, -1]) {
      const ear = blob(
        spec.bodyRx * hs * 0.18,
        spec.bodyRx * hs * (spec.ears === "up" ? 0.55 : 0.3),
        spec.bodyRz * hs * (spec.ears === "up" ? 0.3 : 0.45),
        spec.hide,
        4,
        3
      );
      ear.translate(
        side * spec.bodyRx * hs * 0.95,
        skullY + spec.bodyRx * hs * (spec.ears === "up" ? 0.75 : 0.2),
        skullZ - spec.bodyRz * hs * 0.1
      );
      headParts.push(ear);
    }
  }

  if (spec.horns === "goat" || spec.horns === "cow") {
    for (const side of [1, -1]) {
      const horn = new THREE.ConeGeometry(
        spec.bodyRx * hs * 0.16,
        spec.bodyRx * hs * (spec.horns === "goat" ? 1.9 : 1.1),
        5,
        1,
        false
      );
      horn.rotateZ(side * (spec.horns === "goat" ? 0.3 : 0.9));
      horn.rotateX(spec.horns === "goat" ? 0.8 : 0);
      horn.translate(
        side * spec.bodyRx * hs * 0.55,
        skullY + spec.bodyRx * hs * 1.1,
        skullZ - spec.bodyRz * hs * 0.2
      );
      headParts.push(paint(horn, spec.horn));
    }
  } else if (spec.horns === "antler") {
    // Three tines a side, which is the fewest that still reads as antler
    // rather than as two sticks.
    for (const side of [1, -1]) {
      const beam = limb(
        spec.bodyRx * hs * 0.1,
        spec.bodyRx * hs * 0.05,
        spec.bodyRx * hs * 2.2,
        spec.horn,
        4
      );
      beam.rotateX(Math.PI);
      beam.rotateZ(side * 0.42);
      beam.translate(
        side * spec.bodyRx * hs * 0.5,
        skullY + spec.bodyRx * hs * 0.95,
        skullZ
      );
      headParts.push(beam);
      for (let i = 0; i < 2; i++) {
        const tine = limb(
          spec.bodyRx * hs * 0.06,
          spec.bodyRx * hs * 0.03,
          spec.bodyRx * hs * 0.85,
          spec.horn,
          4
        );
        // Past half a turn, so the tine comes up and *forward* off the beam.
        // Short of it and every tine rakes backwards, which is a moose.
        tine.rotateX(Math.PI * 1.22);
        tine.rotateZ(side * 0.9);
        tine.translate(
          side * spec.bodyRx * hs * (0.85 + i * 0.35),
          skullY + spec.bodyRx * hs * (1.6 + i * 0.6),
          skullZ + spec.bodyRz * hs * (0.1 + i * 0.25)
        );
        headParts.push(tine);
      }
    }
  }

  if (kind === "chicken") {
    const comb = blob(spec.bodyRx * hs * 0.1, spec.bodyRx * hs * 0.4, spec.bodyRz * hs * 0.5, spec.horn, 4, 3);
    comb.translate(0, skullY + spec.bodyRx * hs * 1.05, skullZ + spec.bodyRz * hs * 0.1);
    headParts.push(comb);
  }

  // Reach from the neck pivot to the tip of the muzzle. The graze angle is
  // solved from it rather than authored, so a cow and a chicken both actually
  // touch the grass instead of stopping somewhere near it.
  const reach = Math.hypot(skullY, skullZ + spec.bodyRz * hs * 1.5);
  const restPitch = Math.atan2(skullY, skullZ + spec.bodyRz * hs * 1.5);
  const downPitch = Math.asin(Math.max(-1, -headOffset.y / Math.max(reach, 1e-3)));

  return {
    body: mergeParts(parts),
    head: mergeParts(headParts),
    headOffset,
    length: spec.bodyRz * 2.4,
    shoulderHeight: bodyY + spec.bodyRy,
    radius: Math.max(spec.bodyRx, spec.bodyRz) * 0.85,
    // Positive rotation about X swings the neck down: rotating (0, sin p,
    // cos p) by theta leaves it at pitch p - theta, so the angle wanted is the
    // difference between the rest pitch and the pitch that reaches the ground.
    grazeAngle: restPitch - downPitch,
  };
}

/**
 * Per-instance tint for an animal.
 *
 * Multiplied against the baked vertex colours by the instanced-colour path, so
 * a darker tint darkens the fleece and the hooves together instead of flooding
 * the whole animal one colour and losing the countershading.
 */
export function animalTint(kind: AnimalKind, index: number, target: THREE.Color): THREE.Color {
  const seed = index * 40503 + kindSalt(kind);
  switch (kind) {
    case "sheep": {
      // Mostly off-white with the occasional black-faced one.
      const dark = hash2(seed, 7) < 0.16;
      const shade = dark ? 0.42 : 0.9 + hash2(seed, 13) * 0.12;
      return target.setRGB(shade, shade * 0.99, shade * 0.95);
    }
    case "cow": {
      const roan = hash2(seed, 17);
      if (roan < 0.25) return target.setRGB(0.35, 0.33, 0.32);
      if (roan < 0.5) return target.setRGB(1.15, 1.05, 0.95);
      return target.setRGB(0.8 + roan * 0.5, 0.72 + roan * 0.35, 0.66 + roan * 0.3);
    }
    case "goat": {
      const shade = 0.6 + hash2(seed, 19) * 0.7;
      return target.setRGB(shade, shade * 0.95, shade * 0.86);
    }
    case "deer": {
      const shade = 0.86 + hash2(seed, 23) * 0.3;
      return target.setRGB(shade, shade * 0.94, shade * 0.86);
    }
    default: {
      const warm = hash2(seed, 29);
      return target.setRGB(0.75 + warm * 0.6, 0.7 + warm * 0.45, 0.62 + warm * 0.4);
    }
  }
}

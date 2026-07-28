/**
 * Builds Punaab: a hooded, cloaked traveling bard.
 *
 * Pure three.js — no React, no JSX, no loaders. That is deliberate. The same
 * function feeds the hero scene *and* the GLTFExporter that produces the
 * downloadable .glb for Godot / Unity / Unreal / web, so there is exactly one
 * definition of what the character looks like.
 *
 * Everything is built at real-world scale: 1 unit = 1 metre, and he stands
 * 1.80m with his feet on y = 0. Engines that assume metres (all of the above)
 * import him at the correct size with no rescaling.
 *
 * On the design: he is *mostly silhouette*. A deep hood, a heavy cloak, and a
 * face lost in shadow read as a real figure far more convincingly than an
 * attempt at a sculpted face would, and the mystery is the character.
 */

import * as THREE from "three";

export type BardPalette = {
  cloak: string;
  cloakLining: string;
  hood: string;
  leather: string;
  cloth: string;
  skin: string;
  wood: string;
  woodDark: string;
  metal: string;
  eyes: string;
};

export const DEFAULT_PALETTE: BardPalette = {
  cloak: "#2a2a3d",
  // Deep oxblood. The obvious "mysterious" choice is purple, but under a warm
  // low sun a purple lining lifts to bright magenta and reads as costume
  // rather than as a well-travelled coat.
  cloakLining: "#4a2226",
  hood: "#23233a",
  leather: "#4a3527",
  cloth: "#5a4a3a",
  skin: "#c99b74",
  wood: "#8a5a32",
  woodDark: "#4a2f1c",
  metal: "#b9a06a",
  eyes: "#7fd4c8",
};

export type BardParts = {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  hood: THREE.Group;
  armLeft: { upper: THREE.Group; lower: THREE.Group; hand: THREE.Group };
  armRight: { upper: THREE.Group; lower: THREE.Group; hand: THREE.Group };
  legLeft: { upper: THREE.Group; lower: THREE.Group; foot: THREE.Group };
  legRight: { upper: THREE.Group; lower: THREE.Group; foot: THREE.Group };
  lute: THREE.Group;
  eyes: THREE.Mesh;
  /** Advances the cloth simulation. `speed` is the bard's ground speed. */
  updateCloak: (time: number, speed: number, turnRate: number) => void;
  dispose: () => void;
};

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

function makeMaterials(palette: BardPalette) {
  // Heavy travel wool. Sheen is what stops cloth reading as painted plastic:
  // real fabric scatters a soft rim of light at grazing angles.
  const cloak = new THREE.MeshPhysicalMaterial({
    color: palette.cloak,
    roughness: 0.94,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.75,
    sheenColor: new THREE.Color("#6f7fa8"),
    side: THREE.DoubleSide,
    flatShading: false,
  });

  const lining = new THREE.MeshPhysicalMaterial({
    color: palette.cloakLining,
    roughness: 0.9,
    metalness: 0,
    sheen: 0.45,
    sheenColor: new THREE.Color("#a8705a"),
    side: THREE.DoubleSide,
  });

  const hood = new THREE.MeshPhysicalMaterial({
    color: palette.hood,
    roughness: 0.95,
    metalness: 0,
    sheen: 0.9,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color("#5d6b96"),
    side: THREE.DoubleSide,
  });

  const leather = new THREE.MeshPhysicalMaterial({
    color: palette.leather,
    roughness: 0.62,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.7,
  });

  const cloth = new THREE.MeshStandardMaterial({
    color: palette.cloth,
    roughness: 0.9,
    metalness: 0,
  });

  // Skin gets a little transmission so fingertips and knuckles catch light
  // the way real skin does instead of looking like painted wood.
  const skin = new THREE.MeshPhysicalMaterial({
    color: palette.skin,
    roughness: 0.68,
    metalness: 0,
    sheen: 0.3,
    sheenColor: new THREE.Color("#e8a882"),
  });

  // Lacquered instrument wood: smooth, with a clearcoat for the varnish.
  const wood = new THREE.MeshPhysicalMaterial({
    color: palette.wood,
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.18,
  });

  const woodDark = new THREE.MeshPhysicalMaterial({
    color: palette.woodDark,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.6,
  });

  const metal = new THREE.MeshStandardMaterial({
    color: palette.metal,
    roughness: 0.34,
    metalness: 0.9,
  });

  // The inside of the hood. Near-black so the face genuinely disappears.
  const shadow = new THREE.MeshBasicMaterial({ color: "#05060b" });

  const eyes = new THREE.MeshBasicMaterial({
    color: palette.eyes,
    transparent: true,
    opacity: 0.85,
  });

  const string = new THREE.MeshStandardMaterial({
    color: "#e8dfc8",
    roughness: 0.3,
    metalness: 0.4,
  });

  return {
    cloak,
    lining,
    hood,
    leather,
    cloth,
    skin,
    wood,
    woodDark,
    metal,
    shadow,
    eyes,
    string,
  };
}

type Materials = ReturnType<typeof makeMaterials>;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string
) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function group(name: string, position?: [number, number, number]) {
  const g = new THREE.Group();
  g.name = name;
  if (position) g.position.set(...position);
  return g;
}

/**
 * A tapered limb. Real arms and legs are not cylinders — they swell at the
 * muscle belly and narrow at the joint — so the profile is lathed from a
 * curve rather than extruded straight.
 */
function limbGeometry(
  topRadius: number,
  midRadius: number,
  bottomRadius: number,
  length: number
) {
  const points: THREE.Vector2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Quadratic through top -> mid -> bottom.
    const radius =
      (1 - t) * (1 - t) * topRadius +
      2 * (1 - t) * t * midRadius +
      t * t * bottomRadius;
    points.push(new THREE.Vector2(radius, -t * length));
  }
  const geometry = new THREE.LatheGeometry(points, 14);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// The cloak — a simulated cloth surface
// ---------------------------------------------------------------------------

type CloakRig = {
  mesh: THREE.Mesh;
  update: (time: number, speed: number, turnRate: number) => void;
};

/**
 * Builds the cloak as a parametric surface and animates it on the CPU.
 *
 * The surface is swept around the body but stops short of the front, leaving
 * the opening a real cloak has. Radius grows toward the hem so it flares, and
 * a sine term around the sweep carves in vertical folds that deepen as they
 * fall — which is how gravity actually drapes heavy fabric.
 *
 * Per frame, three motions are layered on the rest pose:
 *   - a walk sway driven by ground speed,
 *   - a slow ambient breeze so he never looks frozen when standing,
 *   - a lag term on turns, so the cloak swings wide when he changes direction.
 */
function buildCloak(material: THREE.Material): CloakRig {
  const RADIAL = 52;
  const VERTICAL = 28;
  const GAP = Math.PI * 0.34; // front opening, centred on +Z
  const TOP_Y = 1.5;
  // Calf-length, not floor-length. A cloak that reaches the ground turns the
  // whole figure into a cone and hides the walk entirely; stopping it above
  // the boots keeps the legs and stride visible, which is what reads as a
  // person travelling rather than a shape sliding along the road.
  const HEM_Y = 0.46;
  const TOP_R = 0.19;
  const HEM_R = 0.4;
  // Deeper, more numerous folds. Heavy travel wool falls in pronounced
  // vertical pleats; a shallow ripple just looks like a shaded cone.
  const FOLD_COUNT = 12;
  const FOLD_DEPTH = 0.055;

  const positions = new Float32Array(RADIAL * VERTICAL * 3);
  const uvs = new Float32Array(RADIAL * VERTICAL * 2);
  // Per-vertex sweep angle and normalised height, kept so the animation can
  // recompute positions without re-deriving them from the buffer.
  const angles = new Float32Array(RADIAL * VERTICAL);
  const heights = new Float32Array(RADIAL * VERTICAL);

  let index = 0;
  for (let v = 0; v < VERTICAL; v++) {
    const tv = v / (VERTICAL - 1);
    for (let u = 0; u < RADIAL; u++) {
      const tu = u / (RADIAL - 1);
      // Sweep from one edge of the front opening, all the way round, to the
      // other edge.
      const angle = GAP + tu * (Math.PI * 2 - GAP * 2);

      angles[index] = angle;
      heights[index] = tv;

      uvs[index * 2] = tu;
      uvs[index * 2 + 1] = tv;
      index++;
    }
  }

  const indices: number[] = [];
  for (let v = 0; v < VERTICAL - 1; v++) {
    for (let u = 0; u < RADIAL - 1; u++) {
      const a = v * RADIAL + u;
      const b = a + 1;
      const c = a + RADIAL;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const cloakMesh = mesh(geometry, material, "Cloak");

  // Smoothed motion state — the cloak reacts to changes, it does not snap.
  let swayPhase = 0;
  let smoothedSpeed = 0;
  let smoothedTurn = 0;

  function update(time: number, speed: number, turnRate: number) {
    smoothedSpeed += (speed - smoothedSpeed) * 0.06;
    smoothedTurn += (turnRate - smoothedTurn) * 0.08;
    swayPhase += smoothedSpeed * 0.09;

    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i];
      const tv = heights[i];

      // Rest shape: flare toward the hem, eased so the drape hangs close to
      // the shoulders and opens lower down.
      const flare = Math.pow(tv, 1.35);
      let radius = TOP_R + (HEM_R - TOP_R) * flare;

      // Vertical folds, deepening toward the hem.
      radius += Math.sin(angle * FOLD_COUNT) * FOLD_DEPTH * flare;

      // Cloaks are deeper front-to-back than side-to-side, because shoulders
      // hold the fabric out and it falls flat at the sides.
      const ellipse = 1 + Math.cos(angle) * 0.1 * flare;
      radius *= ellipse;

      let x = Math.sin(angle) * radius;
      let z = Math.cos(angle) * radius;
      let y = TOP_Y + (HEM_Y - TOP_Y) * tv;

      // Walk sway: the hem lifts and swings, strongest at the back.
      const backness = (1 - Math.cos(angle)) * 0.5;
      const walk =
        Math.sin(swayPhase * 2 + angle * 1.5) * 0.055 * flare * smoothedSpeed;
      z -= walk * (0.4 + backness);
      y += Math.abs(walk) * 0.35;

      // Trailing drag — fabric lags behind forward motion.
      z -= smoothedSpeed * 0.075 * flare * backness;

      // Turning throws the hem outward on the outside of the turn.
      x += smoothedTurn * 0.55 * flare * (0.5 + backness * 0.5);

      // Ambient breeze so he is never perfectly still.
      const breeze =
        Math.sin(time * 0.9 + angle * 2.2 + tv * 3.1) * 0.016 * flare +
        Math.sin(time * 1.7 + angle * 3.7) * 0.008 * flare;
      x += breeze;
      z += breeze * 0.6;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    positionAttribute.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  // Seed the rest pose so the first frame is already correct.
  update(0, 0, 0);

  return { mesh: cloakMesh, update };
}

// ---------------------------------------------------------------------------
// The hood
// ---------------------------------------------------------------------------

/**
 * A deep cowl. Swept like the cloak but around the head, open at the front and
 * peaked at the back — the shape that puts the face in total shadow.
 */
function buildHood(material: THREE.Material) {
  const RADIAL = 40;
  const VERTICAL = 20;
  const GAP = Math.PI * 0.42;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let v = 0; v < VERTICAL; v++) {
    const tv = v / (VERTICAL - 1);
    for (let u = 0; u < RADIAL; u++) {
      const tu = u / (RADIAL - 1);
      const angle = GAP + tu * (Math.PI * 2 - GAP * 2);

      // Profile: widest at the shoulders, closing to a point.
      //
      // The exponent is what stops it being a bucket. A plain sine falloff
      // still leaves real width at the crown, so the cowl truncates flat and
      // reads as a cylinder sitting on his head; raising it to a power pulls
      // the last third in sharply and gives the peaked hood silhouette that is
      // the whole character's signature.
      const profile = Math.pow(Math.sin((1 - tv) * Math.PI * 0.5), 0.55);
      let radius = 0.012 + profile * 0.168;

      // The back of the hood carries more fabric and slumps into a point.
      const backness = (1 - Math.cos(angle)) * 0.5;
      radius += backness * 0.05 * tv;

      const y = 0.02 + tv * 0.3 + backness * 0.02;
      // The peak trails backwards rather than standing straight up — a hood
      // hangs off the back of the skull, it isn't a cone balanced on top.
      const z = Math.cos(angle) * radius - backness * 0.05 * (1 - tv) - tv * tv * 0.05;
      const x = Math.sin(angle) * radius;

      positions.push(x, y, z);
    }
  }

  for (let v = 0; v < VERTICAL - 1; v++) {
    for (let u = 0; u < RADIAL - 1; u++) {
      const a = v * RADIAL + u;
      const b = a + 1;
      const c = a + RADIAL;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return mesh(geometry, material, "Hood");
}

// ---------------------------------------------------------------------------
// The lute
// ---------------------------------------------------------------------------

/**
 * A period-correct lute silhouette: a deep bowl back of glued ribs, a flat
 * soundboard, a carved rose instead of an open hole, and a pegbox bent sharply
 * back from the neck. That bent pegbox is the single most recognisable feature
 * of a lute versus a guitar, so it is worth the extra nodes.
 */
function buildLute(materials: Materials) {
  const lute = group("Lute");

  // Bowl back — lathed from a pear profile.
  const bowlProfile: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const radius = Math.sin(t * Math.PI) * 0.155 + 0.005;
    bowlProfile.push(new THREE.Vector2(radius, t * 0.4 - 0.2));
  }
  const bowl = mesh(
    new THREE.LatheGeometry(bowlProfile, 22),
    materials.woodDark,
    "LuteBowl"
  );
  bowl.rotation.x = Math.PI / 2;
  bowl.scale.set(1, 1, 0.62); // squash the depth so it's a bowl, not a ball
  lute.add(bowl);

  // Soundboard.
  const soundboard = mesh(
    new THREE.CylinderGeometry(0.158, 0.158, 0.012, 26),
    materials.wood,
    "LuteSoundboard"
  );
  soundboard.rotation.x = Math.PI / 2;
  soundboard.position.z = 0.052;
  soundboard.scale.set(1, 1.28, 1);
  lute.add(soundboard);

  // The rose: a pierced rosette, not a hole.
  const rose = mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.004, 20),
    materials.woodDark,
    "LuteRose"
  );
  rose.rotation.x = Math.PI / 2;
  rose.position.set(0, 0.03, 0.06);
  lute.add(rose);

  // Neck.
  const neck = mesh(
    new THREE.CylinderGeometry(0.019, 0.024, 0.34, 10),
    materials.woodDark,
    "LuteNeck"
  );
  neck.position.set(0, 0.34, 0.03);
  neck.scale.set(1.5, 1, 0.7);
  lute.add(neck);

  // Pegbox, angled back ~80° — the lute's signature.
  const pegbox = group("LutePegbox", [0, 0.5, 0.03]);
  pegbox.rotation.x = -1.32;
  const pegboxMesh = mesh(
    new THREE.CylinderGeometry(0.016, 0.021, 0.16, 8),
    materials.woodDark,
    "LutePegboxBody"
  );
  pegboxMesh.position.y = 0.07;
  pegboxMesh.scale.set(1.4, 1, 0.75);
  pegbox.add(pegboxMesh);

  for (let i = 0; i < 5; i++) {
    const peg = mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6),
      materials.metal,
      `LutePeg${i}`
    );
    peg.rotation.z = Math.PI / 2;
    peg.position.set(i % 2 === 0 ? 0.022 : -0.022, 0.03 + (i >> 1) * 0.038, 0);
    pegbox.add(peg);
  }
  lute.add(pegbox);

  // Strings. Individually modelled because the whole character is about
  // picking out single notes — the strings should read as separate.
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.014;
    const string = mesh(
      new THREE.CylinderGeometry(0.0011, 0.0011, 0.62, 4),
      materials.string,
      `LuteString${i}`
    );
    string.castShadow = false;
    string.position.set(x, 0.22, 0.062);
    lute.add(string);
  }

  // Bridge.
  const bridge = mesh(
    new THREE.BoxGeometry(0.09, 0.012, 0.014),
    materials.woodDark,
    "LuteBridge"
  );
  bridge.position.set(0, -0.09, 0.062);
  lute.add(bridge);

  return lute;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildBard(
  palette: BardPalette = DEFAULT_PALETTE
): BardParts {
  const materials = makeMaterials(palette);
  const root = group("Punaab");

  // --- Torso chain ---------------------------------------------------------
  const hips = group("Hips", [0, 0.95, 0]);
  root.add(hips);

  const pelvis = mesh(
    limbGeometry(0.15, 0.16, 0.13, 0.16),
    materials.cloth,
    "Pelvis"
  );
  pelvis.position.y = 0.06;
  hips.add(pelvis);

  const spine = group("Spine", [0, 0.06, 0]);
  hips.add(spine);

  const chest = group("Chest", [0, 0.24, 0]);
  spine.add(chest);

  const torso = mesh(
    limbGeometry(0.185, 0.175, 0.145, 0.34),
    materials.cloth,
    "Torso"
  );
  torso.position.y = 0.09;
  torso.scale.z = 0.78; // a chest is wider than it is deep
  chest.add(torso);

  // Belt and travel satchel — the things that say "he has been walking a while".
  const belt = mesh(
    new THREE.TorusGeometry(0.155, 0.022, 8, 24),
    materials.leather,
    "Belt"
  );
  belt.rotation.x = Math.PI / 2;
  belt.scale.z = 0.82;
  belt.position.y = 0.02;
  hips.add(belt);

  const buckle = mesh(
    new THREE.BoxGeometry(0.05, 0.045, 0.016),
    materials.metal,
    "Buckle"
  );
  buckle.position.set(0, 0.02, 0.14);
  hips.add(buckle);

  const satchel = mesh(
    new THREE.BoxGeometry(0.17, 0.2, 0.09),
    materials.leather,
    "Satchel"
  );
  satchel.position.set(-0.2, -0.02, -0.05);
  satchel.rotation.z = 0.12;
  hips.add(satchel);

  const strap = mesh(
    new THREE.TorusGeometry(0.2, 0.014, 6, 20, Math.PI * 1.1),
    materials.leather,
    "Strap"
  );
  strap.rotation.set(Math.PI / 2, 0, 0.5);
  strap.position.y = 0.16;
  chest.add(strap);

  // --- Head ----------------------------------------------------------------
  const neck = group("Neck", [0, 0.3, 0]);
  chest.add(neck);

  const neckMesh = mesh(
    limbGeometry(0.05, 0.052, 0.055, 0.09),
    materials.skin,
    "NeckMesh"
  );
  neckMesh.position.y = 0.02;
  neckMesh.rotation.x = Math.PI;
  neck.add(neckMesh);

  const head = group("Head", [0, 0.11, 0]);
  neck.add(head);

  const skull = mesh(new THREE.SphereGeometry(0.098, 20, 18), materials.skin, "Skull");
  skull.scale.set(0.92, 1.12, 1);
  head.add(skull);

  const jaw = mesh(new THREE.SphereGeometry(0.072, 14, 12), materials.skin, "Jaw");
  jaw.position.set(0, -0.055, 0.022);
  jaw.scale.set(0.88, 0.72, 0.95);
  head.add(jaw);

  // The hood interior: a near-black shell that swallows the face. This is what
  // makes him read as mysterious rather than as an unfinished model.
  const voidShell = mesh(
    new THREE.SphereGeometry(0.104, 16, 14),
    materials.shadow,
    "HoodShadow"
  );
  voidShell.material.side = THREE.BackSide;
  voidShell.castShadow = false;
  voidShell.scale.set(0.98, 1.14, 1.06);
  head.add(voidShell);

  // Two faint points of light where his eyes should be. Kept small and dim —
  // suggestion, not glow.
  const eyeGeometry = new THREE.SphereGeometry(0.0105, 8, 8);
  const eyes = mesh(eyeGeometry, materials.eyes, "Eyes");
  eyes.castShadow = false;
  eyes.position.set(-0.032, 0.012, 0.083);
  head.add(eyes);
  const eyeRight = mesh(eyeGeometry, materials.eyes, "EyeRight");
  eyeRight.castShadow = false;
  eyeRight.position.set(0.032, 0.012, 0.083);
  head.add(eyeRight);

  const hood = buildHood(materials.hood);
  hood.position.set(0, -0.12, -0.012);
  const hoodGroup = group("HoodRig");
  hoodGroup.add(hood);
  head.add(hoodGroup);

  // Shoulder mantle — the cape's upper layer, which hides where hood meets cloak.
  const mantle = mesh(
    limbGeometry(0.19, 0.26, 0.3, 0.22),
    materials.hood,
    "Mantle"
  );
  mantle.position.y = 0.2;
  mantle.scale.z = 0.92;
  chest.add(mantle);

  // --- Arms ----------------------------------------------------------------
  function buildArm(side: -1 | 1, name: string) {
    const upper = group(`${name}UpperArm`, [side * 0.185, 0.19, 0]);
    const upperMesh = mesh(
      limbGeometry(0.052, 0.048, 0.038, 0.27),
      materials.cloth,
      `${name}UpperArmMesh`
    );
    upper.add(upperMesh);

    const lower = group(`${name}Forearm`, [0, -0.27, 0]);
    const lowerMesh = mesh(
      limbGeometry(0.04, 0.042, 0.028, 0.25),
      materials.cloth,
      `${name}ForearmMesh`
    );
    lower.add(lowerMesh);
    upper.add(lower);

    const hand = group(`${name}Hand`, [0, -0.25, 0]);
    const palm = mesh(new THREE.BoxGeometry(0.055, 0.085, 0.028), materials.skin, `${name}Palm`);
    palm.position.y = -0.035;
    hand.add(palm);
    // Fingers, curled. He is always either holding the neck or about to pluck.
    for (let i = 0; i < 4; i++) {
      const finger = mesh(
        new THREE.CapsuleGeometry(0.0075, 0.038, 3, 6),
        materials.skin,
        `${name}Finger${i}`
      );
      finger.position.set((i - 1.5) * 0.014, -0.092, 0.008);
      finger.rotation.x = 0.55;
      hand.add(finger);
    }
    const thumb = mesh(
      new THREE.CapsuleGeometry(0.009, 0.03, 3, 6),
      materials.skin,
      `${name}Thumb`
    );
    thumb.position.set(side * -0.03, -0.062, 0.016);
    thumb.rotation.set(0.4, 0, side * 0.7);
    hand.add(thumb);
    lower.add(hand);

    return { upper, lower, hand };
  }

  const armLeft = buildArm(-1, "Left");
  const armRight = buildArm(1, "Right");
  chest.add(armLeft.upper);
  chest.add(armRight.upper);

  // --- Legs ----------------------------------------------------------------
  function buildLeg(side: -1 | 1, name: string) {
    const upper = group(`${name}Thigh`, [side * 0.088, 0, 0]);
    const upperMesh = mesh(
      limbGeometry(0.078, 0.072, 0.052, 0.44),
      materials.cloth,
      `${name}ThighMesh`
    );
    upper.add(upperMesh);

    const lower = group(`${name}Shin`, [0, -0.44, 0]);
    const lowerMesh = mesh(
      limbGeometry(0.055, 0.05, 0.034, 0.42),
      materials.cloth,
      `${name}ShinMesh`
    );
    lower.add(lowerMesh);
    upper.add(lower);

    // Travelling boots — turned-over cuff, worn sole.
    const foot = group(`${name}Foot`, [0, -0.42, 0]);
    const bootMesh = mesh(
      new THREE.BoxGeometry(0.085, 0.06, 0.21),
      materials.leather,
      `${name}Boot`
    );
    bootMesh.position.set(0, -0.03, 0.04);
    foot.add(bootMesh);
    const toe = mesh(
      new THREE.SphereGeometry(0.045, 10, 8),
      materials.leather,
      `${name}Toe`
    );
    toe.position.set(0, -0.03, 0.135);
    toe.scale.set(0.95, 0.65, 1.1);
    foot.add(toe);
    const cuff = mesh(
      new THREE.CylinderGeometry(0.062, 0.05, 0.07, 10),
      materials.leather,
      `${name}BootCuff`
    );
    cuff.position.y = 0.04;
    foot.add(cuff);
    lower.add(foot);

    return { upper, lower, foot };
  }

  const legLeft = buildLeg(-1, "Left");
  const legRight = buildLeg(1, "Right");
  hips.add(legLeft.upper);
  hips.add(legRight.upper);

  // --- Lute ----------------------------------------------------------------
  // Slung across the body, angled so the right hand falls naturally over the
  // strings and the left hand reaches the neck.
  const lute = buildLute(materials);
  lute.position.set(0.03, 0.05, 0.19);
  lute.rotation.set(0.22, -0.34, 0.62);
  lute.scale.setScalar(1);
  chest.add(lute);

  // --- Cloak ---------------------------------------------------------------
  const cloak = buildCloak(materials.cloak);
  root.add(cloak.mesh);

  const liningRig = buildCloak(materials.lining);
  liningRig.mesh.name = "CloakLining";
  liningRig.mesh.scale.setScalar(0.965);
  liningRig.mesh.castShadow = false;
  root.add(liningRig.mesh);

  // Clasp at the throat.
  const clasp = mesh(
    new THREE.TorusGeometry(0.022, 0.007, 6, 16),
    materials.metal,
    "CloakClasp"
  );
  clasp.position.set(0, 0.26, 0.13);
  clasp.rotation.x = 0.4;
  chest.add(clasp);

  // --- Walking staff -------------------------------------------------------
  const staff = mesh(
    new THREE.CylinderGeometry(0.014, 0.018, 1.55, 8),
    materials.woodDark,
    "Staff"
  );
  staff.position.set(0, 0.24, -0.06);
  staff.rotation.z = 0.06;
  armLeft.hand.add(staff);
  const staffTip = mesh(
    new THREE.IcosahedronGeometry(0.032, 1),
    materials.metal,
    "StaffCap"
  );
  staffTip.position.set(0, 1.02, -0.06);
  armLeft.hand.add(staffTip);

  return {
    root,
    hips,
    spine,
    chest,
    neck,
    head,
    hood: hoodGroup,
    armLeft,
    armRight,
    legLeft,
    legRight,
    lute,
    eyes,
    updateCloak: (time, speed, turnRate) => {
      cloak.update(time, speed, turnRate);
      liningRig.update(time, speed * 0.85, turnRate * 0.85);
    },
    dispose: () => {
      root.traverse((object) => {
        const asMesh = object as THREE.Mesh;
        if (asMesh.isMesh) asMesh.geometry.dispose();
      });
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}

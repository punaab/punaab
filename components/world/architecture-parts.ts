/**
 * The geometry lathe the buildings are turned on.
 *
 * Every structure in the world is a few hundred boxes, cylinders and wedges,
 * and the only way that survives contact with a 640-metre valley is if the
 * whole of one building kind collapses into a handful of draw calls. So nothing
 * here creates a mesh: generators append transformed copies of a few cached
 * unit primitives into per-material buckets, the buckets become one merged
 * geometry each, and `Architecture.tsx` instances those across every cottage,
 * fence and haystack of that kind in the world.
 *
 * Colour lives in the vertices rather than the material. That is what buys the
 * irregular coursing — every stone in a wall can be its own shade of grey out
 * of one draw call — and it leaves the material colour and the per-instance
 * colour free to tint whole buildings on top of it.
 */

import * as THREE from "three";

export type PartKey =
  | "stone"
  | "plaster"
  | "timber"
  | "plank"
  | "thatch"
  | "shingle"
  | "cloth"
  | "metal"
  | "glow"
  | "window"
  | "hay"
  | "dirt";

type Bucket = {
  position: number[];
  normal: number[];
  color: number[];
  index: number[];
};

// ---------------------------------------------------------------------------
// Cached unit primitives
// ---------------------------------------------------------------------------

const templates = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geometry = templates.get(key);
  if (!geometry) {
    geometry = make();
    // UVs are dead weight here: nothing in the world is textured, and every
    // vertex of every template is copied into a merged buffer.
    geometry.deleteAttribute("uv");
    templates.set(key, geometry);
  }
  return geometry;
}

/**
 * A triangular prism with its ridge running along X — the shape of a gable end,
 * and the reason it is hand-built rather than extruded: three.js has no
 * primitive for it, and `ExtrudeGeometry` would allocate a shape and a path per
 * call for six triangles.
 */
function prismGeometry(): THREE.BufferGeometry {
  const a = [-0.5, 0, -0.5];
  const b = [-0.5, 0, 0.5];
  const c = [-0.5, 1, 0];
  const d = [0.5, 0, -0.5];
  const e = [0.5, 0, 0.5];
  const f = [0.5, 1, 0];

  const tris = [
    [a, b, c],
    [d, f, e],
    [a, d, e],
    [a, e, b],
    [b, e, f],
    [b, f, c],
    [a, c, f],
    [a, f, d],
  ];

  const position: number[] = [];
  for (const tri of tris) for (const v of tri) position.push(v[0], v[1], v[2]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const scratchMatrix = new THREE.Matrix4();
const scratchNormal = new THREE.Matrix3();
const scratchVector = new THREE.Vector3();
const scratchEuler = new THREE.Euler();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();

export type Vec3 = [number, number, number];

const ORIGIN: Vec3 = [0, 0, 0];
const NO_ROTATION: Vec3 = [0, 0, 0];

/**
 * Integer hash -> [0, 1). `Math.imul` for the same reason as everywhere else in
 * this project: a plain `*` on these constants overflows past 2^53 and drops
 * the low bits, which are the entire output. Written that way, every building
 * in the world would take its "random" wear from the same quarter of the range
 * and come out identically crooked.
 */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Build {
  readonly buckets = new Map<PartKey, Bucket>();
  /** Named local positions the renderer needs afterwards: chimneys, hearths. */
  readonly marks = new Map<string, Vec3[]>();
  /** 0 low, 1 medium, 2 high. Generators thin themselves out on the way down. */
  readonly lod: number;

  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private readonly seed: number;
  private counter = 0;
  private readonly tint = new THREE.Color();

  constructor(seed: number, lod: number) {
    this.seed = seed;
    this.lod = lod;
  }

  // --- determinism --------------------------------------------------------

  /** Next value in this builder's deterministic stream. */
  rnd(): number {
    this.counter++;
    return hash2(this.seed + this.counter * 7919, this.seed * 31 + this.counter);
  }

  range(low: number, high: number): number {
    return low + this.rnd() * (high - low);
  }

  /** Symmetric jitter, for the wear that keeps nothing perfectly straight. */
  wobble(amount: number): number {
    return (this.rnd() - 0.5) * 2 * amount;
  }

  /**
   * A shade of a base colour. Every masonry block, thatch course and plank goes
   * through this — a wall of one flat grey is the single clearest sign that a
   * building was extruded rather than built.
   */
  shade(base: THREE.Color, amount = 0.14): THREE.Color {
    const k = 1 + this.wobble(amount);
    return this.tint.setRGB(base.r * k, base.g * k, base.b * k);
  }

  // --- transform stack ----------------------------------------------------

  push(position: Vec3 = ORIGIN, rotation: Vec3 = NO_ROTATION, scale?: Vec3): void {
    const local = new THREE.Matrix4();
    scratchVector.set(position[0], position[1], position[2]);
    scratchEuler.set(rotation[0], rotation[1], rotation[2]);
    scratchQuaternion.setFromEuler(scratchEuler);
    scratchScale.set(scale ? scale[0] : 1, scale ? scale[1] : 1, scale ? scale[2] : 1);
    local.compose(scratchVector, scratchQuaternion, scratchScale);
    this.stack.push(new THREE.Matrix4().multiplyMatrices(this.top(), local));
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  private top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  mark(name: string, position: Vec3): void {
    scratchVector.set(position[0], position[1], position[2]).applyMatrix4(this.top());
    const list = this.marks.get(name);
    const entry: Vec3 = [scratchVector.x, scratchVector.y, scratchVector.z];
    if (list) list.push(entry);
    else this.marks.set(name, [entry]);
  }

  // --- primitives ---------------------------------------------------------

  box(
    key: PartKey,
    color: THREE.Color,
    size: Vec3,
    position: Vec3,
    rotation: Vec3 = NO_ROTATION
  ): void {
    this.add(key, cached("box", () => new THREE.BoxGeometry(1, 1, 1)), color, size, position, rotation);
  }

  /** Ridge along X: the gable end of everything with a pitched roof. */
  prism(
    key: PartKey,
    color: THREE.Color,
    size: Vec3,
    position: Vec3,
    rotation: Vec3 = NO_ROTATION
  ): void {
    this.add(key, cached("prism", prismGeometry), color, size, position, rotation);
  }

  cylinder(
    key: PartKey,
    color: THREE.Color,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    segments: number,
    position: Vec3,
    rotation: Vec3 = NO_ROTATION
  ): void {
    const base = Math.max(radiusBottom, 1e-4);
    // Templates are cached by taper, not by size, so a hundred posts of a
    // hundred different lengths share one buffer.
    const taper = Math.round((radiusTop / base) * 100) / 100;
    const geometry = cached(
      `cyl:${segments}:${taper}`,
      () => new THREE.CylinderGeometry(taper, 1, 1, segments, 1)
    );
    this.add(key, geometry, color, [base, height, base], position, rotation);
  }

  /** Rubble, boulders, spoil. Detail 0 is a rock; detail 1 is a smoother one. */
  rock(
    key: PartKey,
    color: THREE.Color,
    size: Vec3,
    position: Vec3,
    rotation: Vec3 = NO_ROTATION,
    detail = 0
  ): void {
    const geometry = cached(`ico:${detail}`, () => new THREE.IcosahedronGeometry(1, detail));
    this.add(key, geometry, color, size, position, rotation);
  }

  sphere(
    key: PartKey,
    color: THREE.Color,
    size: Vec3,
    position: Vec3,
    rotation: Vec3 = NO_ROTATION
  ): void {
    const geometry = cached("sphere", () => new THREE.SphereGeometry(1, 10, 7));
    this.add(key, geometry, color, size, position, rotation);
  }

  private add(
    key: PartKey,
    geometry: THREE.BufferGeometry,
    color: THREE.Color,
    size: Vec3,
    position: Vec3,
    rotation: Vec3
  ): void {
    scratchVector.set(position[0], position[1], position[2]);
    scratchEuler.set(rotation[0], rotation[1], rotation[2]);
    scratchQuaternion.setFromEuler(scratchEuler);
    scratchScale.set(size[0], size[1], size[2]);
    scratchMatrix.compose(scratchVector, scratchQuaternion, scratchScale);
    scratchMatrix.premultiply(this.top());
    // Non-uniform scale is everywhere in this file — a wall is a box scaled
    // 6 x 2.4 x 0.2 — so normals need the inverse transpose, not the rotation.
    scratchNormal.getNormalMatrix(scratchMatrix);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { position: [], normal: [], color: [], index: [] };
      this.buckets.set(key, bucket);
    }

    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const normals = geometry.attributes.normal as THREE.BufferAttribute;
    const offset = bucket.position.length / 3;

    for (let i = 0; i < positions.count; i++) {
      scratchVector
        .set(positions.getX(i), positions.getY(i), positions.getZ(i))
        .applyMatrix4(scratchMatrix);
      bucket.position.push(scratchVector.x, scratchVector.y, scratchVector.z);

      scratchVector
        .set(normals.getX(i), normals.getY(i), normals.getZ(i))
        .applyMatrix3(scratchNormal)
        .normalize();
      bucket.normal.push(scratchVector.x, scratchVector.y, scratchVector.z);

      bucket.color.push(color.r, color.g, color.b);
    }

    const indices = geometry.getIndex();
    if (indices) {
      for (let i = 0; i < indices.count; i++) bucket.index.push(offset + indices.getX(i));
    } else {
      for (let i = 0; i < positions.count; i++) bucket.index.push(offset + i);
    }
  }

  build(): Map<PartKey, THREE.BufferGeometry> {
    const out = new Map<PartKey, THREE.BufferGeometry>();
    for (const [key, bucket] of this.buckets) {
      if (bucket.index.length === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(bucket.position, 3)
      );
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(bucket.normal, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.color, 3));
      geometry.setIndex(bucket.index);
      geometry.computeBoundingSphere();
      out.set(key, geometry);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Colours are constructed once and read as linear working-space values — the
 * `THREE.Color` constructor does the sRGB decode, which is exactly what a
 * vertex colour attribute wants.
 */
export const PALETTE = {
  rubble: new THREE.Color("#8a8378"),
  rubbleDark: new THREE.Color("#6c665c"),
  rubbleWarm: new THREE.Color("#93826c"),
  ashlar: new THREE.Color("#9a9287"),
  daub: new THREE.Color("#b0a184"),
  daubGrey: new THREE.Color("#9d9581"),
  oak: new THREE.Color("#4b3726"),
  oakPale: new THREE.Color("#6d5539"),
  plank: new THREE.Color("#7d6544"),
  plankPale: new THREE.Color("#93794f"),
  thatch: new THREE.Color("#7d6437"),
  thatchDark: new THREE.Color("#5c4926"),
  shingle: new THREE.Color("#5d564d"),
  slate: new THREE.Color("#4a4d52"),
  clothRed: new THREE.Color("#8b4048"),
  clothBlue: new THREE.Color("#3f5570"),
  clothCream: new THREE.Color("#b9a887"),
  iron: new THREE.Color("#2f2c29"),
  ember: new THREE.Color("#ff9a3c"),
  lamp: new THREE.Color("#f6c778"),
  /**
   * What a window is when nobody has lit it: a hole with a room behind it.
   *
   * Darker than `soil`, which is what unlit panes used to be built out of,
   * because this one has to hold up under a night-time emissive on the same
   * surface — a pane that is already brown-grey by day has nowhere to go when
   * the lamp behind it comes on.
   */
  glass: new THREE.Color("#241c14"),
  hay: new THREE.Color("#b09343"),
  soil: new THREE.Color("#4b3d2c"),
  moss: new THREE.Color("#4a5533"),
} as const;

// ---------------------------------------------------------------------------
// Shared building elements
// ---------------------------------------------------------------------------

/**
 * A course of masonry, laid as individual blocks of varying length with each
 * one set a little proud or a little deep.
 *
 * This is the whole difference between "stone building" and "grey box". Real
 * rubble walling has no two stones alike and no continuous vertical joint, so
 * the block lengths are random and each course starts at a different offset.
 */
export function stoneCourse(
  b: Build,
  color: THREE.Color,
  length: number,
  height: number,
  thickness: number,
  y: number,
  z: number,
  rotationY = 0
): void {
  const blocks = Math.max(2, Math.round(length / (b.lod > 0 ? 0.62 : 1.9)));
  const step = length / blocks;
  let x = -length / 2;
  for (let i = 0; i < blocks; i++) {
    const width = step * b.range(0.72, 1.0);
    const proud = b.range(-0.022, 0.05);
    b.box(
      "stone",
      b.shade(color, 0.17),
      [width, height * b.range(0.84, 1), thickness + proud],
      [x + step / 2 + b.wobble(step * 0.08), y + b.wobble(height * 0.06), z],
      [0, rotationY, b.wobble(0.03)]
    );
    x += step;
  }
}

/**
 * A stone wall: courses stacked with a plinth at the bottom that is wider than
 * everything above it.
 *
 * The plinth is not ornament. A wall that meets the ground on the same plane it
 * rises in looks like it was pushed up through the soil; a projecting base
 * course is how masonry actually sheds water off a footing, and the eye reads
 * its absence long before it can name it.
 */
export function stoneWall(
  b: Build,
  color: THREE.Color,
  length: number,
  height: number,
  thickness: number,
  z: number,
  rotationY = 0
): void {
  const courseHeight = b.lod > 0 ? 0.32 : 0.68;
  const courses = Math.max(2, Math.round(height / courseHeight));
  const actual = height / courses;
  for (let i = 0; i < courses; i++) {
    // The bottom course is the plinth: thicker, taller, and standing proud all
    // the way round.
    const plinth = i === 0;
    stoneCourse(
      b,
      plinth ? color : color,
      length,
      actual * (plinth ? 1.15 : 1),
      thickness * (plinth ? 1.22 : 1),
      actual * (i + 0.5),
      z,
      rotationY
    );
  }
}

/**
 * Timber framing: sill, posts, mid rail, wall plate and corner braces, with the
 * infill panel behind them.
 *
 * The members are real — a post carries the plate, a brace runs corner to
 * corner across a bay at forty-five degrees — because painted-on stripes read
 * as a pattern and actual carpentry reads as a building. The infill sits
 * slightly *behind* the frame so the timbers catch a shadow line.
 */
export function timberFrame(
  b: Build,
  length: number,
  height: number,
  z: number,
  options: { braces?: boolean; midRail?: boolean; postWidth?: number } = {}
): void {
  const { braces = true, midRail = true, postWidth = 0.17 } = options;
  const timber = PALETTE.oak;
  const depth = 0.13;

  const bays = Math.max(2, Math.round(length / (b.lod > 0 ? 1.35 : 2.2)));
  const bayWidth = length / bays;

  // Sill and wall plate.
  b.box("timber", b.shade(timber), [length, 0.2, depth * 1.15], [0, 0.1, z], [0, 0, b.wobble(0.006)]);
  b.box("timber", b.shade(timber), [length, 0.24, depth * 1.2], [0, height - 0.12, z]);

  if (midRail) {
    b.box("timber", b.shade(timber), [length, 0.15, depth], [0, height * 0.52, z]);
  }

  for (let i = 0; i <= bays; i++) {
    const x = -length / 2 + i * bayWidth;
    const corner = i === 0 || i === bays;
    b.box(
      "timber",
      b.shade(timber),
      [corner ? postWidth * 1.5 : postWidth, height, depth * (corner ? 1.3 : 1)],
      [x, height / 2, z],
      [0, 0, b.wobble(0.008)]
    );
  }

  if (braces && b.lod > 0) {
    // One brace in each end bay, which is where the racking load actually is.
    const run = bayWidth * 0.86;
    const rise = height * 0.44;
    const span = Math.hypot(run, rise);
    for (const side of [-1, 1]) {
      const x = side * (length / 2 - bayWidth * 0.5);
      b.box(
        "timber",
        b.shade(timber),
        [0.14, span, depth],
        [x, height * 0.29, z],
        [0, 0, side * Math.atan2(run, rise)]
      );
    }
  }
}

/** The daub panel behind a frame, and the frame's own shadow gap. */
export function infillPanel(
  b: Build,
  color: THREE.Color,
  length: number,
  height: number,
  thickness: number,
  z: number
): void {
  b.box("plaster", b.shade(color, 0.07), [length, height, thickness], [0, height / 2, z]);
}

export type RoofOptions = {
  /** Along the ridge. */
  length: number;
  /** Wall to wall, square to the ridge. */
  span: number;
  /** Height of the eaves above this group's origin. */
  wallTop: number;
  /** Ridge height above the eaves. */
  pitch: number;
  /** Horizontal overhang past the wall on the eaves sides. */
  eaves: number;
  /** Overhang past the gable ends. */
  verge: number;
  style: "thatch" | "shingle" | "slate";
  color?: THREE.Color;
};

/**
 * A gabled roof: two pitched planes meeting at a ridge, with eaves that
 * overhang the walls.
 *
 * The overhang is the point. A four-sided cone sitting on a box is the classic
 * toy-village roof, and the reason it reads as a toy is that real roofs throw
 * water clear of the wall — so the plane continues past the eaves and drops
 * *below* the wall head, and the wall underneath sits in its shadow all day.
 *
 * Thatch is laid as stacked courses, each one a little proud of the one above,
 * because that stepped butt line is the only thing that distinguishes thatch
 * from a brown plane at any distance.
 */
export function gabledRoof(b: Build, options: RoofOptions): void {
  const { length, span, wallTop, pitch, eaves, verge, style } = options;
  const half = span / 2;
  const tan = pitch / half;
  const run = half + eaves;
  const drop = pitch + eaves * tan;
  const slope = Math.hypot(run, drop);
  const angle = Math.atan2(drop, run);
  const ridgeY = wallTop + pitch;
  const deckLength = length + verge * 2;

  const color =
    options.color ??
    (style === "thatch"
      ? PALETTE.thatch
      : style === "shingle"
        ? PALETTE.shingle
        : PALETTE.slate);

  // Rafters and the ridge beam, seen from below and at the eaves.
  b.box("timber", b.shade(PALETTE.oak), [deckLength, 0.17, 0.16], [0, ridgeY - 0.06, 0]);
  const rafters = Math.max(3, Math.round(length / (b.lod > 0 ? 0.9 : 1.8)));
  for (let i = 0; i <= rafters; i++) {
    const x = -length / 2 + (i / rafters) * length;
    for (const side of [-1, 1]) {
      b.box(
        "timber",
        b.shade(PALETTE.oak, 0.2),
        [0.1, 0.13, slope],
        [x, ridgeY - (drop / slope) * (slope / 2), (side * run) / 2],
        [side * angle, 0, 0]
      );
    }
  }

  const courses =
    style === "thatch" ? (b.lod > 1 ? 9 : b.lod > 0 ? 6 : 4) : b.lod > 1 ? 11 : b.lod > 0 ? 7 : 4;
  const thickness = style === "thatch" ? 0.3 : 0.1;

  for (const side of [-1, 1]) {
    // Direction from ridge to eaves, and the plane's outward normal.
    const dirY = -drop / slope;
    const dirZ = (side * run) / slope;
    const normalY = run / slope;
    const normalZ = (side * drop) / slope;

    for (let i = 0; i < courses; i++) {
      // i = 0 at the eaves, so the courses stack up the slope the way they are
      // actually laid.
      const t0 = 1 - (i + 1) / courses;
      const t1 = 1 - i / courses;
      const mid = ((t0 + t1) / 2) * slope;
      const courseLength = (slope / courses) * (style === "thatch" ? 1.7 : 1.5);
      const proud =
        thickness * 0.5 + ((courses - 1 - i) / courses) * (style === "thatch" ? 0.09 : 0.02);
      const wear = b.range(0.9, 1.08);

      b.box(
        style === "thatch" ? "thatch" : "shingle",
        b.shade(color, style === "thatch" ? 0.16 : 0.2),
        [deckLength * b.range(0.995, 1.005), thickness * wear, courseLength],
        [
          b.wobble(0.02),
          ridgeY + dirY * mid + normalY * proud + b.wobble(0.012),
          dirZ * mid + normalZ * proud,
        ],
        [side * angle + b.wobble(0.012), 0, 0]
      );
    }
  }

  // Ridge capping. Thatch gets a rolled ridge pegged down with spars; shingle
  // and slate get a plain capping course.
  if (style === "thatch") {
    b.cylinder(
      "thatch",
      b.shade(PALETTE.thatchDark, 0.1),
      0.26,
      0.26,
      deckLength,
      7,
      [0, ridgeY + 0.19, 0],
      [0, 0, Math.PI / 2]
    );
    if (b.lod > 0) {
      const spars = Math.max(3, Math.round(deckLength / 0.8));
      for (let i = 0; i <= spars; i++) {
        const x = -deckLength / 2 + (i / spars) * deckLength;
        b.box(
          "timber",
          b.shade(PALETTE.oakPale, 0.24),
          [0.05, 0.05, 0.86],
          [x, ridgeY + 0.36, 0],
          [b.wobble(0.12), 0, 0]
        );
      }
    }
  } else {
    b.box(
      "shingle",
      b.shade(color, 0.12),
      [deckLength, 0.13, 0.42],
      [0, ridgeY + 0.09, 0]
    );
  }
}

/** The triangular wall that closes a gable, with its tie beam and king post. */
export function gableEnd(
  b: Build,
  color: THREE.Color,
  span: number,
  pitch: number,
  wallTop: number,
  x: number,
  thickness: number,
  framed: boolean
): void {
  b.prism("plaster", b.shade(color, 0.08), [thickness, pitch, span], [x, wallTop, 0]);
  if (!framed || b.lod === 0) return;

  const face = x + Math.sign(x) * (thickness / 2 + 0.03);
  const timber = PALETTE.oak;
  // Tie beam, king post, and a pair of struts up to the principal rafters.
  b.box("timber", b.shade(timber), [0.12, 0.18, span], [face, wallTop + 0.09, 0]);
  b.box("timber", b.shade(timber), [0.12, pitch - 0.2, 0.16], [face, wallTop + pitch / 2, 0]);
  for (const side of [-1, 1]) {
    const run = span * 0.24;
    const rise = pitch * 0.52;
    b.box(
      "timber",
      b.shade(timber, 0.2),
      [0.1, Math.hypot(run, rise), 0.12],
      [face, wallTop + rise / 2 + 0.1, (side * run) / 2],
      [-side * Math.atan2(run, rise), 0, 0]
    );
  }
}

/** A plank door in a frame, with strap hinges and a ring handle. */
export function door(
  b: Build,
  width: number,
  height: number,
  z: number,
  options: { x?: number; open?: boolean } = {}
): void {
  const { x = 0, open = false } = options;
  const frame = PALETTE.oak;

  b.box("timber", b.shade(frame), [0.14, height + 0.16, 0.2], [x - width / 2 - 0.07, (height + 0.16) / 2, z]);
  b.box("timber", b.shade(frame), [0.14, height + 0.16, 0.2], [x + width / 2 + 0.07, (height + 0.16) / 2, z]);
  b.box("timber", b.shade(frame), [width + 0.28, 0.16, 0.22], [x, height + 0.08, z]);

  if (open) {
    // A doorway with nothing behind it reads as a decal; a dark recess reads as
    // a room somebody is standing in.
    b.box("dirt", PALETTE.soil, [width, height, 0.1], [x, height / 2, z - 0.12]);
    return;
  }

  const boards = 4;
  for (let i = 0; i < boards; i++) {
    b.box(
      "plank",
      b.shade(PALETTE.plank, 0.16),
      [width / boards - 0.015, height, 0.07],
      [x - width / 2 + (i + 0.5) * (width / boards), height / 2, z + b.wobble(0.006)]
    );
  }
  if (b.lod > 0) {
    for (const y of [height * 0.24, height * 0.78]) {
      b.box("metal", PALETTE.iron, [width * 0.84, 0.055, 0.035], [x, y, z + 0.05]);
      b.box("metal", PALETTE.iron, [0.1, 0.14, 0.045], [x - width / 2 + 0.05, y, z + 0.055]);
    }
    b.cylinder("metal", PALETTE.iron, 0.045, 0.045, 0.03, 6, [x + width * 0.3, height * 0.52, z + 0.06], [Math.PI / 2, 0, 0]);
  }
}

/**
 * The vertex colour of a window pane is not a colour.
 *
 * Which windows are lit used to be decided here, at build time, by dropping the
 * pane into the "glow" bucket or the "dirt" one — and a building is generated
 * once and instanced sixty times, so that froze one answer into every cottage of
 * a variant for all eternity, in daylight as much as at midnight. Every pane in
 * the world now goes into one bucket drawn with one material whose emissive
 * brightness is a single number set once a frame, which means the only place a
 * *per-pane* answer can still live is the colour attribute. So `Architecture.tsx`
 * reads this back in a shader patch instead of tinting with it:
 *
 *   red   — when this pane lights, as a fraction of the way through dusk
 *   green — how brightly, where zero is a room nobody is in tonight
 *   blue  — spare
 *
 * Packed here rather than at the call sites so there is exactly one place that
 * has to agree with the shader.
 */
const paneCode = new THREE.Color();

export function lampPane(threshold: number, brightness: number): THREE.Color {
  return paneCode.setRGB(threshold, brightness, 1);
}

/**
 * A small shuttered opening.
 *
 * Small is the whole brief. Glass is expensive in this world, so windows are
 * holes with shutters, and anything picture-sized instantly reads as a modern
 * building with a thatch hat on.
 *
 * `lit` no longer means "this pane is drawn glowing" — nothing is drawn glowing
 * until dusk. It means "somebody is in this room after dark", which is the thing
 * the building generators actually knew when they passed it, and it now buys the
 * pane an early, full-strength lamp instead of a late, grudging one.
 */
export function shutteredWindow(
  b: Build,
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
  lit: boolean
): void {
  b.box("timber", b.shade(PALETTE.oak), [width + 0.18, 0.12, 0.16], [x, y + height / 2 + 0.06, z]);
  b.box("timber", b.shade(PALETTE.oak), [width + 0.18, 0.1, 0.2], [x, y - height / 2 - 0.05, z]);

  // Unoccupied rooms are mostly dark all night — a village where every opening
  // is warm reads as a hotel — but not all of them: a rushlight left at the back
  // of a house, lit late and barely, is what keeps the dark ones from looking
  // like a pattern.
  const rushlight = !lit && b.rnd() < 0.45;
  const threshold = lit ? b.range(0.16, 0.52) : b.range(0.62, 1);
  const brightness = lit ? b.range(0.85, 1.15) : rushlight ? b.range(0.22, 0.42) : 0;
  b.box("window", lampPane(threshold, brightness), [width, height, 0.06], [x, y, z + 0.01]);

  if (lit) {
    // Clear of the glass, and below the sill, because the point light this
    // becomes is meant to wash the wall and the ground under the window. A light
    // sitting in the plane of the wall lights neither: every surface around it
    // is edge-on to it. Only occupied rooms are marked — the light pool takes
    // one spill per building, so it wants the pane that is certain to be lit.
    b.mark("window", [x, y - height * 0.25, z + 0.7]);
  }

  if (b.lod > 0) {
    // Mullion, and one shutter swung back against the wall.
    b.box("timber", b.shade(PALETTE.oak), [0.05, height, 0.08], [x, y, z + 0.03]);
    b.box(
      "plank",
      b.shade(PALETTE.plankPale, 0.14),
      [width * 0.55, height * 1.06, 0.05],
      [x - width * 0.82, y, z + 0.07],
      [0, b.range(-0.35, -0.12), 0]
    );
  }
}

/** A stone chimney stack with a capping course, and a mark for its smoke. */
export function chimney(
  b: Build,
  x: number,
  z: number,
  base: number,
  top: number,
  width: number
): void {
  const height = top - base;
  const courses = Math.max(2, Math.round(height / 0.4));
  for (let i = 0; i < courses; i++) {
    const t = i / courses;
    const w = width * (1 - t * 0.14);
    b.box(
      "stone",
      b.shade(PALETTE.rubble, 0.16),
      [w, height / courses, w],
      [x + b.wobble(0.015), base + (i + 0.5) * (height / courses), z + b.wobble(0.015)],
      [0, b.wobble(0.03), 0]
    );
  }
  // Capping, oversailing the stack so rain runs off the outside of it.
  b.box("stone", b.shade(PALETTE.ashlar, 0.1), [width * 1.24, 0.13, width * 1.24], [x, top + 0.06, z]);
  b.box("dirt", PALETTE.soil, [width * 0.45, 0.08, width * 0.45], [x, top + 0.13, z]);
  b.mark("chimney", [x, top + 0.2, z]);
}

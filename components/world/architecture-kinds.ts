/**
 * Every building in the valley, described as carpentry.
 *
 * One generator per structure kind, each of which draws a building out of
 * posts, courses, rafters and boards rather than out of a box with a cone on
 * top. They are written against local axes fixed by `settlements.ts`: **local
 * +Z is the front**, because the placer rotates every structure to face the
 * road it stands beside, and a door on the blind side is the fastest way to
 * make a village look like scenery.
 *
 * Each generator is called a handful of times at load — once per variant, not
 * once per building — and the results are instanced. That is why they can
 * afford to be this detailed: a cottage costs about two hundred primitives, and
 * sixty cottages cost the same two hundred.
 */

import * as THREE from "three";

import {
  BRIDGE_DECK_LENGTH,
  bridgeDeckLocalY,
  bridgeProfile,
} from "@/lib/world/bridges";
import type { Structure } from "@/lib/world/settlements";

import {
  Build,
  PALETTE,
  chimney,
  door,
  gabledRoof,
  gableEnd,
  infillPanel,
  lampPane,
  shutteredWindow,
  stoneCourse,
  stoneWall,
  timberFrame,
} from "./architecture-parts";
import type { StructureKind } from "@/lib/world/settlements";

/** Stone circle layout. Must agree with `structureColliders` in settlements.ts. */
const STONE_RING_COUNT = 9;
const STONE_RING_RADIUS = 6.5;
const STONE_FALLEN_INDEX = 4;

// ---------------------------------------------------------------------------
// Dwellings
// ---------------------------------------------------------------------------

/**
 * A cottage. Six metres by five, one room, a loft under the thatch.
 *
 * Variant 0 is timber-framed daub under thatch, 1 the same under shingle, 2 has
 * a stone lower storey where the local stone came cheaper than the local oak.
 * The order is not arbitrary: low-tier devices only build the first two, and
 * coursed masonry is by some distance the most expensive wall in the file.
 */
function cottage(b: Build, variant: number): void {
  const width = 6.2;
  const depth = 5.0;
  const wallTop = 2.45 + b.range(-0.12, 0.18);
  const plinth = 0.46;
  const stony = variant === 2;
  const style = variant === 1 ? "shingle" : "thatch";

  // Plinth, projecting all round. Everything above sits on top of it.
  stoneCourse(b, PALETTE.rubble, width + 0.5, plinth, depth + 0.5, plinth / 2, 0);

  b.push([0, plinth, 0]);

  const wallHeight = wallTop - plinth;
  const daub = stony ? PALETTE.daubGrey : PALETTE.daub;

  if (stony) {
    // Stone to the mid rail, framed daub above it.
    const stoneTop = wallHeight * 0.55;
    for (const side of [-1, 1]) {
      stoneWall(b, PALETTE.rubbleWarm, width, stoneTop, 0.34, (side * depth) / 2);
      b.push([0, stoneTop, 0]);
      infillPanel(b, daub, width, wallHeight - stoneTop, 0.3, (side * depth) / 2);
      timberFrame(b, width, wallHeight - stoneTop, (side * depth) / 2 + side * 0.18, {
        midRail: false,
      });
      b.pop();
    }
    b.push([0, 0, 0], [0, Math.PI / 2, 0]);
    for (const side of [-1, 1]) {
      stoneWall(b, PALETTE.rubbleWarm, depth, wallHeight, 0.34, (side * width) / 2);
    }
    b.pop();
  } else {
    for (const side of [-1, 1]) {
      infillPanel(b, daub, width, wallHeight, 0.34, (side * depth) / 2);
      timberFrame(b, width, wallHeight, (side * depth) / 2 + side * 0.2);
    }
    b.push([0, 0, 0], [0, Math.PI / 2, 0]);
    for (const side of [-1, 1]) {
      infillPanel(b, daub, depth, wallHeight, 0.34, (side * width) / 2);
      timberFrame(b, depth, wallHeight, (side * width) / 2 + side * 0.2, { braces: false });
    }
    b.pop();
  }

  const pitch = 2.35 + b.range(-0.15, 0.25);
  gabledRoof(b, {
    length: width,
    span: depth,
    wallTop: wallHeight,
    pitch,
    eaves: 0.52,
    verge: 0.34,
    style,
  });
  for (const side of [-1, 1]) {
    gableEnd(b, daub, depth, pitch, wallHeight, (side * width) / 2, 0.26, !stony);
  }

  door(b, 0.95, 1.95, depth / 2 + 0.16, { x: b.range(-0.5, 0.5) });
  shutteredWindow(b, 0.52, 0.44, -width * 0.3, wallHeight * 0.68, depth / 2 + 0.2, true);
  shutteredWindow(b, 0.46, 0.4, width * 0.32, wallHeight * 0.66, depth / 2 + 0.2, b.rnd() < 0.6);
  shutteredWindow(b, 0.44, 0.38, b.range(-1, 1), wallHeight * 0.66, -depth / 2 - 0.2, false);

  b.pop();

  chimney(
    b,
    width * b.range(0.24, 0.34) * (b.rnd() < 0.5 ? -1 : 1),
    b.range(-0.4, 0.4),
    plinth + 0.6,
    wallTop + pitch + b.range(0.7, 1.2),
    0.66
  );

  // A water butt under the eaves, and the odd bit of lumber. Nothing about a
  // lived-in house is tidy.
  if (b.lod > 0) {
    b.cylinder(
      "plank",
      b.shade(PALETTE.plank, 0.2),
      0.32,
      0.29,
      0.62,
      9,
      [width * 0.42, plinth + 0.31, depth / 2 + 0.42]
    );
    b.box("metal", PALETTE.iron, [0.68, 0.05, 0.68], [width * 0.42, plinth + 0.56, depth / 2 + 0.42]);
  }
}

/** A longhouse: family at one end, byre at the other, one roof over both. */
function longhouse(b: Build, variant: number): void {
  const width = 13.2;
  const depth = 6.2;
  const plinth = 0.5;
  const wallTop = 2.9;
  const wallHeight = wallTop - plinth;
  const stony = variant === 1;

  stoneCourse(b, PALETTE.rubble, width + 0.55, plinth, depth + 0.55, plinth / 2, 0);
  b.push([0, plinth, 0]);

  const daub = PALETTE.daub;
  for (const side of [-1, 1]) {
    if (stony) {
      stoneWall(b, PALETTE.rubble, width, wallHeight, 0.36, (side * depth) / 2);
    } else {
      infillPanel(b, daub, width, wallHeight, 0.36, (side * depth) / 2);
      timberFrame(b, width, wallHeight, (side * depth) / 2 + side * 0.21);
    }
  }
  b.push([0, 0, 0], [0, Math.PI / 2, 0]);
  for (const side of [-1, 1]) {
    if (stony) stoneWall(b, PALETTE.rubble, depth, wallHeight, 0.36, (side * width) / 2);
    else {
      infillPanel(b, daub, depth, wallHeight, 0.36, (side * width) / 2);
      timberFrame(b, depth, wallHeight, (side * width) / 2 + side * 0.21, { braces: false });
    }
  }
  b.pop();

  const pitch = 2.9;
  gabledRoof(b, {
    length: width,
    span: depth,
    wallTop: wallHeight,
    pitch,
    eaves: 0.62,
    verge: 0.4,
    style: "thatch",
  });
  for (const side of [-1, 1]) {
    gableEnd(b, daub, depth, pitch, wallHeight, (side * width) / 2, 0.3, !stony);
  }

  // Household door in the middle, byre door with a cart-wide head at one end.
  door(b, 1.0, 2.0, depth / 2 + 0.18, { x: -1.6 });
  door(b, 2.2, 2.35, depth / 2 + 0.18, { x: width * 0.33, open: true });
  for (let i = 0; i < 4; i++) {
    shutteredWindow(
      b,
      0.5,
      0.42,
      -width * 0.4 + i * 1.7,
      wallHeight * 0.7,
      depth / 2 + 0.22,
      i < 2
    );
  }
  b.pop();

  chimney(b, -width * 0.34, 0.2, plinth + 0.8, wallTop + pitch + 0.9, 0.72);
  if (b.lod > 0) chimney(b, width * 0.06, -0.3, plinth + 1.4, wallTop + pitch + 0.5, 0.58);
}

/**
 * A barn: no plinth to speak of, no windows, and board-and-batten walls, which
 * is what you build when you need volume and do not care whether it is warm.
 */
function barn(b: Build, variant: number): void {
  const width = 10.4;
  const depth = 7.4;
  const wallTop = 3.8;
  const style = variant === 1 ? "thatch" : "shingle";

  stoneCourse(b, PALETTE.rubbleDark, width + 0.3, 0.3, depth + 0.3, 0.15, 0);
  b.push([0, 0.3, 0]);
  const wallHeight = wallTop - 0.3;

  // Vertical boarding with battens over the joints — cheap, fast, and the
  // reason a barn reads as a different class of building from a house.
  for (const side of [-1, 1]) {
    const boards = b.lod > 0 ? 22 : 8;
    for (let i = 0; i < boards; i++) {
      const w = width / boards;
      b.box(
        "plank",
        b.shade(PALETTE.plank, 0.22),
        [w * 0.98, wallHeight * b.range(0.98, 1.0), 0.12],
        [-width / 2 + (i + 0.5) * w, wallHeight / 2, (side * depth) / 2],
        [0, 0, b.wobble(0.004)]
      );
      if (b.lod > 1 && i % 2 === 0) {
        b.box(
          "timber",
          b.shade(PALETTE.oak, 0.2),
          [0.07, wallHeight, 0.06],
          [-width / 2 + i * w, wallHeight / 2, (side * depth) / 2 + side * 0.08]
        );
      }
    }
    b.box("timber", b.shade(PALETTE.oak), [width, 0.24, 0.2], [0, wallHeight - 0.12, (side * depth) / 2]);
  }
  b.push([0, 0, 0], [0, Math.PI / 2, 0]);
  for (const side of [-1, 1]) {
    infillPanel(b, PALETTE.plank, depth, wallHeight, 0.2, (side * width) / 2);
    timberFrame(b, depth, wallHeight, (side * width) / 2 + side * 0.13, { braces: true });
  }
  b.pop();

  const pitch = 3.3;
  gabledRoof(b, {
    length: width,
    span: depth,
    wallTop: wallHeight,
    pitch,
    eaves: 0.7,
    verge: 0.45,
    style,
  });
  for (const side of [-1, 1]) {
    gableEnd(b, PALETTE.plank, depth, pitch, wallHeight, (side * width) / 2, 0.24, true);
    // Owl hole. Every barn has one, and it is the only opening in the gable.
    b.box("dirt", PALETTE.soil, [0.16, 0.5, 0.4], [(side * width) / 2, wallHeight + pitch * 0.5, 0]);
  }

  // Cart doors: full height, hung on long strap hinges, one leaf standing open.
  const doorWidth = 3.4;
  b.box("timber", b.shade(PALETTE.oak), [doorWidth + 0.4, 0.26, 0.24], [0, 3.05, depth / 2 + 0.1]);
  b.box("dirt", PALETTE.soil, [doorWidth, 3.0, 0.12], [0, 1.5, depth / 2 - 0.06]);
  for (const side of [-1, 1]) {
    b.push(
      [(side * doorWidth) / 2, 0, depth / 2 + 0.12],
      [0, side > 0 ? -0.75 : 0.05, 0]
    );
    const leaf = doorWidth / 2;
    for (let i = 0; i < 5; i++) {
      b.box(
        "plank",
        b.shade(PALETTE.plankPale, 0.18),
        [leaf / 5 - 0.02, 2.95, 0.08],
        [(-side * (i + 0.5) * leaf) / 5, 1.48, 0]
      );
    }
    b.box("metal", PALETTE.iron, [leaf, 0.08, 0.04], [(-side * leaf) / 2, 0.5, 0.06]);
    b.box("metal", PALETTE.iron, [leaf, 0.08, 0.04], [(-side * leaf) / 2, 2.45, 0.06]);
    b.pop();
  }
  b.pop();

  // Lean-to along one gable, for the cart and the tools.
  if (b.lod > 0) {
    b.push([width / 2 + 1.5, 0, 0]);
    for (let i = 0; i < 4; i++) {
      b.cylinder(
        "timber",
        b.shade(PALETTE.oakPale, 0.2),
        0.1,
        0.12,
        2.2,
        6,
        [0.9, 1.1, -depth / 2 + 0.6 + i * ((depth - 1.2) / 3)],
        [b.wobble(0.02), 0, b.wobble(0.02)]
      );
    }
    b.box("shingle", b.shade(PALETTE.shingle, 0.16), [3.4, 0.14, depth], [0, 2.6, 0], [0, 0, -0.42]);
    b.pop();
  }
}

/**
 * An inn: two storeys, the upper one jettied out over the lower.
 *
 * The jetty is the whole silhouette. Cantilevering the first floor half a metre
 * past the ground floor is what medieval streets actually look like, and it
 * gives the building a shadow line no amount of surface detail can fake.
 */
function inn(b: Build): void {
  const width = 11.2;
  const depth = 8.4;
  const plinth = 0.5;
  const lower = 2.6;
  const upper = 2.5;
  const jetty = 0.42;

  stoneCourse(b, PALETTE.rubble, width + 0.6, plinth, depth + 0.6, plinth / 2, 0);
  b.push([0, plinth, 0]);

  // Ground floor: stone at the front where the carts scrape it, framed behind.
  stoneWall(b, PALETTE.rubble, width, lower, 0.4, depth / 2);
  b.push([0, 0, 0], [0, Math.PI / 2, 0]);
  for (const side of [-1, 1]) {
    stoneWall(b, PALETTE.rubble, depth, lower, 0.4, (side * width) / 2);
  }
  b.pop();
  infillPanel(b, PALETTE.daub, width, lower, 0.4, -depth / 2);
  timberFrame(b, width, lower, -depth / 2 - 0.22);

  // The jetty bressummer, then the overhanging upper storey.
  b.box("timber", b.shade(PALETTE.oak), [width + jetty * 2, 0.34, depth + jetty * 2], [0, lower + 0.17, 0]);
  b.push([0, lower + 0.34, 0]);
  const upWidth = width + jetty * 2;
  const upDepth = depth + jetty * 2;
  for (const side of [-1, 1]) {
    infillPanel(b, PALETTE.daub, upWidth, upper, 0.38, (side * upDepth) / 2);
    timberFrame(b, upWidth, upper, (side * upDepth) / 2 + side * 0.22);
  }
  b.push([0, 0, 0], [0, Math.PI / 2, 0]);
  for (const side of [-1, 1]) {
    infillPanel(b, PALETTE.daub, upDepth, upper, 0.38, (side * upWidth) / 2);
    timberFrame(b, upDepth, upper, (side * upWidth) / 2 + side * 0.22, { braces: false });
  }
  b.pop();

  const pitch = 3.4;
  gabledRoof(b, {
    length: upWidth,
    span: upDepth,
    wallTop: upper,
    pitch,
    eaves: 0.6,
    verge: 0.42,
    style: "shingle",
  });
  for (const side of [-1, 1]) {
    gableEnd(b, PALETTE.daub, upDepth, pitch, upper, (side * upWidth) / 2, 0.3, true);
  }
  for (let i = 0; i < 4; i++) {
    shutteredWindow(
      b,
      0.56,
      0.62,
      -upWidth * 0.36 + i * 2.7,
      upper * 0.56,
      upDepth / 2 + 0.22,
      i !== 2
    );
  }
  b.pop();

  door(b, 1.3, 2.15, depth / 2 + 0.22);
  shutteredWindow(b, 0.7, 0.5, -width * 0.3, lower * 0.66, depth / 2 + 0.24, true);
  shutteredWindow(b, 0.7, 0.5, width * 0.3, lower * 0.66, depth / 2 + 0.24, true);

  // The sign, on a wrought bracket. Every inn in the world has one and it is
  // the first thing anybody looks for.
  b.box("metal", PALETTE.iron, [1.5, 0.07, 0.07], [width * 0.4, lower - 0.2, depth / 2 + 0.3]);
  b.box("metal", PALETTE.iron, [0.07, 0.5, 0.06], [width * 0.4 - 0.7, lower - 0.45, depth / 2 + 0.3]);
  const signX = width * 0.4 + 0.42;
  const signY = lower - 0.62;
  const signZ = depth / 2 + 0.3;
  b.box("plank", b.shade(PALETTE.plankPale), [0.9, 0.72, 0.07], [signX, signY, signZ], [0, 0, b.wobble(0.05)]);
  b.box("metal", PALETTE.iron, [0.04, 0.24, 0.04], [width * 0.4 + 0.22, lower - 0.28, depth / 2 + 0.3]);
  b.box("metal", PALETTE.iron, [0.04, 0.24, 0.04], [width * 0.4 + 0.62, lower - 0.28, depth / 2 + 0.3]);
  // Emblem sits on the face of the board (Architecture stamps Pixelgrew here).
  b.mark("banner", [signX, signY, signZ + 0.05]);

  // Barrels and a bench by the door.
  for (let i = 0; i < 3; i++) {
    b.cylinder(
      "plank",
      b.shade(PALETTE.plank, 0.18),
      0.34,
      0.32,
      0.78,
      10,
      [-width * 0.42 + i * 0.8, 0.39, depth / 2 + 0.7],
      [0, b.range(0, 1), b.wobble(0.03)]
    );
  }
  b.box("plank", b.shade(PALETTE.plank), [2.2, 0.11, 0.42], [width * 0.1, 0.48, depth / 2 + 0.8]);
  b.box("timber", b.shade(PALETTE.oak), [0.14, 0.48, 0.38], [width * 0.1 - 0.9, 0.24, depth / 2 + 0.8]);
  b.box("timber", b.shade(PALETTE.oak), [0.14, 0.48, 0.38], [width * 0.1 + 0.9, 0.24, depth / 2 + 0.8]);

  b.pop();

  chimney(b, -width * 0.3, 0.6, plinth + 1.2, plinth + lower + upper + pitch + 1.3, 0.86);
  chimney(b, width * 0.34, -0.9, plinth + 1.6, plinth + lower + upper + pitch + 0.9, 0.7);
}

// ---------------------------------------------------------------------------
// Public and industrial
// ---------------------------------------------------------------------------

/** A chapel: stone nave running back from a west door, tower and spire. */
function chapel(b: Build): void {
  // The nave runs along Z so the west front, and its door, address the road.
  const width = 6.6;
  const length = 12.0;
  const wallTop = 4.2;

  b.push([0, 0, -0.6]);
  stoneCourse(b, PALETTE.ashlar, width + 0.6, 0.55, length + 0.6, 0.27, 0);
  b.push([0, 0.55, 0]);
  const wallHeight = wallTop - 0.55;

  b.push([0, 0, 0], [0, Math.PI / 2, 0]);
  for (const side of [-1, 1]) {
    stoneWall(b, PALETTE.ashlar, length, wallHeight, 0.44, (side * width) / 2);
  }
  b.pop();
  for (const side of [-1, 1]) {
    stoneWall(b, PALETTE.ashlar, width, wallHeight, 0.44, (side * length) / 2);
  }

  // Buttresses. A stone wall this tall without them is a wall that fell down.
  for (let i = 0; i < 3; i++) {
    const z = -length * 0.3 + i * (length * 0.3);
    for (const side of [-1, 1]) {
      b.box(
        "stone",
        b.shade(PALETTE.ashlar, 0.1),
        [0.5, wallHeight * 0.78, 0.7],
        [(side * (width + 0.5)) / 2, wallHeight * 0.39, z]
      );
      b.box(
        "stone",
        b.shade(PALETTE.ashlar, 0.1),
        [0.5, 0.42, 0.7],
        [(side * (width + 0.42)) / 2, wallHeight * 0.78, z],
        [0, 0, side * 0.5]
      );
    }
  }

  b.push([0, 0, 0], [0, Math.PI / 2, 0]);
  gabledRoof(b, {
    length,
    span: width,
    wallTop: wallHeight,
    pitch: 2.8,
    eaves: 0.42,
    verge: 0.3,
    style: "slate",
  });
  b.pop();
  for (const side of [-1, 1]) {
    b.prism(
      "stone",
      b.shade(PALETTE.ashlar, 0.08),
      [width, 2.8, 0.44],
      [0, wallHeight, (side * length) / 2],
      [0, Math.PI / 2, 0]
    );
  }

  // Lancets down both flanks, and the tall east window.
  for (let i = 0; i < 4; i++) {
    const z = -length * 0.32 + i * (length * 0.22);
    for (const side of [-1, 1]) {
      b.push([(side * width) / 2 + side * 0.24, 0, z], [0, (side * Math.PI) / 2, 0]);
      shutteredWindow(b, 0.4, 1.15, 0, wallHeight * 0.6, 0, true);
      b.pop();
    }
  }
  // The east window. Lit first and brightest of anything in the valley — the
  // chapel is the one building that is *supposed* to be showing off at dusk —
  // and unmarked, because the lancets down the flanks already gave the light
  // pool a spill for this building.
  b.box("window", lampPane(0.14, 1.3), [1.5, 2.3, 0.1], [0, wallHeight * 0.58, -length / 2 - 0.2]);

  // West door, arched.
  door(b, 1.35, 2.4, length / 2 + 0.24, { open: false });
  b.cylinder(
    "stone",
    b.shade(PALETTE.ashlar, 0.08),
    0.85,
    0.85,
    0.4,
    12,
    [0, 2.55, length / 2 + 0.2],
    [Math.PI / 2, 0, 0]
  );
  // A hanging banner beside the west door.
  hangingBanner(b, 0.9, 1.55, 1.55, wallHeight * 0.52, length / 2 + 0.42);
  b.pop();
  b.pop();

  // The tower, standing against the west front, with a broach spire.
  b.push([0, 0, 5.1]);
  const towerWidth = 3.0;
  const towerTop = 8.4;
  stoneCourse(b, PALETTE.ashlar, towerWidth + 0.5, 0.55, towerWidth + 0.5, 0.27, 0);
  b.push([0, 0.55, 0]);
  b.push([0, 0, 0], [0, Math.PI / 2, 0]);
  for (const side of [-1, 1]) {
    stoneWall(b, PALETTE.ashlar, towerWidth, towerTop, 0.4, (side * towerWidth) / 2);
  }
  b.pop();
  for (const side of [-1, 1]) {
    stoneWall(b, PALETTE.ashlar, towerWidth, towerTop, 0.4, (side * towerWidth) / 2);
  }
  // Belfry openings, all four faces.
  for (let i = 0; i < 4; i++) {
    b.push([0, 0, 0], [0, (i * Math.PI) / 2, 0]);
    b.box("dirt", PALETTE.soil, [0.62, 1.0, 0.14], [0, towerTop - 1.2, towerWidth / 2 + 0.16]);
    b.box("timber", b.shade(PALETTE.oak), [0.72, 0.14, 0.2], [0, towerTop - 0.65, towerWidth / 2 + 0.18]);
    b.pop();
  }
  // Corbel course, then the spire.
  b.box("stone", b.shade(PALETTE.ashlar, 0.08), [towerWidth + 0.42, 0.24, towerWidth + 0.42], [0, towerTop + 0.12, 0]);
  // Slate is a roof *style*, not a draw bucket — `roof()` renders it into the
  // shingle bucket too. The colour is what makes it read as slate.
  b.cylinder("shingle", b.shade(PALETTE.slate, 0.12), 0, towerWidth * 0.79, 5.2, 4, [0, towerTop + 2.72, 0], [0, Math.PI / 4, 0]);
  b.cylinder("metal", PALETTE.iron, 0.04, 0.05, 0.9, 5, [0, towerTop + 5.7, 0]);
  b.box("metal", PALETTE.iron, [0.42, 0.06, 0.06], [0, towerTop + 5.95, 0]);
  b.pop();
  b.pop();
}

/**
 * A forge. Three walls, an open front, and a hearth that is the brightest thing
 * in the valley after the sun.
 */
function forge(b: Build): void {
  const width = 7.2;
  const depth = 6.0;
  const wallTop = 3.2;

  stoneCourse(b, PALETTE.rubbleDark, width + 0.4, 0.4, depth + 0.4, 0.2, 0);
  b.push([0, 0.4, 0]);
  const wallHeight = wallTop - 0.4;

  stoneWall(b, PALETTE.rubbleDark, width, wallHeight, 0.42, -depth / 2);
  b.push([0, 0, 0], [0, Math.PI / 2, 0]);
  for (const side of [-1, 1]) {
    stoneWall(b, PALETTE.rubbleDark, depth, wallHeight, 0.42, (side * width) / 2);
  }
  b.pop();

  // The open front: two heavy posts and a bressummer, nothing else.
  for (const side of [-1, 1]) {
    b.cylinder(
      "timber",
      b.shade(PALETTE.oak),
      0.19,
      0.23,
      wallHeight,
      8,
      [side * (width / 2 - 0.4), wallHeight / 2, depth / 2 - 0.2]
    );
  }
  b.box("timber", b.shade(PALETTE.oak), [width - 0.4, 0.34, 0.32], [0, wallHeight - 0.17, depth / 2 - 0.2]);

  gabledRoof(b, {
    length: width,
    span: depth,
    wallTop: wallHeight,
    pitch: 2.2,
    eaves: 0.66,
    verge: 0.4,
    style: "shingle",
  });
  for (const side of [-1, 1]) {
    b.prism("stone", b.shade(PALETTE.rubbleDark, 0.12), [0.4, 2.2, depth], [(side * width) / 2, wallHeight, 0]);
  }

  // Hearth: a stone box with a fire in it, lighting the back wall.
  b.box("stone", b.shade(PALETTE.rubbleDark, 0.1), [2.4, 0.9, 1.3], [-1.1, 0.45, -depth / 2 + 0.9]);
  b.box("glow", PALETTE.ember, [1.5, 0.4, 0.8], [-1.1, 0.9, -depth / 2 + 0.9]);
  b.mark("fire", [-1.1, 1.2, -depth / 2 + 0.9]);
  // Bellows, and the quench trough.
  b.box("plank", b.shade(PALETTE.plank, 0.16), [1.0, 0.42, 0.7], [-2.6, 1.0, -depth / 2 + 1.5], [0, 0, -0.18]);
  b.cylinder("plank", b.shade(PALETTE.plank, 0.16), 0.4, 0.38, 0.55, 10, [1.9, 0.28, -1.2]);

  // Anvil on a block, tools on the wall.
  b.cylinder("timber", b.shade(PALETTE.oakPale, 0.2), 0.34, 0.36, 0.62, 9, [1.2, 0.31, 0.9]);
  b.box("metal", PALETTE.iron, [0.72, 0.2, 0.26], [1.2, 0.72, 0.9], [0, 0.3, 0]);
  b.box("metal", PALETTE.iron, [0.24, 0.2, 0.24], [1.55, 0.72, 0.9], [0, 0.3, 0]);
  if (b.lod > 0) {
    for (let i = 0; i < 5; i++) {
      b.box(
        "metal",
        PALETTE.iron,
        [0.06, b.range(0.4, 0.8), 0.06],
        [-2.4 + i * 0.32, wallHeight * 0.62, -depth / 2 + 0.28],
        [0, 0, b.wobble(0.12)]
      );
    }
  }
  b.pop();

  chimney(b, -1.1, -depth / 2 + 0.9, 1.6, wallTop + 2.6, 1.0);
}

/**
 * A tower mill. The cap and sails turn; the tower does not.
 *
 * Only the tower and the stage are built here — the sails are a separate
 * assembly so `Architecture.tsx` can spin them, which is the one piece of this
 * whole file that has to move.
 */
function windmill(b: Build): void {
  const height = 8.6;
  const courses = b.lod > 0 ? 16 : 8;

  for (let i = 0; i < courses; i++) {
    const t = i / courses;
    const radius = 2.5 - t * 0.85;
    const blocks = b.lod > 0 ? 14 : 8;
    for (let j = 0; j < blocks; j++) {
      const angle = (j / blocks) * Math.PI * 2 + i * 0.21;
      b.box(
        "stone",
        b.shade(PALETTE.rubble, 0.17),
        [(radius * 2 * Math.PI) / blocks, (height / courses) * 0.97, 0.44],
        [Math.cos(angle) * radius, (i + 0.5) * (height / courses), Math.sin(angle) * radius],
        [0, -angle, 0]
      );
    }
  }

  // Reefing stage, on brackets.
  b.cylinder("plank", b.shade(PALETTE.plank, 0.12), 2.9, 2.9, 0.14, 16, [0, height * 0.42, 0]);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    b.box(
      "timber",
      b.shade(PALETTE.oak, 0.18),
      [0.1, 0.72, 0.12],
      [Math.cos(angle) * 2.75, height * 0.42 + 0.4, Math.sin(angle) * 2.75],
      [0, -angle, 0]
    );
    b.box(
      "timber",
      b.shade(PALETTE.oak, 0.18),
      [0.9, 0.1, 0.1],
      [Math.cos(angle) * 2.3, height * 0.42 - 0.32, Math.sin(angle) * 2.3],
      [0, -angle, 0.5]
    );
  }

  // Boat-shaped cap.
  b.cylinder("shingle", b.shade(PALETTE.shingle, 0.12), 1.5, 1.75, 0.5, 14, [0, height + 0.25, 0]);
  b.sphere("shingle", b.shade(PALETTE.shingle, 0.1), [1.6, 1.15, 1.6], [0, height + 0.5, 0]);
  // Tail pole, which is how the cap gets turned into the wind.
  b.cylinder("timber", b.shade(PALETTE.oak), 0.07, 0.11, 6.2, 6, [0, height - 0.9, -2.6], [0.72, 0, 0]);

  door(b, 1.0, 2.0, 2.32);
  for (let i = 0; i < 3; i++) {
    b.push([0, 0, 0], [0, b.range(0, 6.28), 0]);
    shutteredWindow(b, 0.42, 0.5, 0, 2.4 + i * 2.1, 2.2 - i * 0.24, i === 0);
    b.pop();
  }

  b.mark("sailHub", [0, height + 0.55, 1.5]);
}

/** The sail assembly, built about its own axis so it can be spun. */
function windmillSails(b: Build): void {
  b.cylinder("timber", b.shade(PALETTE.oak), 0.2, 0.26, 0.9, 8, [0, 0, 0], [Math.PI / 2, 0, 0]);
  b.cylinder("metal", PALETTE.iron, 0.28, 0.28, 0.2, 10, [0, 0, -0.3], [Math.PI / 2, 0, 0]);

  for (let arm = 0; arm < 4; arm++) {
    const angle = (arm / 4) * Math.PI * 2;
    b.push([0, 0, 0], [0, 0, angle]);
    const length = 6.4;
    // Whip: the main spar, tapering to the tip.
    b.box("timber", b.shade(PALETTE.oak, 0.12), [0.16, length, 0.14], [0, length / 2 + 0.5, 0]);
    // Sail bars and the cloth-bearing lattice.
    const bars = b.lod > 0 ? 11 : 6;
    for (let i = 1; i <= bars; i++) {
      const y = 0.7 + (i / bars) * (length - 0.4);
      const w = 1.35 * (1 - (i / bars) * 0.22);
      b.box("timber", b.shade(PALETTE.oakPale, 0.18), [w, 0.08, 0.07], [w * 0.28, y, 0.06]);
    }
    b.box("timber", b.shade(PALETTE.oakPale, 0.14), [0.07, length - 0.4, 0.07], [0.95, length / 2 + 0.7, 0.06]);
    // Canvas, furled over the outer half only — a mill under full sail in a
    // still valley would be the odd thing, not the other way round.
    b.box(
      "cloth",
      b.shade(PALETTE.clothCream, 0.1),
      [1.0, length * 0.52, 0.03],
      [0.5, length * 0.72, 0.09],
      [0, 0, 0.02]
    );
    b.pop();
  }
}

/** A watchtower: battered stone base, timber hoarding, broken crenellation. */
function watchtower(b: Build, variant: number): void {
  const height = variant === 1 ? 6.4 : 8.2;
  const courses = b.lod > 0 ? Math.round(height / 0.46) : Math.round(height / 0.9);

  for (let i = 0; i < courses; i++) {
    const t = i / courses;
    // Battered: wider at the foot, which is both how they were built and what
    // stops a cylinder reading as a piece of pipe.
    const radius = 2.35 - t * 0.45;
    const blocks = b.lod > 0 ? 13 : 8;
    for (let j = 0; j < blocks; j++) {
      const angle = (j / blocks) * Math.PI * 2 + i * 0.29;
      b.box(
        "stone",
        b.shade(PALETTE.rubble, 0.19),
        [(radius * 2 * Math.PI) / blocks, (height / courses) * 0.96, 0.5],
        [
          Math.cos(angle) * radius,
          (i + 0.5) * (height / courses),
          Math.sin(angle) * radius,
        ],
        [0, -angle, b.wobble(0.02)]
      );
    }
  }

  // Merlons, with two knocked out.
  const merlons = 10;
  for (let i = 0; i < merlons; i++) {
    if (i === 3 || i === 7) continue;
    const angle = (i / merlons) * Math.PI * 2;
    b.box(
      "stone",
      b.shade(PALETTE.rubble, 0.16),
      [0.85, b.range(0.7, 1.0), 0.46],
      [Math.cos(angle) * 1.95, height + 0.4, Math.sin(angle) * 1.95],
      [0, -angle, b.wobble(0.03)]
    );
  }

  // Timber hoarding on one face, and the ladder up to it.
  if (b.lod > 0) {
    b.push([0, height - 0.2, 1.9]);
    b.box("plank", b.shade(PALETTE.plank, 0.16), [2.6, 1.5, 0.14], [0, 0.75, 0.5]);
    b.box("shingle", b.shade(PALETTE.shingle, 0.14), [3.0, 0.12, 1.4], [0, 1.6, 0.2], [0.35, 0, 0]);
    for (const side of [-1, 1]) {
      b.box("timber", b.shade(PALETTE.oak), [0.14, 1.6, 0.6], [side * 1.3, 0.8, 0.3]);
    }
    b.pop();
  }

  door(b, 0.9, 1.9, 2.16);
  // Banner over the approach — the tower's claim on the road below.
  hangingBanner(b, 0.95, 1.55, 0, 3.35, 2.55);
  for (let i = 0; i < 4; i++) {
    b.push([0, 0, 0], [0, i * 1.9, 0]);
    b.box("dirt", PALETTE.soil, [0.16, 0.8, 0.16], [0, 2.6 + (i % 2) * 2.2, 2.1]);
    b.pop();
  }
}

/** A lighthouse: a tapered tower with a lamp that never goes out. */
function lighthouse(b: Build): void {
  const height = 10.5;
  const courses = b.lod > 0 ? 22 : 11;
  for (let i = 0; i < courses; i++) {
    const t = i / courses;
    const radius = 2.2 - t * 0.95;
    const blocks = b.lod > 0 ? 12 : 7;
    for (let j = 0; j < blocks; j++) {
      const angle = (j / blocks) * Math.PI * 2 + i * 0.33;
      b.box(
        "stone",
        b.shade(i % 6 < 3 ? PALETTE.ashlar : PALETTE.rubbleDark, 0.12),
        [(radius * 2 * Math.PI) / blocks, (height / courses) * 0.96, 0.42],
        [Math.cos(angle) * radius, (i + 0.5) * (height / courses), Math.sin(angle) * radius],
        [0, -angle, 0]
      );
    }
  }
  // Gallery, lantern room, and the lamp.
  b.cylinder("plank", b.shade(PALETTE.plank, 0.12), 1.9, 1.9, 0.16, 14, [0, height + 0.08, 0]);
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    b.box("metal", PALETTE.iron, [0.05, 0.7, 0.05], [Math.cos(angle) * 1.78, height + 0.5, Math.sin(angle) * 1.78]);
  }
  b.cylinder("metal", PALETTE.iron, 1.2, 1.2, 0.1, 12, [0, height + 0.9, 0]);
  b.cylinder("glow", PALETTE.lamp, 1.0, 1.0, 1.5, 12, [0, height + 1.7, 0]);
  b.cylinder("shingle", b.shade(PALETTE.slate), 0, 1.4, 1.2, 12, [0, height + 3.05, 0]);
  b.mark("fire", [0, height + 1.7, 0]);
  door(b, 0.9, 1.9, 2.0);
}

/**
 * A quarry face: benches cut into the hillside, spoil below, and a derrick.
 * The terrain has no hole in it, so the face is built as stepped stone standing
 * on the ground rather than cut into it — from any angle a person walks past,
 * the read is identical.
 */
function quarry(b: Build, variant: number): void {
  const benches = 3 + variant;
  for (let i = 0; i < benches; i++) {
    const t = i / benches;
    const width = 13 - i * 2.2;
    const y = i * 1.6;
    const blocks = b.lod > 0 ? Math.round(width / 1.1) : Math.round(width / 2.2);
    for (let j = 0; j < blocks; j++) {
      b.box(
        "stone",
        b.shade(PALETTE.rubbleWarm, 0.22),
        [width / blocks + b.range(0, 0.3), 1.6 * b.range(0.9, 1.1), b.range(1.6, 2.6)],
        [
          -width / 2 + (j + 0.5) * (width / blocks),
          y + 0.8,
          -3 + t * 3.4 + b.wobble(0.3),
        ],
        [b.wobble(0.05), b.wobble(0.2), b.wobble(0.05)]
      );
    }
  }
  // Spoil, cut blocks waiting to go, and a shear-legs derrick over them.
  for (let i = 0; i < (b.lod > 0 ? 16 : 7); i++) {
    b.rock(
      "dirt",
      b.shade(PALETTE.rubbleWarm, 0.26),
      [b.range(0.3, 0.9), b.range(0.2, 0.5), b.range(0.3, 0.9)],
      [b.range(-6, 6), 0.2, b.range(2, 6)],
      [b.range(0, 3), b.range(0, 3), b.range(0, 3)]
    );
  }
  for (let i = 0; i < 4; i++) {
    b.box(
      "stone",
      b.shade(PALETTE.ashlar, 0.1),
      [1.1, 0.7, 0.8],
      [-4 + i * 1.3, 0.35, 4.6],
      [0, b.wobble(0.16), 0]
    );
  }
  for (const side of [-1, 1]) {
    b.cylinder("timber", b.shade(PALETTE.oak), 0.11, 0.15, 6.4, 7, [side * 1.5 + 3, 3.0, 4.4], [0, 0, -side * 0.22]);
  }
  b.box("timber", b.shade(PALETTE.oak), [3.4, 0.16, 0.16], [3, 6.1, 4.4]);
  b.cylinder("metal", PALETTE.iron, 0.02, 0.02, 3.2, 4, [3, 4.5, 4.4]);
  b.box("timber", b.shade(PALETTE.oakPale), [0.5, 0.16, 0.5], [3, 2.95, 4.4]);
}

// ---------------------------------------------------------------------------
// Road furniture, yards and the outdoors
// ---------------------------------------------------------------------------

/** A well: stone rim, windlass, and a little roof over it. */
function well(b: Build, variant: number): void {
  const blocks = b.lod > 0 ? 14 : 8;
  for (let i = 0; i < blocks; i++) {
    const angle = (i / blocks) * Math.PI * 2;
    for (let c = 0; c < 2; c++) {
      b.box(
        "stone",
        b.shade(PALETTE.rubble, 0.2),
        [(1.0 * 2 * Math.PI) / blocks, 0.34, 0.42],
        [Math.cos(angle) * 1.0, 0.17 + c * 0.34, Math.sin(angle) * 1.0],
        [0, -angle, b.wobble(0.04)]
      );
    }
  }
  b.cylinder("dirt", PALETTE.soil, 0.78, 0.78, 0.1, 12, [0, 0.6, 0]);

  for (const side of [-1, 1]) {
    b.cylinder("timber", b.shade(PALETTE.oak), 0.08, 0.1, 2.1, 7, [side * 0.9, 1.05, 0], [0, 0, b.wobble(0.03)]);
  }
  b.cylinder("timber", b.shade(PALETTE.oakPale), 0.1, 0.1, 1.9, 8, [0, 1.85, 0], [0, 0, Math.PI / 2]);
  b.box("metal", PALETTE.iron, [0.06, 0.34, 0.06], [1.0, 2.0, 0], [0, 0, 0.5]);

  if (variant === 0) {
    // Pitched shingle roof on the two posts.
    b.push([0, 2.0, 0]);
    for (const side of [-1, 1]) {
      b.box("shingle", b.shade(PALETTE.shingle, 0.16), [2.3, 0.1, 1.0], [0, 0.32, side * 0.44], [side * 0.62, 0, 0]);
    }
    b.box("timber", b.shade(PALETTE.oak), [2.4, 0.1, 0.1], [0, 0.62, 0]);
    b.pop();
  }
  // The bucket, hanging.
  b.cylinder("plank", b.shade(PALETTE.plank, 0.16), 0.2, 0.17, 0.28, 8, [0, 1.35, 0.05]);
  b.box("metal", PALETTE.iron, [0.02, 0.5, 0.02], [0, 1.62, 0.05]);
}

/** A market stall: four posts, a striped awning, a counter and wares. */
function marketStall(b: Build, variant: number): void {
  const cloth = variant === 0 ? PALETTE.clothRed : PALETTE.clothBlue;
  const width = 3.2;
  const depth = 2.2;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.cylinder(
        "timber",
        b.shade(PALETTE.oakPale, 0.18),
        0.06,
        0.075,
        2.3,
        6,
        [(sx * width) / 2, 1.15, (sz * depth) / 2],
        [b.wobble(0.02), 0, b.wobble(0.02)]
      );
    }
  }
  b.box("timber", b.shade(PALETTE.oak), [width + 0.2, 0.09, 0.09], [0, 2.3, -depth / 2]);
  b.box("timber", b.shade(PALETTE.oak), [width + 0.2, 0.09, 0.09], [0, 2.05, depth / 2]);

  // Awning: two shallow planes with a sag between them, striped by alternating
  // panels rather than by a texture.
  const strips = b.lod > 0 ? 7 : 4;
  for (let i = 0; i < strips; i++) {
    const x = -width / 2 + (i + 0.5) * (width / strips);
    const shade = i % 2 === 0 ? cloth : PALETTE.clothCream;
    b.box("cloth", b.shade(shade, 0.1), [width / strips - 0.01, 0.04, depth * 0.62], [x, 2.36, -depth * 0.26], [-0.22, 0, 0]);
    b.box("cloth", b.shade(shade, 0.1), [width / strips - 0.01, 0.04, depth * 0.58], [x, 2.14, depth * 0.28], [0.3, 0, 0]);
  }

  // Counter and goods.
  b.box("plank", b.shade(PALETTE.plank, 0.14), [width, 0.09, 0.85], [0, 1.0, depth * 0.22]);
  b.box("timber", b.shade(PALETTE.oak), [0.1, 1.0, 0.1], [-width / 2 + 0.2, 0.5, depth * 0.22]);
  b.box("timber", b.shade(PALETTE.oak), [0.1, 1.0, 0.1], [width / 2 - 0.2, 0.5, depth * 0.22]);
  for (let i = 0; i < 3; i++) {
    b.box(
      "plank",
      b.shade(PALETTE.plankPale, 0.2),
      [b.range(0.3, 0.44), b.range(0.22, 0.34), b.range(0.3, 0.42)],
      [-1.0 + i * 0.75, 1.16, depth * 0.2 + b.wobble(0.1)],
      [0, b.wobble(0.3), 0]
    );
  }
  for (let i = 0; i < 4; i++) {
    b.sphere(
      "hay",
      b.shade(i % 2 ? PALETTE.hay : PALETTE.moss, 0.2),
      [0.11, 0.11, 0.11],
      [0.5 + i * 0.18, 1.11, depth * 0.34]
    );
  }
  b.cylinder("plank", b.shade(PALETTE.plank, 0.18), 0.3, 0.28, 0.66, 9, [-width / 2 - 0.2, 0.33, -depth * 0.2]);
}

/** A signpost: a post, an arm or two, and moss on the north side. */
function signpost(b: Build, variant: number): void {
  b.cylinder("timber", b.shade(PALETTE.oakPale, 0.2), 0.075, 0.095, 2.4, 7, [0, 1.2, 0], [b.wobble(0.035), 0, b.wobble(0.035)]);
  b.cylinder("timber", b.shade(PALETTE.oak), 0.11, 0.11, 0.14, 7, [0, 2.4, 0]);
  const arms = variant === 0 ? 1 : 2;
  for (let i = 0; i < arms; i++) {
    const angle = i === 0 ? b.range(-0.4, 0.4) : b.range(2.3, 3.2);
    b.push([0, 2.05 - i * 0.34, 0], [0, angle, 0]);
    b.box("plank", b.shade(PALETTE.plankPale, 0.16), [0.86, 0.2, 0.05], [0.5, 0, 0], [0, 0, b.wobble(0.05)]);
    // Pointed end, made by cocking a second board across the tip.
    b.box("plank", b.shade(PALETTE.plankPale, 0.16), [0.16, 0.16, 0.05], [0.93, 0, 0], [0, 0, Math.PI / 4]);
    b.pop();
  }
  if (b.lod > 0) {
    b.box("hay", b.shade(PALETTE.moss, 0.24), [0.13, 0.5, 0.04], [0, 0.5, -0.09]);
  }
}

/** A shrine: a cairn, a carved slab, and whatever people have left on it. */
function shrine(b: Build, variant: number): void {
  const stones = b.lod > 0 ? 12 : 6;
  for (let i = 0; i < stones; i++) {
    const t = i / stones;
    b.rock(
      "stone",
      b.shade(PALETTE.rubbleDark, 0.2),
      [b.range(0.3, 0.55) * (1 - t * 0.4), b.range(0.2, 0.35), b.range(0.3, 0.55) * (1 - t * 0.4)],
      [b.range(-0.6, 0.6) * (1 - t), 0.15 + t * 0.9, b.range(-0.6, 0.6) * (1 - t)],
      [b.range(0, 3), b.range(0, 3), b.range(0, 3)]
    );
  }
  b.box(
    "stone",
    b.shade(PALETTE.ashlar, 0.1),
    [0.62, 1.5, 0.24],
    [0, 1.55, 0.1],
    [b.wobble(0.06), b.wobble(0.2), b.wobble(0.05)]
  );
  b.box("dirt", PALETTE.soil, [0.34, 0.5, 0.06], [0, 1.8, 0.23]);

  if (variant === 1) {
    // A little pent roof over it, on two stakes.
    for (const side of [-1, 1]) {
      b.cylinder("timber", b.shade(PALETTE.oakPale, 0.2), 0.05, 0.06, 2.3, 6, [side * 0.75, 1.15, 0.1]);
    }
    b.box("shingle", b.shade(PALETTE.shingle, 0.16), [1.9, 0.08, 0.9], [0, 2.36, 0.1], [0.28, 0, 0]);
  }
  if (b.lod > 0) {
    for (let i = 0; i < 3; i++) {
      b.sphere("hay", b.shade(PALETTE.moss, 0.24), [0.09, 0.07, 0.09], [b.range(-0.4, 0.4), 1.02, 0.4]);
    }
  }
}

/** A ruined tower. The jagged crown is what makes it read as broken. */
function ruin(b: Build, variant: number): void {
  const height = variant === 0 ? 6.0 : 2.4;
  const courses = b.lod > 0 ? Math.round(height / 0.44) : Math.round(height / 0.9);
  const blocks = b.lod > 0 ? 13 : 8;

  for (let i = 0; i < courses; i++) {
    const t = i / courses;
    const radius = 2.6 - t * 0.3;
    // The top courses are eaten away around one side, so the wall head is a
    // broken line rather than a cut one.
    const survives = 1 - t;
    for (let j = 0; j < blocks; j++) {
      const angle = (j / blocks) * Math.PI * 2 + i * 0.27;
      const wear = 0.5 + 0.5 * Math.sin(angle * 1.4 + 1.1);
      if (wear < 1 - survives * 1.35) continue;
      b.box(
        "stone",
        b.shade(PALETTE.rubbleDark, 0.22),
        [(radius * 2 * Math.PI) / blocks, (height / courses) * b.range(0.85, 1), 0.52],
        [Math.cos(angle) * radius, (i + 0.5) * (height / courses), Math.sin(angle) * radius],
        [b.wobble(0.04), -angle, b.wobble(0.05)]
      );
    }
  }

  if (variant === 0) {
    // A doorway that still has its arch, which is always the last thing to go.
    b.box("dirt", PALETTE.soil, [1.3, 2.2, 0.7], [0, 1.1, 2.3]);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.08 + (i / 6) * 0.84);
      b.box(
        "stone",
        b.shade(PALETTE.ashlar, 0.14),
        [0.32, 0.42, 0.62],
        [Math.cos(a) * 0.78, 2.2 + Math.sin(a) * 0.78, 2.42],
        [0, 0, a - Math.PI / 2]
      );
    }
  }

  const rubble = b.lod > 0 ? 18 : 8;
  for (let i = 0; i < rubble; i++) {
    const angle = b.range(0, Math.PI * 2);
    const distance = b.range(2.6, 6.2);
    b.rock(
      "stone",
      b.shade(PALETTE.rubbleDark, 0.24),
      [b.range(0.25, 0.7), b.range(0.15, 0.45), b.range(0.25, 0.7)],
      [Math.cos(angle) * distance, 0.14, Math.sin(angle) * distance],
      [b.range(0, 3), b.range(0, 3), b.range(0, 3)]
    );
  }
  if (b.lod > 0) {
    for (let i = 0; i < 6; i++) {
      b.sphere("hay", b.shade(PALETTE.moss, 0.26), [b.range(0.2, 0.4), 0.1, b.range(0.2, 0.4)], [b.range(-3, 3), 0.06, b.range(-3, 3)]);
    }
  }
}

/** A stone circle. The layout has to match `structureColliders`. */
function standingStones(b: Build): void {
  for (let i = 0; i < STONE_RING_COUNT; i++) {
    const angle = (i / STONE_RING_COUNT) * Math.PI * 2;
    const wobble = Math.sin(i * 3.7) * 0.4;
    const radius = STONE_RING_RADIUS + wobble;
    const height = 2.9 + Math.abs(Math.sin(i * 5.1)) * 2.3;
    const width = 0.72 + Math.abs(Math.cos(i * 4.4)) * 0.5;
    const fallen = i === STONE_FALLEN_INDEX;

    b.push(
      [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
      fallen
        ? [Math.PI / 2.1, Math.cos(i * 1.9) * 0.9, Math.sin(i * 2.3) * 0.14]
        : [Math.sin(i * 2.3) * 0.13, Math.cos(i * 1.9) * 0.9, Math.sin(i * 2.3) * 0.08]
    );
    // Tapered and faceted: weathering narrows the exposed end, and a smooth
    // cylinder reads as a bollard.
    b.cylinder(
      "stone",
      b.shade(PALETTE.rubbleDark, 0.14),
      width * 0.74,
      width,
      height,
      6,
      [0, fallen ? 0.42 : height / 2, 0]
    );
    b.pop();
  }
  b.box("stone", b.shade(PALETTE.rubbleDark, 0.1), [2.4, 0.68, 1.4], [0, 0.34, 0], [b.wobble(0.03), 0, b.wobble(0.02)]);
  if (b.lod > 0) {
    for (let i = 0; i < 8; i++) {
      const angle = b.range(0, Math.PI * 2);
      b.rock("stone", b.shade(PALETTE.rubbleDark, 0.2), [b.range(0.2, 0.4), 0.16, b.range(0.2, 0.4)], [Math.cos(angle) * b.range(1.6, 5), 0.08, Math.sin(angle) * b.range(1.6, 5)], [b.range(0, 3), b.range(0, 3), b.range(0, 3)]);
    }
  }
}

/** A camp: a banked fire, two tents, a tripod and somebody's bedding. */
function camp(b: Build): void {
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    b.rock(
      "stone",
      b.shade(PALETTE.rubbleDark, 0.2),
      [0.24, 0.18, 0.24],
      [Math.cos(angle) * 0.85, 0.1, Math.sin(angle) * 0.85],
      [b.range(0, 3), b.range(0, 3), b.range(0, 3)]
    );
  }
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    b.cylinder(
      "timber",
      b.shade(PALETTE.oak, 0.2),
      0.055,
      0.075,
      0.95,
      6,
      [Math.cos(angle) * 0.24, 0.32, Math.sin(angle) * 0.24],
      [Math.cos(angle) * 0.5, 0, -Math.sin(angle) * 0.5]
    );
  }
  b.sphere("glow", PALETTE.ember, [0.3, 0.16, 0.3], [0, 0.14, 0]);
  b.mark("fire", [0, 0.5, 0]);

  // Tripod over the fire, with a pot.
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.4;
    b.cylinder("timber", b.shade(PALETTE.oakPale, 0.18), 0.035, 0.05, 2.0, 5, [Math.cos(angle) * 0.55, 0.95, Math.sin(angle) * 0.55], [Math.cos(angle) * 0.55, 0, -Math.sin(angle) * 0.55]);
  }
  b.sphere("metal", PALETTE.iron, [0.24, 0.2, 0.24], [0, 0.72, 0]);
  b.box("metal", PALETTE.iron, [0.02, 0.5, 0.02], [0, 1.15, 0]);

  // Two tents, guyed off, at a respectful distance from the sparks.
  for (let t = 0; t < 2; t++) {
    const angle = t === 0 ? b.range(0.6, 1.2) : b.range(3.4, 4.2);
    const distance = b.range(1.9, 2.4);
    b.push([Math.cos(angle) * distance, 0, Math.sin(angle) * distance], [0, b.range(0, 6.28), 0]);
    b.prism("cloth", b.shade(t === 0 ? PALETTE.clothCream : PALETTE.daubGrey, 0.12), [2.2, 1.35, 1.8], [0, 0, 0]);
    b.cylinder("timber", b.shade(PALETTE.oakPale), 0.05, 0.05, 2.5, 5, [0, 1.35, 0], [0, 0, Math.PI / 2]);
    for (const side of [-1, 1]) {
      b.cylinder("timber", b.shade(PALETTE.oakPale), 0.035, 0.035, 1.6, 5, [side * 1.15, 0.8, 0]);
      b.box("cloth", b.shade(PALETTE.clothCream, 0.16), [0.03, 0.03, 1.2], [side * 1.5, 0.75, 0], [0, 0, side * 0.5]);
    }
    b.pop();
  }

  if (b.lod > 0) {
    b.cylinder("cloth", b.shade(PALETTE.clothCream, 0.14), 0.22, 0.22, 1.3, 7, [1.5, 0.22, 0.5], [0, 0.5, Math.PI / 2]);
    b.box("plank", b.shade(PALETTE.plank, 0.18), [1.6, 0.36, 0.4], [-1.7, 0.2, 0.9], [0, b.range(0, 1), 0]);
  }
}

/** A staithe: piles into the water, a plank deck, and something tied to it. */
function dock(b: Build): void {
  const length = 12.0;
  const width = 2.6;
  const deck = 0.95;

  const bays = 7;
  for (let i = 0; i <= bays; i++) {
    const z = -length / 2 + (i / bays) * length;
    for (const side of [-1, 1]) {
      b.cylinder(
        "timber",
        b.shade(PALETTE.oak, 0.2),
        0.11,
        0.13,
        3.4,
        6,
        [(side * width) / 2, deck - 1.7, z],
        [b.wobble(0.03), 0, b.wobble(0.03)]
      );
    }
    b.box("timber", b.shade(PALETTE.oak, 0.16), [width + 0.2, 0.14, 0.14], [0, deck - 0.11, z]);
  }
  const boards = b.lod > 0 ? 26 : 13;
  for (let i = 0; i < boards; i++) {
    b.box(
      "plank",
      b.shade(PALETTE.plank, 0.2),
      [width, 0.075, length / boards - 0.02],
      [0, deck + b.wobble(0.012), -length / 2 + (i + 0.5) * (length / boards)],
      [b.wobble(0.008), 0, b.wobble(0.006)]
    );
  }
  // Mooring posts at the far end, and a coil of rope.
  for (const side of [-1, 1]) {
    b.cylinder("timber", b.shade(PALETTE.oak, 0.14), 0.14, 0.16, 1.5, 7, [(side * width) / 2, deck + 0.6, -length / 2 + 0.4]);
    b.cylinder("metal", PALETTE.iron, 0.16, 0.16, 0.05, 8, [(side * width) / 2, deck + 1.2, -length / 2 + 0.4], [Math.PI / 2, 0, 0]);
  }
  b.cylinder("cloth", b.shade(PALETTE.clothCream, 0.16), 0.3, 0.34, 0.12, 10, [0.5, deck + 0.1, -length / 2 + 1.2]);
  // A punt alongside, half full of reeds.
  b.push([width / 2 + 1.1, deck - 0.95, 1.4], [0, b.range(-0.15, 0.15), 0]);
  b.box("plank", b.shade(PALETTE.plank, 0.14), [1.0, 0.34, 4.2], [0, 0.2, 0]);
  b.box("plank", b.shade(PALETTE.plankPale, 0.14), [0.86, 0.1, 3.9], [0, 0.08, 0]);
  b.box("hay", b.shade(PALETTE.hay, 0.2), [0.7, 0.24, 1.6], [0, 0.34, -0.8]);
  b.cylinder("timber", b.shade(PALETTE.oakPale), 0.04, 0.05, 3.4, 5, [0.5, 0.5, 0.4], [0.2, 0.3, 0.1]);
  b.pop();
}

/** A bridge. The deck sits at the group origin, which is the road surface. */
/**
 * A timber trestle bridge, arched over its channel.
 *
 * Wood rather than masonry, and a trestle rather than an arch ring, because a
 * trestle is the honest answer to uneven ground: every bent drops its own legs
 * to whatever the bed is under it, so the bridge meets the river bank instead
 * of arguing with it. A stone arch has one springing height and must be either
 * buried or stilted anywhere the banks disagree — which is exactly what was
 * happening here.
 *
 * The deck follows `bridgeDeckLocalY`, the same curve `surfaces.ts` walks on,
 * so what you see and what you stand on cannot drift apart.
 */
export function bridgeFor(b: Build, s: Structure): void {
  const profile = bridgeProfile(s);
  const width = 4.6;
  const half = BRIDGE_DECK_LENGTH / 2;
  // Local Y of the deck at span parameter t, relative to the structure origin.
  const deckY = (t: number) => bridgeDeckLocalY(s, profile, t) / s.scale;

  const bents = b.lod > 0 ? 6 : 4;
  const planks = b.lod > 0 ? 26 : 13;

  // --- Trestle bents ------------------------------------------------------
  // Skipped at the very ends: there the deck already meets the bank, and a leg
  // there would stand on the road.
  for (let i = 1; i < bents; i++) {
    const t = -1 + (i / bents) * 2;
    const z = t * half;
    const top = deckY(t) - 0.34;

    // How far down to the bed. The channel is deepest at the crown, so the
    // legs lengthen toward the middle — which is what makes a trestle read as
    // spanning something.
    const drop = 1.4 + (1 - t * t) * (profile.rise / s.scale + 2.6);

    for (const side of [-1, 1]) {
      const splay = side * (width / 2 - 0.45);
      // Legs rake outward as they descend; a vertical trestle looks like scaffold.
      b.cylinder(
        "timber",
        b.shade(PALETTE.oak, 0.22),
        0.15,
        0.19,
        drop,
        6,
        [splay + side * drop * 0.09, top - drop / 2, z],
        [0, 0, -side * 0.17]
      );
    }
    // Cap beam across the bent, and a cross brace under it.
    b.box("timber", b.shade(PALETTE.oak, 0.16), [width - 0.5, 0.22, 0.26], [0, top, z]);
    if (b.lod > 0) {
      b.box(
        "timber",
        b.shade(PALETTE.oakPale, 0.24),
        [width - 0.9, 0.12, 0.14],
        [0, top - drop * 0.45, z],
        [0, 0, 0.1]
      );
    }
  }

  // --- Stringers ----------------------------------------------------------
  // Two long beams under the planks, stepped along the arch so they curve.
  for (const side of [-1, 1]) {
    const segments = b.lod > 0 ? 14 : 7;
    for (let i = 0; i < segments; i++) {
      const t0 = -1 + (i / segments) * 2;
      const t1 = -1 + ((i + 1) / segments) * 2;
      const mid = (t0 + t1) / 2;
      const y0 = deckY(t0) - 0.2;
      const y1 = deckY(t1) - 0.2;
      b.box(
        "timber",
        b.shade(PALETTE.oak, 0.14),
        [0.26, 0.3, (half * 2) / segments + 0.04],
        [side * (width / 2 - 0.5), (y0 + y1) / 2, mid * half],
        // Pitch each segment along the local slope of the arch.
        [Math.atan2(y1 - y0, (half * 2) / segments), 0, 0]
      );
    }
  }

  // --- Deck planks --------------------------------------------------------
  // Laid across the span, each one sitting at its own point on the curve, with
  // a little gap and a little wobble. A single long box would be a ramp.
  for (let i = 0; i < planks; i++) {
    const t = -1 + ((i + 0.5) / planks) * 2;
    const z = t * half;
    const worn = b.range(0.9, 1.0);
    b.box(
      "plank",
      b.shade(PALETTE.plank, 0.26),
      [width * worn, 0.14, (half * 2) / planks - 0.05],
      [b.wobble(0.05), deckY(t) - 0.07, z],
      [0, b.wobble(0.015), b.wobble(0.02)]
    );
  }

  // --- Handrails ----------------------------------------------------------
  for (const side of [-1, 1]) {
    const posts = b.lod > 0 ? 9 : 5;
    for (let i = 0; i <= posts; i++) {
      const t = -1 + (i / posts) * 2;
      // One post is gone on the downstream side — nobody has replaced it.
      if (side === 1 && i === 3) continue;
      b.cylinder(
        "timber",
        b.shade(PALETTE.oak, 0.2),
        0.075,
        0.085,
        1.05,
        5,
        [side * (width / 2 - 0.3), deckY(t) + 0.45, t * half],
        [b.wobble(0.04), 0, b.wobble(0.05)]
      );
    }
    // Rail, stepped along the arch like the stringers.
    const rails = b.lod > 0 ? 12 : 6;
    for (let i = 0; i < rails; i++) {
      const t0 = -1 + (i / rails) * 2;
      const t1 = -1 + ((i + 1) / rails) * 2;
      const y0 = deckY(t0) + 0.95;
      const y1 = deckY(t1) + 0.95;
      if (side === 1 && i >= 3 && i <= 4) continue;
      b.box(
        "plank",
        b.shade(PALETTE.plankPale, 0.22),
        [0.13, 0.16, (half * 2) / rails + 0.03],
        [side * (width / 2 - 0.3), (y0 + y1) / 2, ((t0 + t1) / 2) * half],
        [Math.atan2(y1 - y0, (half * 2) / rails), 0, 0]
      );
    }
  }

  // --- Abutments ----------------------------------------------------------
  // A few dry-stone blocks where the timber meets the bank, so the deck does
  // not simply end in mid-air over the earth.
  for (const k of [-1, 1] as const) {
    const t = k * 0.94;
    b.box(
      "stone",
      b.shade(PALETTE.rubble, 0.14),
      [width + 0.5, 1.1, 1.2],
      [0, deckY(t) - 0.75, t * half]
    );
  }
}

/**
 * A hanging cloth banner facing local +Z, with a mark for the Pixelgrew emblem.
 *
 * Architecture stamps `pixlegrew.webp` onto a subset of these marks so the
 * valley can carry the mark without putting UVs on every building part.
 */
function hangingBanner(
  b: Build,
  width: number,
  height: number,
  x: number,
  y: number,
  z: number
): void {
  b.box("cloth", b.shade(PALETTE.clothRed, 0.1), [width, height, 0.03], [x, y, z]);
  // Slightly proud of the cloth so the emblem never z-fights the banner face.
  b.mark("banner", [x, y, z + 0.04]);
}

/** A palisade gate. Local +X spans the road; the arch opens along +Z. */
/** How deep a gate tower is founded below the road surface it straddles. */
const GATE_FOOTING = 3.4;

function gate(b: Build, roadHalfWidth: number): void {
  const offset = roadHalfWidth + 1.5;
  const height = 5.4;

  for (const side of [-1, 1]) {
    b.push([side * offset, 0, 0]);

    // A buried plinth. A gate straddles the road, so it is levelled to the
    // graded carriageway — but its towers stand out on the verge, where the
    // ground has already fallen away by up to three metres. Founding them well
    // below the road surface is both what a mason would do and the only thing
    // that stops a tower hanging in the air beside its own gateway.
    b.box("stone", b.shade(PALETTE.rubble, 0.06), [2.7, GATE_FOOTING, 2.7], [0, -GATE_FOOTING / 2, 0]);

    const courses = b.lod > 0 ? 11 : 6;
    for (let i = 0; i < courses; i++) {
      stoneCourse(b, PALETTE.rubble, 2.5, height / courses, 2.5, (i + 0.5) * (height / courses), 0);
    }
    // Corbelled head and a fighting platform above it.
    b.box("stone", b.shade(PALETTE.ashlar, 0.1), [2.9, 0.22, 2.9], [0, height + 0.11, 0]);
    for (let i = 0; i < 4; i++) {
      b.push([0, 0, 0], [0, (i * Math.PI) / 2, 0]);
      for (let j = 0; j < 3; j++) {
        if (j === 1) continue;
        b.box("stone", b.shade(PALETTE.rubble, 0.14), [0.8, 0.7, 0.4], [-0.9 + j * 0.9, height + 0.57, 1.35]);
      }
      b.pop();
    }
    // Palisade wing running away from the road.
    // Kept short: the palisade has to stay inside the footprint the placer
    // reserved, or a wing post ends up inside somebody's barn.
    for (let i = 0; i < (b.lod > 0 ? 5 : 3); i++) {
      b.cylinder(
        "timber",
        b.shade(PALETTE.oak, 0.2),
        0.16,
        0.2,
        3.1 * b.range(0.92, 1.06),
        6,
        [side * (1.35 + i * 0.4), 1.55, 0],
        [b.wobble(0.03), 0, b.wobble(0.04)]
      );
    }
    b.pop();
  }

  // Lintel, gate leaves standing open, and a banner.
  b.box("timber", b.shade(PALETTE.oak), [offset * 2 + 1.4, 0.5, 1.1], [0, height - 0.25, 0]);
  b.box("timber", b.shade(PALETTE.oak), [offset * 2 + 1.0, 0.34, 0.8], [0, height - 0.75, 0]);
  for (const side of [-1, 1]) {
    b.push([side * (offset - 1.2), 0, 0.5], [0, side * 1.15, 0]);
    for (let i = 0; i < 5; i++) {
      b.box("plank", b.shade(PALETTE.plank, 0.16), [0.3, 4.4, 0.12], [-side * (0.2 + i * 0.32), 2.2, 0]);
    }
    b.box("metal", PALETTE.iron, [1.7, 0.11, 0.05], [-side * 0.85, 0.7, 0.08]);
    b.box("metal", PALETTE.iron, [1.7, 0.11, 0.05], [-side * 0.85, 3.6, 0.08]);
    b.pop();
  }
  hangingBanner(b, 1.1, 1.9, 0, height - 1.9, 0.62);
}

// ---------------------------------------------------------------------------
// Yard clutter
// ---------------------------------------------------------------------------

/** A fence panel. Local +X runs along the line. */
/**
 * How far fence posts are driven below their panel's floor.
 *
 * Sized against the worst drop measured across a 3.8m panel anywhere in the
 * valley (1.45m), with margin. Fences are placed on ground up to `maxSlope`
 * 0.42, which over a panel is about 1.6m of fall.
 */
const FENCE_SKIRT = 1.8;

function fence(b: Build, variant: number): void {
  const length = 3.8;
  if (variant === 1) {
    // Woven hazel hurdle: uprights with the weave running through them.
    const stakes = 7;
    for (let i = 0; i <= stakes; i++) {
      b.cylinder(
        "timber",
        b.shade(PALETTE.oakPale, 0.22),
        0.035,
        0.045,
        // Driven well below the ground line. A fence panel is rigid and the
        // ground under it is not, so one end of every panel on a slope sits
        // proud — the placer levels the panel to the LOWEST point beneath it,
        // and the stakes have to reach down to that from wherever they stand.
        // A buried stake costs a few vertices and is invisible; a floating one
        // is the first thing you notice.
        1.35 + FENCE_SKIRT,
        5,
        [-length / 2 + (i / stakes) * length, 0.6 - FENCE_SKIRT / 2, 0],
        [b.wobble(0.04), 0, b.wobble(0.05)]
      );
    }
    const rows = b.lod > 0 ? 8 : 4;
    for (let r = 0; r < rows; r++) {
      const y = 0.14 + r * (1.05 / rows);
      const z = r % 2 === 0 ? 0.045 : -0.045;
      b.box("plank", b.shade(PALETTE.plankPale, 0.24), [length, 0.09, 0.05], [0, y, z], [0, 0, b.wobble(0.02)]);
    }
    return;
  }

  // Post and rail. Posts lean, rails sag, and one is missing entirely.
  for (const x of [-length / 2, 0, length / 2]) {
    b.box(
      "timber",
      b.shade(PALETTE.oak, 0.2),
      [0.12, 1.3 + FENCE_SKIRT, 0.12],
      [x, 0.6 - FENCE_SKIRT / 2, b.wobble(0.03)],
      [b.wobble(0.05), b.wobble(0.1), b.wobble(0.06)]
    );
  }
  const rails = 3;
  for (let i = 0; i < rails; i++) {
    if (i === 1 && b.rnd() < 0.18) continue;
    b.box(
      "plank",
      b.shade(PALETTE.plank, 0.22),
      [length, 0.11, 0.06],
      [0, 0.32 + i * 0.36, 0],
      [0, b.wobble(0.02), b.wobble(0.025)]
    );
  }
}

/** A haystack under a thatched cap, on a staddle of brushwood. */
function haystack(b: Build, variant: number): void {
  const radius = variant === 0 ? 1.5 : 1.15;
  const height = variant === 0 ? 2.4 : 2.9;
  const layers = b.lod > 0 ? 8 : 4;

  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const r = radius * (1 - Math.pow(t, 1.7) * 0.28);
    b.cylinder(
      "hay",
      b.shade(PALETTE.hay, 0.18),
      r * 0.97,
      r,
      height / layers,
      9,
      [b.wobble(0.03), 0.12 + (i + 0.5) * (height / layers), b.wobble(0.03)],
      [b.wobble(0.02), b.range(0, 1), b.wobble(0.02)]
    );
  }
  // Thatched cap, and the rope that holds it on.
  b.cylinder("thatch", b.shade(PALETTE.thatchDark, 0.14), 0, radius * 1.12, 1.1, 9, [0, height + 0.62, 0]);
  b.cylinder("timber", b.shade(PALETTE.oakPale), 0.04, 0.05, 0.5, 5, [0, height + 1.3, 0]);
  if (b.lod > 0) {
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      b.box("cloth", b.shade(PALETTE.clothCream, 0.2), [0.03, 1.4, 0.03], [Math.cos(angle) * radius * 0.9, height * 0.7, Math.sin(angle) * radius * 0.9], [0, -angle, 0.24]);
    }
    // Loose hay round the foot.
    for (let i = 0; i < 6; i++) {
      b.box("hay", b.shade(PALETTE.hay, 0.24), [b.range(0.2, 0.5), 0.08, b.range(0.2, 0.5)], [b.range(-2, 2), 0.05, b.range(-2, 2)], [0, b.range(0, 3), 0]);
    }
  }
}

/** A woodpile: split logs stacked end-on, plus the block they were split on. */
function woodpile(b: Build, variant: number): void {
  const width = 3.4;
  const height = variant === 0 ? 1.15 : 0.85;
  const rows = Math.max(2, Math.round(height / 0.2));
  const perRow = b.lod > 0 ? 11 : 6;

  for (let r = 0; r < rows; r++) {
    const y = 0.12 + r * (height / rows);
    const rowWidth = width * (1 - r * 0.02);
    for (let i = 0; i < perRow; i++) {
      b.cylinder(
        "timber",
        b.shade(r % 2 === 0 ? PALETTE.oakPale : PALETTE.plank, 0.24),
        b.range(0.085, 0.12),
        b.range(0.085, 0.12),
        b.range(0.6, 0.78),
        6,
        [
          -rowWidth / 2 + (i + 0.5) * (rowWidth / perRow),
          y,
          b.wobble(0.06),
        ],
        [Math.PI / 2, b.wobble(0.06), 0]
      );
    }
  }
  // Chopping block with the axe left in it, and the chips around it.
  b.cylinder("timber", b.shade(PALETTE.oakPale, 0.16), 0.34, 0.36, 0.55, 9, [width / 2 + 0.7, 0.28, 0.3]);
  b.box("timber", b.shade(PALETTE.oak), [0.05, 0.7, 0.06], [width / 2 + 0.68, 0.85, 0.3], [0.22, 0, 0.1]);
  b.box("metal", PALETTE.iron, [0.07, 0.2, 0.24], [width / 2 + 0.66, 0.55, 0.28], [0.22, 0, 0.1]);
  if (b.lod > 0) {
    for (let i = 0; i < 7; i++) {
      b.box("plank", b.shade(PALETTE.plankPale, 0.24), [b.range(0.06, 0.16), 0.04, b.range(0.06, 0.14)], [width / 2 + b.range(-0.2, 1.6), 0.03, b.range(-0.6, 1.1)], [0, b.range(0, 3), 0]);
    }
  }
}

/** A cart, tipped forward on its shafts the way one is left standing. */
function cart(b: Build, variant: number): void {
  const tilt = -0.13;
  b.push([0, 0.62, 0], [tilt, 0, 0]);

  // Bed and sides.
  b.box("plank", b.shade(PALETTE.plank, 0.16), [1.8, 0.1, 2.6], [0, 0, 0]);
  for (const side of [-1, 1]) {
    b.box("plank", b.shade(PALETTE.plank, 0.2), [0.08, 0.42, 2.5], [side * 0.9, 0.24, 0]);
    b.box("timber", b.shade(PALETTE.oak), [0.1, 0.44, 0.1], [side * 0.88, 0.25, -1.0]);
    b.box("timber", b.shade(PALETTE.oak), [0.1, 0.44, 0.1], [side * 0.88, 0.25, 1.0]);
  }
  b.box("plank", b.shade(PALETTE.plank, 0.2), [1.8, 0.5, 0.08], [0, 0.28, -1.28]);

  // Load.
  if (variant === 0) {
    b.box("hay", b.shade(PALETTE.hay, 0.16), [1.6, 0.6, 2.2], [0, 0.4, 0], [0, b.wobble(0.05), 0]);
  } else {
    for (let i = 0; i < 3; i++) {
      b.cylinder("plank", b.shade(PALETTE.plank, 0.18), 0.32, 0.3, 0.72, 9, [b.range(-0.4, 0.4), 0.42, -0.7 + i * 0.7], [Math.PI / 2, 0, b.wobble(0.1)]);
    }
  }

  // Shafts, resting on the ground at the front.
  for (const side of [-1, 1]) {
    b.cylinder("timber", b.shade(PALETTE.oak, 0.14), 0.05, 0.07, 2.4, 6, [side * 0.6, -0.28, 2.2], [1.42, 0, 0]);
  }
  b.pop();

  // Wheels: felloes, spokes and an iron tyre, because a disc reads as a coin.
  for (const side of [-1, 1]) {
    b.push([side * 1.0, 0.62, 0.1], [0, 0, Math.PI / 2]);
    const radius = 0.6;
    b.cylinder("metal", PALETTE.iron, radius, radius, 0.07, 14, [0, 0, 0]);
    b.cylinder("timber", b.shade(PALETTE.oakPale, 0.12), radius - 0.07, radius - 0.07, 0.1, 14, [0, 0, 0]);
    b.cylinder("timber", b.shade(PALETTE.oak), 0.12, 0.14, 0.24, 8, [0, 0, 0]);
    const spokes = b.lod > 0 ? 8 : 5;
    for (let i = 0; i < spokes; i++) {
      const angle = (i / spokes) * Math.PI * 2;
      b.box(
        "timber",
        b.shade(PALETTE.oakPale, 0.16),
        [0.06, 0.08, radius - 0.12],
        [Math.sin(angle) * (radius / 2 - 0.03), 0, Math.cos(angle) * (radius / 2 - 0.03)],
        [0, -angle, 0]
      );
    }
    b.pop();
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export type KindRecipe = {
  /** How many distinct geometries to build at each quality tier. */
  variants: [low: number, medium: number, high: number];
  build: (b: Build, variant: number, roadHalfWidth: number) => void;
};

export const KIND_RECIPES: Record<StructureKind, KindRecipe> = {
  cottage: { variants: [2, 3, 3], build: (b, v) => cottage(b, v) },
  longhouse: { variants: [1, 2, 2], build: (b, v) => longhouse(b, v) },
  barn: { variants: [1, 2, 2], build: (b, v) => barn(b, v) },
  windmill: { variants: [1, 1, 1], build: (b) => windmill(b) },
  watchtower: { variants: [1, 2, 2], build: (b, v) => watchtower(b, v) },
  chapel: { variants: [1, 1, 1], build: (b) => chapel(b) },
  well: { variants: [1, 2, 2], build: (b, v) => well(b, v) },
  market_stall: { variants: [2, 2, 2], build: (b, v) => marketStall(b, v) },
  forge: { variants: [1, 1, 1], build: (b) => forge(b) },
  inn: { variants: [1, 1, 1], build: (b) => inn(b) },
  dock: { variants: [1, 1, 1], build: (b) => dock(b) },
  // Built per-structure by Architecture.tsx (see `bridgeFor`), because each
  // bridge has its own arch. Never reached through this table.
  bridge: { variants: [1, 1, 1], build: () => {} },
  fence: { variants: [1, 2, 2], build: (b, v) => fence(b, v) },
  shrine: { variants: [1, 2, 2], build: (b, v) => shrine(b, v) },
  ruin: { variants: [2, 2, 2], build: (b, v) => ruin(b, v) },
  camp: { variants: [1, 1, 1], build: (b) => camp(b) },
  standing_stones: { variants: [1, 1, 1], build: (b) => standingStones(b) },
  quarry: { variants: [1, 2, 2], build: (b, v) => quarry(b, v) },
  lighthouse: { variants: [1, 1, 1], build: (b) => lighthouse(b) },
  gate: { variants: [1, 1, 1], build: (b, _v, half) => gate(b, half) },
  haystack: { variants: [1, 2, 2], build: (b, v) => haystack(b, v) },
  woodpile: { variants: [1, 2, 2], build: (b, v) => woodpile(b, v) },
  signpost: { variants: [1, 2, 2], build: (b, v) => signpost(b, v) },
  cart: { variants: [1, 2, 2], build: (b, v) => cart(b, v) },
};

/** The sail assembly, kept out of the registry because it moves. */
export function buildSails(seed: number, lod: number): Build {
  const b = new Build(seed, lod);
  windmillSails(b);
  return b;
}

/**
 * Base colour per part, so the shared materials stay white and multiply.
 *
 * `color` is the exception and only "window" sets it. That bucket's vertex
 * attribute carries a *lighting schedule* rather than a colour (see `lampPane`
 * in `architecture-parts.ts`), so there is nothing there to multiply and the
 * material has to supply its own base instead.
 */
export const PART_MATERIAL: Record<
  string,
  {
    roughness: number;
    metalness: number;
    flat: boolean;
    emissive?: THREE.Color;
    color?: THREE.Color;
  }
> = {
  stone: { roughness: 0.96, metalness: 0, flat: true },
  plaster: { roughness: 0.98, metalness: 0, flat: false },
  timber: { roughness: 0.9, metalness: 0, flat: false },
  plank: { roughness: 0.88, metalness: 0, flat: false },
  thatch: { roughness: 1, metalness: 0, flat: true },
  shingle: { roughness: 0.86, metalness: 0, flat: true },
  cloth: { roughness: 0.95, metalness: 0, flat: false },
  metal: { roughness: 0.52, metalness: 0.6, flat: false },
  glow: { roughness: 0.7, metalness: 0, flat: false, emissive: new THREE.Color("#ff9a3c") },
  // Warmer and paler than a hearth: tallow and rushlight seen through horn or
  // oiled cloth, not the fire itself.
  window: {
    roughness: 0.62,
    metalness: 0,
    flat: false,
    emissive: new THREE.Color("#ffb45c"),
    color: PALETTE.glass,
  },
  hay: { roughness: 1, metalness: 0, flat: true },
  dirt: { roughness: 1, metalness: 0, flat: true },
};

"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { NIGHT, daylight } from "@/lib/world/daylight";
import type { QualityBudget, QualityTier } from "@/lib/world/quality";
import { surfaceAt } from "@/lib/world/surfaces";
import { TREE_LINE, WATER_LEVEL } from "@/lib/world/terrain";

/**
 * Fireflies over the meadow, after dark.
 *
 * ## The swarm is a volume that follows the bard, not a population in a world
 *
 * A firefly is three centimetres of light. Past thirty metres it is a sub-pixel
 * speck, so scattering a population across a 640-metre valley would spend the
 * whole budget on flies nobody can resolve and leave the grass under the camera
 * empty. Instead the swarm is a disc that travels with Punaab — which is where
 * the camera is — and a fly that falls out of the back of it is *moved*, not
 * respawned: its anchor is reflected through the centre to the far side and it
 * keeps its colour, its size and its own blink rhythm. Nothing is allocated
 * after mount, and the population is the same whether he is standing still or
 * has walked the length of the valley.
 *
 * ## The blink lives in the vertex shader
 *
 * Each fly's flash is a pure function of `uTime` and two attributes that never
 * change — its period and its phase — so the GPU derives it and the CPU never
 * touches a brightness. That is worth doing: the CPU already has to write three
 * hundred positions a frame, and computing an envelope per fly on top of that
 * would be the most expensive thing in this file for no visual gain.
 *
 * The envelope is deliberately not a sine. A real firefly *flashes*: up in
 * about fifty milliseconds, away over a third of a second, then dark for one to
 * five seconds depending on the animal — and a good few of them flash in
 * couplets rather than singly. A sine wave spends half of every cycle half-lit,
 * which reads as drifting fairy dust rather than as insects signalling to each
 * other, and the signalling is the entire reason fireflies are worth drawing.
 *
 * ## No point lights, on purpose
 *
 * The obvious idea — a small `pointLight` on each fly — is a trap. In three's
 * WebGL renderer every point light costs every lit fragment in the frame, so in
 * a scene carrying two hundred thousand grass tufts a handful of them is the
 * whole frame budget. These are additive sprites, and the bloom pass carries
 * them: `daylight` drops the bloom threshold as night comes in precisely so the
 * few genuinely bright things after dark are allowed to glow.
 */

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

/**
 * Flies per tier. Low gets none at all rather than a thinned version: on a
 * phone the whole point of the effect — dozens of independent little flashes
 * across the field of view — is gone by the time the count is low enough to
 * afford, and what is left is a few unexplained blinking dots.
 */
const COUNTS: Record<QualityTier, number> = { low: 0, medium: 180, high: 340 };

/**
 * Radius of the volume, in metres.
 *
 * Sized off the camera rather than off the bard: `FollowCamera` sits between
 * four and seven metres behind him looking forward, so twenty-four metres of
 * radius fills the near and middle ground of the shot and stops a little short
 * of where a firefly stops being a resolvable dot.
 */
const RADIUS = 24;
const RADIUS_SQ = RADIUS * RADIUS;

/** Height band above the ground the flies occupy. */
const HOVER_MIN = 0.15;
const HOVER_MAX = 2.2;

/**
 * Ground samples per frame.
 *
 * `surfaceAt` is roughly 2.3µs — it walks the terrain height function and then
 * every bridge and dock deck in range. Calling it for every fly every frame
 * would be 340 × 60 × 2.3µs ≈ 47ms of CPU *per second of wall clock*, which is
 * three frames a second thrown away on the height of a point of light nobody is
 * measuring. So the swarm is swept round-robin instead: a fourteenth of it per
 * frame, a complete pass roughly four times a second, for well under 60µs a
 * frame. Between samples each fly's ground height is eased toward its last
 * reading, so the amortisation shows up as smoothness rather than as steps.
 */
const SAMPLE_FRACTION = 14;

/** How many flies may be relocated in one frame. See `recycle`. */
const RECYCLES_PER_FRAME = 6;

/**
 * Integer hash → [0, 1). The canonical one from `lib/world/terrain.ts`, which
 * does not export it.
 *
 * Copied verbatim rather than approximated, because `Math.imul` is load-bearing
 * here and not a micro-optimisation: written with a plain `*` these constants
 * produce products past 2^53, the float quietly drops its low bits, and the low
 * bits *are* the hash. That exact bug once put every scattered prop in this repo
 * into one quadrant of the map.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// ---------------------------------------------------------------------------
// Sprite
// ---------------------------------------------------------------------------

/**
 * The soft round blob a small bright light makes on a lens.
 *
 * Only the alpha channel is ever read — the colour comes from the per-fly
 * vertex colour — so this is white throughout and the stops shape the falloff
 * alone. The profile is a tight core inside a wide, very faint halo, which is
 * what an out-of-focus point source actually looks like; a single linear
 * gradient gives a soft ball with no centre to it and reads as smoke.
 */
function makeFireflySprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const half = size / 2;
    const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
    glow.addColorStop(0, "rgba(255, 255, 255, 1)");
    glow.addColorStop(0.18, "rgba(255, 255, 255, 0.82)");
    glow.addColorStop(0.38, "rgba(255, 255, 255, 0.24)");
    glow.addColorStop(0.68, "rgba(255, 255, 255, 0.05)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uNight;
  uniform float uScale;

  attribute float aSize;
  attribute float aPeriod;
  attribute float aPhase;
  attribute float aTwin;
  attribute float aWeight;

  varying vec3 vColor;
  varying float vGlow;

  // Rise time and fall time of one flash, in seconds. Measured off nothing in
  // particular — they are what a flash looks like rather than what a species
  // does — but the ratio is the point: the fall is six times the rise, and it is
  // that asymmetry the eye reads as a spark rather than as a fade.
  const float ATTACK = 0.055;
  const float DECAY = 0.30;

  float flashAt(float since) {
    return smoothstep(0.0, ATTACK, since) *
           exp(-max(since - ATTACK, 0.0) / DECAY);
  }

  void main() {
    // Seconds elapsed since this fly last began a flash. Phase is a fraction of
    // its own period rather than an absolute offset, so the swarm is evenly
    // spread through its cycles no matter how the periods are distributed.
    float since = fract(uTime / aPeriod + aPhase) * aPeriod;

    // Couplet flashers get a second pulse aTwin seconds behind the first.
    // Single flashers are given a delay longer than their own period, so their
    // second pulse simply never falls inside the cycle — cheaper and branchless
    // compared with carrying a flag and an if for it.
    float glow = clamp(flashAt(since) + flashAt(max(since - aTwin, 0.0)), 0.0, 1.0);

    // A dark firefly is genuinely invisible, but a field where two thirds of the
    // population does not exist at any instant reads as sparse and random. The
    // ember keeps every fly as a barely-there speck between flashes, which is
    // what gives the swarm a shape for the flashes to happen inside of.
    vGlow = (glow + 0.045) * aWeight * uNight;
    vColor = color;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // uScale carries the projection, so a fly is the same size in metres
    // whichever way the window is shaped and whatever the device pixel ratio —
    // a hardcoded constant here silently doubles the swarm on a retina display.
    gl_PointSize = aSize * (1.0 + glow * 0.6) * (uScale / max(0.05, -mvPosition.z));
    // Upper clamp is portability as much as taste: plenty of drivers cap
    // ALIASED_POINT_SIZE_RANGE at 63, and a sprite that hits the cap stops
    // growing at a distance the artist never chose.
    gl_PointSize = clamp(gl_PointSize, 1.0, 48.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uSprite;

  varying vec3 vColor;
  varying float vGlow;

  void main() {
    float alpha = texture2D(uSprite, gl_PointCoord).a * vGlow;
    if (alpha < 0.004) discard;

    // The middle of a bright flash is over any sane exposure, and an overexposed
    // light of any colour reads white with the hue surviving only in the halo.
    // Without this the flash just gets a more saturated green, which looks like
    // a UI element rather than something burning.
    vec3 rgb = mix(vColor, vec3(1.0), clamp(vGlow * 0.55, 0.0, 0.6));

    gl_FragColor = vec4(rgb, alpha);

    // Included so the palette above means what it says: THREE.Color hands us
    // linear values, and these two chunks are what put a linear colour through
    // the same ACES curve and output transform as every other surface in the
    // valley. A raw ShaderMaterial that skips them is authoring in whatever
    // space the framebuffer happens to be, which is how a firefly ends up a
    // different green from the one in the palette file.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------------------
// Flight
// ---------------------------------------------------------------------------

/**
 * Per-fly flight state, as parallel typed arrays rather than an array of
 * objects.
 *
 * Three hundred small objects would be fine for the garbage collector — they
 * are made once — but every field access through them is a pointer chase, and
 * this is the one loop in the file that runs over the whole population every
 * frame. Flat buffers also mean the position writes land straight in the
 * attribute the GPU reads, with no copy in between.
 */
type Flight = {
  /** Anchor the fly circles, world XZ. Only ever changed by `recycle`. */
  homeX: Float32Array;
  homeZ: Float32Array;
  /** Ground height under the fly: `groundY` eases toward the last sample. */
  groundY: Float32Array;
  groundTarget: Float32Array;
  /** Where `weight` is heading — 0 over water and scree, 1 over grass. */
  want: Float32Array;
  /** Metres above the ground, and how far the fly bobs about that. */
  hover: Float32Array;
  bob: Float32Array;
  /** Slow wandering loop: rate in rad/s, amplitude in metres. */
  rateA: Float32Array;
  ampA: Float32Array;
  phaseA: Float32Array;
  /** Fast jitter layered on top of it. */
  rateB: Float32Array;
  ampB: Float32Array;
  phaseB: Float32Array;
  /** Vertical bob. */
  rateC: Float32Array;
  phaseC: Float32Array;
};

/**
 * How much of a fly is allowed to show, given the ground beneath it.
 *
 * Fireflies are a wet-meadow animal: they want long grass and still air, and
 * they are not found over open water or up on the scree. Water is a hard cut,
 * because a fly hovering over the middle of the mere is unmistakably wrong.
 * Altitude is a fade instead — the grass gives out gradually above the tree
 * line, and a hard edge at exactly `TREE_LINE` would draw a contour line across
 * the mountainside in blinking dots. `SNOW_LINE` is much too generous a
 * threshold for this: everything between the two is bare rock.
 */
function groundWeight(ground: number): number {
  if (ground < WATER_LEVEL + 0.45) return 0;
  return 1 - clamp01((ground - TREE_LINE) / 16);
}

/**
 * Places a fly's anchor and reads the ground under it.
 *
 * The two callers below both need exactly this and differ only in where the
 * anchor goes, so the ground sample, the height reset and the fade-in live here
 * once. `weight` deliberately starts at zero: a fly that arrived this frame
 * ramps up over about a second, which is what stops relocation from being a
 * visible pop even when it happens in front of the camera.
 */
function place(flight: Flight, i: number, x: number, z: number): void {
  flight.homeX[i] = x;
  flight.homeZ[i] = z;
  const ground = surfaceAt(x, z);
  flight.groundY[i] = ground;
  flight.groundTarget[i] = ground;
  flight.want[i] = groundWeight(ground);
}

/**
 * Scatters the whole swarm around a point.
 *
 * Only runs on the first night frame and after the volume has been switched off
 * long enough for the bard to walk out of it — in practice once per night, for
 * about 0.8ms at the high count, at a moment when `starAlpha` is still near
 * zero and nothing is on screen to hitch.
 *
 * The `sqrt` on the radius is not decoration: sampling radius uniformly puts
 * half the population inside the middle quarter of the area and gives every
 * disc a bullseye.
 */
function seed(
  flight: Flight,
  count: number,
  centreX: number,
  centreZ: number,
  epoch: number
): void {
  for (let i = 0; i < count; i++) {
    const angle = hash2(i + epoch * 7919, epoch * 104729 + 11) * Math.PI * 2;
    const radius = Math.sqrt(hash2(epoch * 31 + 3, i * 5 + epoch)) * RADIUS;
    place(
      flight,
      i,
      centreX + Math.cos(angle) * radius,
      centreZ + Math.sin(angle) * radius
    );
  }
}

/**
 * Moves a fly that has fallen out of the volume across to the far side of it.
 *
 * Reflection through the centre rather than a fresh random position, because
 * reflection preserves the distribution exactly: the swarm the bard walks into
 * is statistically the swarm he walked out of, with no thinning at the leading
 * edge and no pile-up behind him. The angle is jittered so the arrivals do not
 * trace the departures, and the radius is drawn short of the boundary so a fly
 * does not immediately qualify to be moved back again.
 */
function recycle(
  flight: Flight,
  i: number,
  centreX: number,
  centreZ: number,
  tick: number
): void {
  const dx = flight.homeX[i] - centreX;
  const dz = flight.homeZ[i] - centreZ;
  const length = Math.hypot(dx, dz) || 1;
  const turn = (hash2(i, tick) - 0.5) * 1.1;
  const radius = RADIUS * (0.74 + hash2(tick, i * 13) * 0.22);
  // Rotate the reversed offset by `turn`, then rescale it to the new radius.
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const ux = -dx / length;
  const uz = -dz / length;
  place(
    flight,
    i,
    centreX + (ux * cos - uz * sin) * radius,
    centreZ + (ux * sin + uz * cos) * radius
  );
}

// ---------------------------------------------------------------------------

/** Reused by the frame loop — see the ban on per-frame allocation. */
const scratchBuffer = new THREE.Vector2();

function Swarm({
  target,
  count,
}: {
  target: React.RefObject<THREE.Object3D | null>;
  count: number;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  /** Centre of the volume, and whether it has ever been filled. */
  const volume = useRef({ x: 0, z: 0, seeded: false });
  /** Round-robin position of the ground sampler. */
  const cursor = useRef(0);
  /** Counts relocations, purely to keep the jitter hash moving. */
  const tick = useRef(0);
  const epoch = useRef(0);

  const assets = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const periods = new Float32Array(count);
    const phases = new Float32Array(count);
    const twins = new Float32Array(count);
    const weights = new Float32Array(count);

    const flight: Flight = {
      homeX: new Float32Array(count),
      homeZ: new Float32Array(count),
      groundY: new Float32Array(count),
      groundTarget: new Float32Array(count),
      want: new Float32Array(count),
      hover: new Float32Array(count),
      bob: new Float32Array(count),
      rateA: new Float32Array(count),
      ampA: new Float32Array(count),
      phaseA: new Float32Array(count),
      rateB: new Float32Array(count),
      ampB: new Float32Array(count),
      phaseB: new Float32Array(count),
      rateC: new Float32Array(count),
      phaseC: new Float32Array(count),
    };

    // Two ends of the palette. The green is the one `daylight` already publishes
    // as `NIGHT.firefly`, taken from there rather than retyped so the lit
    // windows, the lantern and these agree about what colour the night is.
    const cool = new THREE.Color(NIGHT.firefly);
    const warm = new THREE.Color("#FFE07A");
    const tint = new THREE.Color();

    for (let i = 0; i < count; i++) {
      tint.copy(cool).lerp(warm, hash2(i, 5081));
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;

      sizes[i] = 0.082 + hash2(i, 1223) * 0.062;

      // Period spread wide on purpose. Fireflies of one species do converge on a
      // rhythm, but a swarm that agrees to within a tenth of a second reads as a
      // string of Christmas lights on a controller; the spread is what makes the
      // field look like individuals rather than a pattern.
      const period = 1.5 + hash2(i, 2731) * 4.2;
      periods[i] = period;
      phases[i] = hash2(i, 3319);
      // A third of the population flashes in couplets. The rest are handed a
      // delay past their own period, which the shader can never reach.
      twins[i] =
        hash2(i, 4157) < 0.34 ? 0.22 + hash2(i, 4159) * 0.16 : period + 1;

      // Squared so the population piles up in the long grass and only the odd
      // one climbs to head height — sampling this band uniformly gives an even
      // sheet of lights hanging in mid-air, which is the giveaway of a particle
      // system rather than an animal.
      const lift = hash2(i, 6113);
      const hover = HOVER_MIN + (HOVER_MAX - HOVER_MIN) * lift * lift;
      flight.hover[i] = hover;
      flight.bob[i] = Math.min(
        0.3,
        hover - HOVER_MIN,
        HOVER_MAX - hover
      );

      // Rates are drawn from continuous ranges rather than picked as multiples
      // of a base, so no two layers of a fly's motion share a common period and
      // the path never closes on itself. That is the whole difference between
      // wandering and orbiting.
      flight.rateA[i] = 0.16 + hash2(i, 7211) * 0.26;
      flight.ampA[i] = 1.1 + hash2(i, 7229) * 1.7;
      flight.phaseA[i] = hash2(i, 7237) * Math.PI * 2;
      flight.rateB[i] = 0.9 + hash2(i, 8231) * 1.5;
      flight.ampB[i] = 0.18 + hash2(i, 8233) * 0.5;
      flight.phaseB[i] = hash2(i, 8237) * Math.PI * 2;
      flight.rateC[i] = 0.5 + hash2(i, 9241) * 0.9;
      flight.phaseC[i] = hash2(i, 9257) * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(positions, 3);
    const weightAttr = new THREE.BufferAttribute(weights, 1);
    positionAttr.setUsage(THREE.DynamicDrawUsage);
    weightAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positionAttr);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPeriod", new THREE.BufferAttribute(periods, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aTwin", new THREE.BufferAttribute(twins, 1));
    geometry.setAttribute("aWeight", weightAttr);

    const sprite = makeFireflySprite();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSprite: { value: sprite },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uScale: { value: 600 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    return {
      geometry,
      material,
      sprite,
      positions,
      weights,
      positionAttr,
      weightAttr,
      flight,
      perFrameSamples: Math.max(8, Math.round(count / SAMPLE_FRACTION)),
    };
  }, [count]);

  useEffect(() => {
    return () => {
      assets.geometry.dispose();
      assets.material.dispose();
      assets.sprite.dispose();
    };
  }, [assets]);

  useFrame((state, rawDelta) => {
    const points = pointsRef.current;
    if (!points) return;

    // Everything below this line is skipped in daylight, which is the point of
    // reading `starAlpha` rather than `nightFactor`: it lags the darkness and
    // only leaves zero once the sky is genuinely dark, so the swarm costs
    // literally nothing for the two thirds of the cycle it has no business
    // being in.
    const night = daylight.starAlpha;
    const visible = night > 0.015;
    points.visible = visible;
    if (!visible) return;

    const focus = target.current;
    if (!focus) return;

    const delta = Math.min(rawDelta, 0.05);
    const time = state.clock.elapsedTime;
    const { flight, positions, weights } = assets;

    // A full reseed rather than three hundred relocations: after a day off the
    // bard is normally kilometres away, and reflecting each fly through a centre
    // it is nowhere near would put the entire swarm in a ring.
    const drift = Math.hypot(
      focus.position.x - volume.current.x,
      focus.position.z - volume.current.z
    );
    if (!volume.current.seeded || drift > RADIUS) {
      epoch.current += 1;
      seed(flight, count, focus.position.x, focus.position.z, epoch.current);
      volume.current.seeded = true;
      weights.fill(0);
    }
    const centreX = focus.position.x;
    const centreZ = focus.position.z;
    volume.current.x = centreX;
    volume.current.z = centreZ;

    // Exponential eases, solved once for the frame rather than per fly. The
    // ground one is quicker because a fly crossing a bank has to keep station
    // with it; the weight one is slower because it is doing the fade-in.
    const groundEase = 1 - Math.exp(-2.6 * delta);
    const weightEase = 1 - Math.exp(-1.1 * delta);
    let budget = RECYCLES_PER_FRAME;

    for (let i = 0; i < count; i++) {
      // Two layers at unrelated rates: a slow metre-scale loop with a small
      // fast one riding it. Sines rather than a random walk because a random
      // walk needs damping to stop it drifting away, and damped noise at this
      // amplitude is indistinguishable from a sine anyway — except that it
      // cannot be evaluated from `t` alone, which is what lets a fly's position
      // survive the swarm being switched off all day.
      const angleA = time * flight.rateA[i] + flight.phaseA[i];
      const angleB = time * flight.rateB[i] + flight.phaseB[i];
      const ampA = flight.ampA[i];
      const ampB = flight.ampB[i];
      const offsetX = Math.sin(angleA) * ampA + Math.sin(angleB) * ampB;
      const offsetZ = Math.cos(angleA) * ampA * 0.82 + Math.cos(angleB) * ampB * 1.15;

      let x = flight.homeX[i] + offsetX;
      let z = flight.homeZ[i] + offsetZ;

      const dx = x - centreX;
      const dz = z - centreZ;
      if (dx * dx + dz * dz > RADIUS_SQ && budget > 0) {
        budget -= 1;
        tick.current += 1;
        recycle(flight, i, centreX, centreZ, tick.current);
        weights[i] = 0;
        x = flight.homeX[i] + offsetX;
        z = flight.homeZ[i] + offsetZ;
      }

      flight.groundY[i] += (flight.groundTarget[i] - flight.groundY[i]) * groundEase;
      weights[i] += (flight.want[i] - weights[i]) * weightEase;

      const y =
        flight.groundY[i] +
        flight.hover[i] +
        Math.sin(time * flight.rateC[i] + flight.phaseC[i]) * flight.bob[i];

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }

    // The amortised ground sweep, reading back the positions just written. Kept
    // out of the loop above so the hot path stays branch-free; the cost of
    // re-reading a Float32Array is nothing next to a `surfaceAt` call.
    for (let k = 0; k < assets.perFrameSamples; k++) {
      const i = (cursor.current + k) % count;
      const ground = surfaceAt(positions[i * 3], positions[i * 3 + 2]);
      flight.groundTarget[i] = ground;
      flight.want[i] = groundWeight(ground);
    }
    cursor.current = (cursor.current + assets.perFrameSamples) % count;

    assets.positionAttr.needsUpdate = true;
    assets.weightAttr.needsUpdate = true;

    const uniforms = assets.material.uniforms;
    uniforms.uTime.value = time;
    uniforms.uNight.value = night;
    // Half the drawing buffer height times the projection's vertical scale is
    // exactly the pixels a one-metre object covers at one metre of depth, which
    // is what `gl_PointSize` wants. Read from the drawing buffer rather than
    // from CSS pixels — the two differ by the device pixel ratio, and getting
    // that wrong makes every fly twice the size it should be on a phone.
    state.gl.getDrawingBufferSize(scratchBuffer);
    uniforms.uScale.value =
      scratchBuffer.y * 0.5 * state.camera.projectionMatrix.elements[5];
  });

  return (
    <points
      ref={pointsRef}
      geometry={assets.geometry}
      material={assets.material}
      // The volume tracks the bard and is small enough that it is almost always
      // partly on screen; a bounding sphere that has to be recomputed from three
      // hundred moving points every frame to answer "yes" is a worse trade.
      frustumCulled={false}
    />
  );
}

/**
 * Fireflies drifting over the grass around Punaab after dark.
 *
 * The tier check lives out here, in a component with no hooks of its own, so
 * that low can be answered with a plain `null` instead of a swarm of zero flies
 * paying for a geometry, a shader and a frame callback to draw nothing.
 */
export function Fireflies({
  target,
  budget,
}: {
  target: React.RefObject<THREE.Object3D | null>;
  budget: QualityBudget;
}) {
  const count = COUNTS[budget.tier];
  if (count === 0) return null;
  return <Swarm target={target} count={count} />;
}

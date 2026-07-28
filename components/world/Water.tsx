"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RIVERS, WATERS, WATER_LEVEL, heightAt } from "@/lib/world/terrain";
import { makeFoamTexture, makeWaterNormals } from "@/lib/world/textures";
import { budgetFor, type QualityBudget } from "@/lib/world/quality";

/**
 * Every drop of standing and running water in the valley.
 *
 * Convincing water is mostly about four things, none of which are geometry.
 * A low-roughness surface, so the sky reflects off it. Normal maps scrolling in
 * two directions at different speeds, so no repeat is ever visible. Colour and
 * opacity that follow the *depth* underneath, so the bank shelves away visibly
 * instead of the whole lake being one flat blue. And a Fresnel term, so the
 * water is glass at a grazing angle and a window straight down — which is the
 * only honest way to get refraction without paying for a transmission pass.
 *
 * The one thing geometry does have to get right is the outline. A circle is a
 * hole punched in the terrain, and it is the loudest procedural tell there is,
 * so every shoreline here is found by walking outward from the centre of the
 * basin until the ground crosses the waterline. That is the definition of a
 * shore, which means it cannot disagree with the terrain no matter how the
 * terrain is retuned.
 */

const SHALLOW = new THREE.Color().setRGB(165 / 255, 203 / 255, 190 / 255, THREE.SRGBColorSpace);
const DEEP = new THREE.Color().setRGB(47 / 255, 95 / 255, 108 / 255, THREE.SRGBColorSpace);
const STREAM_EDGE = new THREE.Color().setRGB(165 / 255, 203 / 255, 190 / 255, THREE.SRGBColorSpace);
const STREAM_RUN = new THREE.Color().setRGB(95 / 255, 156 / 255, 160 / 255, THREE.SRGBColorSpace);

const SHALLOW_ALPHA = 0.26;
const DEEP_ALPHA = 0.9;

function clamp01(t: number) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Shorelines
// ---------------------------------------------------------------------------

/**
 * Where the ground crosses the waterline on a given bearing.
 *
 * Marched outward and then bisected, rather than read from whatever function
 * shaped the basin. The terrain applies its road corridor *after* its water
 * basins and the corridor wins, so a track running past a pond genuinely pushes
 * the bank in — and a shoreline derived from the basin alone would lay water
 * over the road. Asking the height field is the only answer that stays true
 * when something else edits the ground.
 */
function shoreRadius(
  cx: number,
  cz: number,
  nominal: number,
  angle: number
): number {
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const limit = nominal * 1.4;

  let low = 0;
  let high = limit;
  let found = false;
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const r = (i / steps) * limit;
    if (heightAt(cx + dx * r, cz + dz * r) >= WATER_LEVEL) {
      low = ((i - 1) / steps) * limit;
      high = r;
      found = true;
      break;
    }
  }
  if (!found) return limit;

  for (let i = 0; i < 7; i++) {
    const mid = (low + high) * 0.5;
    if (heightAt(cx + dx * mid, cz + dz * mid) >= WATER_LEVEL) high = mid;
    else low = mid;
  }

  // A floor, so a pond that a road has cut clean across still draws something
  // rather than collapsing to a point on one bearing and tearing the fan.
  return Math.max(high, nominal * 0.2);
}

type WaterSurface = {
  geometry: THREE.BufferGeometry;
  /** Shore radius per bearing, kept for the foam ring. */
  shore: Float64Array;
  bearings: number;
};

/**
 * A radial fan from the middle of a basin out to its shore.
 *
 * The rings are packed toward the edge with an exponent below one, because
 * everything interesting about a body of water happens in the last few metres:
 * that is where the colour changes, where the bed becomes visible, and where
 * the foam goes. The middle of a lake needs three rings and would happily take
 * one.
 */
function buildSurface(
  water: { x: number; z: number; radius: number },
  bearings: number,
  rings: number
): WaterSurface {
  const shore = new Float64Array(bearings);
  for (let a = 0; a < bearings; a++) {
    shore[a] = shoreRadius(
      water.x,
      water.z,
      water.radius,
      (a / bearings) * Math.PI * 2
    );
  }

  // One vertex at the centre, then `rings` rings out to the shore.
  const count = 1 + bearings * rings;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  const uvs = new Float32Array(count * 2);

  const writeVertex = (index: number, x: number, z: number, depth: number) => {
    positions[index * 3] = x;
    positions[index * 3 + 1] = WATER_LEVEL;
    positions[index * 3 + 2] = z;
    normals[index * 3] = 0;
    normals[index * 3 + 1] = 1;
    normals[index * 3 + 2] = 0;

    // Two different curves on purpose. The colour saturates within about four
    // metres, which is roughly how far you can see into fresh water; the
    // opacity keeps climbing well past that, which is why a deep lake reads as
    // solid even though its colour stopped changing long before.
    const tone = smoothstep(0, 4.2, depth);
    const solid = smoothstep(-0.15, 6.5, depth);
    colors[index * 4] = SHALLOW.r + (DEEP.r - SHALLOW.r) * tone;
    colors[index * 4 + 1] = SHALLOW.g + (DEEP.g - SHALLOW.g) * tone;
    colors[index * 4 + 2] = SHALLOW.b + (DEEP.b - SHALLOW.b) * tone;
    colors[index * 4 + 3] = SHALLOW_ALPHA + (DEEP_ALPHA - SHALLOW_ALPHA) * solid;

    // World-space UVs, so the ripple scale is the same on the mere as on a
    // twelve-metre tarn. A 0..1 unwrap would give the tarn waves the size of
    // its whole surface.
    uvs[index * 2] = x * 0.09;
    uvs[index * 2 + 1] = z * 0.09;
  };

  writeVertex(0, water.x, water.z, WATER_LEVEL - heightAt(water.x, water.z));

  for (let r = 0; r < rings; r++) {
    const t = Math.pow((r + 1) / rings, 0.72);
    for (let a = 0; a < bearings; a++) {
      const angle = (a / bearings) * Math.PI * 2;
      const radius = shore[a] * t;
      const x = water.x + Math.cos(angle) * radius;
      const z = water.z + Math.sin(angle) * radius;
      writeVertex(1 + r * bearings + a, x, z, WATER_LEVEL - heightAt(x, z));
    }
  }

  const indices: number[] = [];
  for (let a = 0; a < bearings; a++) {
    const next = (a + 1) % bearings;
    // The centre cap. Wound anticlockwise seen from above, which for a fan
    // going round by increasing angle in the XZ plane means centre, next, this.
    indices.push(0, 1 + next, 1 + a);
  }
  for (let r = 0; r < rings - 1; r++) {
    for (let a = 0; a < bearings; a++) {
      const next = (a + 1) % bearings;
      const inner = 1 + r * bearings;
      const outer = 1 + (r + 1) * bearings;
      indices.push(inner + a, outer + next, outer + a);
      indices.push(inner + a, inner + next, outer + next);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  // Four components, so three turns on `USE_COLOR_ALPHA` and the per-vertex
  // opacity reaches `diffuseColor.a`. This is what makes the shallows fade out
  // over the sand instead of stopping on a hard rim.
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return { geometry, shore, bearings };
}

/**
 * The wash at the waterline.
 *
 * A band that starts in the water and finishes a little way up the sand, so its
 * outer edge is buried under the beach and never shows as a rim. It is one more
 * strip of geometry and it does more for a shoreline than anything else here —
 * water meeting land with no disturbance at all reads as a puddle on lino.
 */
function buildFoam(surface: WaterSurface, water: { x: number; z: number }) {
  const { shore, bearings } = surface;
  const count = bearings * 2;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  for (let a = 0; a < bearings; a++) {
    const angle = (a / bearings) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const inner = Math.max(0.4, shore[a] - 2.2);
    const outer = shore[a] + 0.7;

    for (let side = 0; side < 2; side++) {
      const radius = side === 0 ? inner : outer;
      const index = a * 2 + side;
      positions[index * 3] = water.x + dx * radius;
      // A few centimetres proud of the surface. Coplanar with it and the two
      // would z-fight into a shimmering mess at any distance.
      positions[index * 3 + 1] = WATER_LEVEL + 0.045;
      positions[index * 3 + 2] = water.z + dz * radius;
      normals[index * 3] = 0;
      normals[index * 3 + 1] = 1;
      normals[index * 3 + 2] = 0;
      // U runs along the shore at a fixed metre pitch so the lace does not
      // stretch on the big lake, V runs across the band.
      uvs[index * 2] = (a / bearings) * (shore[a] * Math.PI * 2) * 0.09;
      uvs[index * 2 + 1] = side;
    }
  }

  const indices: number[] = [];
  for (let a = 0; a < bearings; a++) {
    const next = (a + 1) % bearings;
    const a0 = a * 2;
    const a1 = a * 2 + 1;
    const b0 = next * 2;
    const b1 = next * 2 + 1;
    indices.push(a0, b1, a1, a0, b0, b1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Rivers
// ---------------------------------------------------------------------------

/**
 * A watercourse, as a ribbon following its own bed.
 *
 * The surface elevation is a running minimum walked from source to mouth, for
 * the same reason the terrain's bed profile is: water runs downhill and nothing
 * else. It matters here specifically because the road network crosses these
 * courses four times and the road corridor is applied *after* the channel, so
 * the ground at those points is a causeway several metres above the stream. A
 * ribbon that followed the ground would climb over the road; a ribbon governed
 * by a running minimum passes under it and simply disappears for the width of
 * the crossing, which is what a culvert looks like.
 */
function buildRiver(curve: THREE.CatmullRomCurve3): THREE.BufferGeometry | null {
  const length = curve.getLength();
  const divisions = Math.max(8, Math.round(length / 5));
  const points = curve.getSpacedPoints(divisions);
  const n = points.length;
  if (n < 2) return null;

  const surface = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // The channel is carved two metres below the bed profile, so the ground on
    // the centre line *is* the bottom of the stream.
    surface[i] = heightAt(points[i].x, points[i].z) + 0.5;
  }
  for (let i = 1; i < n; i++) {
    surface[i] = Math.min(surface[i], surface[i - 1] - 0.005);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < n - 1; i++) {
      surface[i] = (surface[i - 1] + surface[i] * 2 + surface[i + 1]) * 0.25;
    }
  }
  for (let i = 1; i < n; i++) {
    surface[i] = Math.min(surface[i], surface[i - 1] - 0.002);
  }

  // Three vertices across, not two. The middle one is the whole reason: with
  // only banks to interpolate between, the run is one flat opacity all the way
  // over and reads as a strip of painted metal. The extra vertex buys a stream
  // you can see the shingle through at the edges and not in the middle, which
  // is what a beck actually looks like.
  const across = 3;
  const positions = new Float32Array(n * across * 3);
  const normals = new Float32Array(n * across * 3);
  const colors = new Float32Array(n * across * 4);
  const uvs = new Float32Array(n * across * 2);

  const tangent = new THREE.Vector3();
  let travelled = 0;

  for (let i = 0; i < n; i++) {
    curve.getTangentAt(Math.min(1, i / (n - 1)), tangent);
    const px = tangent.z;
    const pz = -tangent.x;
    const inverse = 1 / (Math.hypot(px, pz) || 1);

    const t = i / (n - 1);
    // A beck at its source and something you would want a bridge for by the
    // time it reaches the mere.
    const halfWidth = (1.3 + t * 4.4) * 0.5;

    if (i > 0) {
      travelled += Math.hypot(
        points[i].x - points[i - 1].x,
        points[i].z - points[i - 1].z
      );
    }

    for (let side = 0; side < across; side++) {
      const offset = side - 1;
      const index = i * across + side;
      positions[index * 3] = points[i].x + px * inverse * halfWidth * offset;
      positions[index * 3 + 1] = surface[i];
      positions[index * 3 + 2] = points[i].z + pz * inverse * halfWidth * offset;
      normals[index * 3] = 0;
      normals[index * 3 + 1] = 1;
      normals[index * 3 + 2] = 0;

      const centreness = 1 - Math.abs(offset);
      colors[index * 4] = STREAM_EDGE.r + (STREAM_RUN.r - STREAM_EDGE.r) * centreness;
      colors[index * 4 + 1] =
        STREAM_EDGE.g + (STREAM_RUN.g - STREAM_EDGE.g) * centreness;
      colors[index * 4 + 2] =
        STREAM_EDGE.b + (STREAM_RUN.b - STREAM_EDGE.b) * centreness;
      // Deeper downstream, and clear enough at the banks everywhere to show the
      // shingle the terrain paints under it.
      colors[index * 4 + 3] = (0.14 + t * 0.2) + centreness * (0.3 + t * 0.28);

      uvs[index * 2] = side * 0.5;
      // V in metres downstream, so scrolling the normal maps along V is the
      // river flowing at a constant speed regardless of how wide it has got.
      uvs[index * 2 + 1] = travelled * 0.14;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let side = 0; side < across - 1; side++) {
      const a = i * across + side;
      const b = a + 1;
      const c = (i + 1) * across + side;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

function makeWaterMaterial(
  normalA: THREE.Texture,
  normalB: THREE.Texture,
  reflective: boolean,
  cacheKey: string
) {
  const material = new THREE.MeshPhysicalMaterial({
    // Lake water is not navy. Almost everything you see looking at a lake is
    // *reflected sky*, so the body colour has to sit light enough that the
    // reflection reads on top of it — a dark base plus a procedural environment
    // map just gives you a black hole. The depth gradient lives in the vertex
    // colours; this is only the multiplier over it.
    color: "#ffffff",
    vertexColors: true,
    transparent: true,
    roughness: reflective ? 0.06 : 0.15,
    metalness: 0.03,
    normalMap: normalA,
    normalScale: new THREE.Vector2(0.34, 0.34),
    // Clearcoat gives the specular sheen of a wet surface on top of the body
    // colour, which is exactly how water behaves.
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    clearcoatNormalMap: normalB,
    clearcoatNormalScale: new THREE.Vector2(0.4, 0.4),
    envMapIntensity: reflective ? 2.2 : 1.4,
    side: THREE.FrontSide,
    depthWrite: false,
  });

  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
       // Fresnel. Water is a window looking straight down and a mirror at a
       // grazing angle, and the switch between the two is most of what the eye
       // uses to identify a liquid. Driving opacity with it is the cheap half
       // of refraction: near the shore you see the bed through it, along the
       // surface you see the sky on it, and neither costs a second render pass.
       float waterFacing = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
       float waterFresnel = pow( 1.0 - waterFacing, 3.5 );
       diffuseColor.a = clamp( mix( diffuseColor.a, 1.0, waterFresnel * 0.88 ), 0.0, 1.0 );`
    );
  };
  // three's default program cache key is the source text of `onBeforeCompile`,
  // which is identical for the lake and river materials; without a distinct key
  // the second would silently reuse the first's program.
  material.customProgramCacheKey = () => cacheKey;

  return material;
}

// ---------------------------------------------------------------------------

export function Water({
  reflective,
  budget,
}: {
  reflective?: boolean;
  budget?: QualityBudget;
}) {
  const plan = budget ?? budgetFor(reflective ? "high" : "medium");
  const wantsReflection = reflective ?? plan.waterReflections;

  const scroll = useRef({ time: 0 });

  const built = useMemo(() => {
    const group = new THREE.Group();
    group.name = "Water";

    const normalA = makeWaterNormals(256, 7);
    const normalB = makeWaterNormals(256, 23);
    // A different tiling on the second layer; matching tiling would just double
    // the amplitude of one pattern instead of breaking it up.
    normalB.repeat.set(3.5, 3.5);

    const riverNormalA = makeWaterNormals(256, 7);
    const riverNormalB = makeWaterNormals(256, 23);
    riverNormalA.repeat.set(1.6, 1.6);
    riverNormalB.repeat.set(2.9, 2.9);

    const still = makeWaterMaterial(normalA, normalB, wantsReflection, "punaab-water-still");
    const running = makeWaterMaterial(
      riverNormalA,
      riverNormalB,
      wantsReflection,
      "punaab-water-running"
    );
    // A river is churned by its own bed, so it never mirrors the sky the way a
    // lake does however calm the day is. Two-sided, because where it runs under
    // a road causeway the only face you can see is the underside.
    running.roughness = wantsReflection ? 0.14 : 0.24;
    running.clearcoatRoughness = 0.09;
    running.side = THREE.DoubleSide;

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [still, running];
    const textures: THREE.Texture[] = [
      normalA,
      normalB,
      riverNormalA,
      riverNormalB,
    ];

    // Built once, on the first shoreline that wants it. The low tier draws no
    // foam at all, and generating a 256² lace texture for something that will
    // never be rendered is exactly the sort of cost that only shows up on the
    // machines least able to absorb it.
    const foam: { material: THREE.MeshBasicMaterial | null } = { material: null };
    const foamMaterial = () => {
      if (foam.material) return foam.material;
      const map = makeFoamTexture(256);
      foam.material = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        opacity: 0.55,
        // No depth write: foam sits a few centimetres over the water and must
        // not punch a hole in what is behind it.
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      materials.push(foam.material);
      textures.push(map);
      return foam.material;
    };

    // --- standing water ---------------------------------------------------
    for (const water of WATERS) {
      // Small ponds get fewer bearings; a twelve-metre tarn with a hundred and
      // twenty-eight of them is one vertex every seven centimetres.
      const bearings = Math.max(
        28,
        Math.round(plan.waterSegments * Math.sqrt(water.radius / 58))
      );
      const rings = water.kind === "lake" ? plan.waterRings : Math.max(4, plan.waterRings - 4);

      const surface = buildSurface(water, bearings, rings);
      geometries.push(surface.geometry);

      const mesh = new THREE.Mesh(surface.geometry, still);
      mesh.name = `water-${water.id}`;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);

      if (plan.foam) {
        const foamGeometry = buildFoam(surface, water);
        geometries.push(foamGeometry);
        const foamMesh = new THREE.Mesh(foamGeometry, foamMaterial());
        foamMesh.name = `foam-${water.id}`;
        foamMesh.renderOrder = 3;
        foamMesh.matrixAutoUpdate = false;
        foamMesh.updateMatrix();
        group.add(foamMesh);
      }
    }

    // --- running water ----------------------------------------------------
    for (let i = 0; i < RIVERS.length; i++) {
      const geometry = buildRiver(RIVERS[i]);
      if (!geometry) continue;
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, running);
      mesh.name = `river-${i}`;
      mesh.renderOrder = 2;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }

    return {
      group,
      geometries,
      materials,
      textures,
      foam,
      normalA,
      normalB,
      riverNormalA,
      riverNormalB,
    };
  }, [plan, wantsReflection]);

  useFrame((_, delta) => {
    scroll.current.time += delta;
    const t = scroll.current.time;

    // Two layers scrolled against each other in opposing directions at unequal
    // speeds. That is what kills the visible tile — one layer at any speed
    // still reads as a texture sliding past.
    built.normalA.offset.set(t * 0.012, t * 0.008);
    built.normalB.offset.set(t * -0.0065, t * 0.014);

    // The rivers run down their own V axis, so this is genuinely flow rather
    // than a surface pattern drifting sideways across a stationary stream.
    built.riverNormalA.offset.set(t * 0.02, t * -0.34);
    built.riverNormalB.offset.set(t * -0.014, t * -0.22);

    // The wash advances and retreats. Scrolling U alone gives foam sliding
    // along the beach, which no water has ever done; oscillating V is the wash
    // coming up the sand and going back down it, and the opacity swinging a
    // little out of phase with it is the wave breaking.
    const foam = built.foam.material;
    if (foam?.map) {
      foam.map.offset.set(t * 0.021, Math.sin(t * 0.45) * 0.09 - 0.05);
      foam.opacity = 0.52 + Math.sin(t * 0.45 + 1.1) * 0.16;
    }
  });

  useEffect(() => {
    const { geometries, materials, textures } = built;
    return () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    };
  }, [built]);

  return <primitive object={built.group} />;
}

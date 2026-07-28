"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import {
  EMPTY_MUSIC_LEVELS,
  type MusicLevels,
} from "@/lib/bard/performance";

const COUNT = 56;
const TRAIL_LEN = 5;
const TRAIL_SEGS = COUNT * (TRAIL_LEN - 1);

type Particle = {
  x: number;
  y: number;
  z: number;
  ox: number;
  oy: number;
  oz: number;
  age: number;
  life: number;
  maxLife: number;
  /** 0 dust · 1–3 tiny notes */
  kind: number;
  phase: number;
  swayAmp: number;
  swaySpeed: number;
  rise: number;
  driftX: number;
  driftZ: number;
  seed: number;
  size: number;
  /** Ring of recent positions for the trail. */
  hx: Float32Array;
  hy: Float32Array;
  hz: Float32Array;
};

function drawTinyEighth(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number
) {
  ctx.beginPath();
  ctx.ellipse(ox, oy + s * 0.5, s * 0.32, s * 0.24, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(ox + s * 0.22, oy - s * 0.5, s * 0.1, s * 0.95);
  ctx.beginPath();
  ctx.moveTo(ox + s * 0.32, oy - s * 0.5);
  ctx.quadraticCurveTo(ox + s * 0.85, oy - s * 0.6, ox + s * 0.8, oy - s * 0.1);
  ctx.quadraticCurveTo(ox + s * 0.5, oy - s * 0.3, ox + s * 0.32, oy - s * 0.2);
  ctx.fill();
}

function drawTinyBeamed(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number
) {
  ctx.beginPath();
  ctx.ellipse(ox - s * 0.3, oy + s * 0.45, s * 0.26, s * 0.2, -0.35, 0, Math.PI * 2);
  ctx.ellipse(ox + s * 0.4, oy + s * 0.5, s * 0.26, s * 0.2, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(ox - s * 0.08, oy - s * 0.45, s * 0.09, s * 0.85);
  ctx.fillRect(ox + s * 0.62, oy - s * 0.4, s * 0.09, s * 0.85);
  ctx.fillRect(ox - s * 0.08, oy - s * 0.45, s * 0.8, s * 0.11);
}

function drawTinyQuarter(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  s: number
) {
  ctx.beginPath();
  ctx.ellipse(ox, oy + s * 0.48, s * 0.34, s * 0.26, -0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(ox + s * 0.24, oy - s * 0.5, s * 0.1, s * 0.95);
}

/** Soft 2×2 atlas: dust mote + three tiny note glyphs. */
function makeAuraAtlas(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, size, size);

    {
      const cx = 32;
      const cy = 32;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12);
      glow.addColorStop(0, "rgba(255, 252, 230, 1)");
      glow.addColorStop(0.35, "rgba(255, 230, 150, 0.85)");
      glow.addColorStop(1, "rgba(255, 180, 80, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 64, 64);
    }

    const notes = [drawTinyEighth, drawTinyBeamed, drawTinyQuarter];
    for (let i = 0; i < 3; i++) {
      const col = (i + 1) % 2;
      const row = Math.floor((i + 1) / 2);
      const cx = col * 64 + 32;
      const cy = row * 64 + 32;
      const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, 16);
      glow.addColorStop(0, "rgba(255, 250, 220, 0.7)");
      glow.addColorStop(0.55, "rgba(255, 220, 140, 0.25)");
      glow.addColorStop(1, "rgba(255, 180, 80, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(col * 64, row * 64, 64, 64);
      ctx.fillStyle = "rgba(255, 252, 235, 1)";
      notes[i](ctx, cx - 2, cy + 2, 13);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

const VERTEX = /* glsl */ `
  attribute float aKind;
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vKind;
  varying float vAlpha;
  void main() {
    vColor = color;
    vKind = aKind;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / max(0.001, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  varying vec3 vColor;
  varying float vKind;
  varying float vAlpha;
  void main() {
    float idx = clamp(floor(vKind + 0.01), 0.0, 3.0);
    float col = mod(idx, 2.0);
    float row = floor(idx / 2.0);
    vec2 uv = vec2(
      col * 0.5 + gl_PointCoord.x * 0.5,
      1.0 - row * 0.5 - gl_PointCoord.y * 0.5
    );
    vec4 tex = texture2D(map, uv);
    float a = tex.a * vAlpha;
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor * tex.rgb, a);
  }
`;

function pickSlot(list: Particle[]): number {
  let slot = 0;
  let best = list[0].life;
  for (let i = 1; i < list.length; i++) {
    if (list[i].life < best) {
      best = list[i].life;
      slot = i;
    }
  }
  return slot;
}

function clearTrail(p: Particle, x: number, y: number, z: number) {
  for (let i = 0; i < TRAIL_LEN; i++) {
    p.hx[i] = x;
    p.hy[i] = y;
    p.hz[i] = z;
  }
}

function pushTrail(p: Particle) {
  for (let i = TRAIL_LEN - 1; i > 0; i--) {
    p.hx[i] = p.hx[i - 1];
    p.hy[i] = p.hy[i - 1];
    p.hz[i] = p.hz[i - 1];
  }
  p.hx[0] = p.x;
  p.hy[0] = p.y;
  p.hz[0] = p.z;
}

function spawn(p: Particle, kind: number, energy: number) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.05 + Math.random() * 0.28;
  p.ox = Math.cos(angle) * radius;
  p.oy = 0.22 + Math.random() * 0.35;
  p.oz = Math.sin(angle) * radius * 0.65;
  p.x = p.ox;
  p.y = p.oy;
  p.z = p.oz;
  clearTrail(p, p.x, p.y, p.z);
  p.age = 0;
  p.maxLife = 2.8 + Math.random() * 3.4;
  p.life = p.maxLife;
  p.kind = kind;
  p.phase = Math.random() * Math.PI * 2;
  p.swayAmp = 0.06 + Math.random() * 0.12;
  p.swaySpeed = 0.7 + Math.random() * 1.1;
  p.rise = 0.09 + Math.random() * 0.12 + energy * 0.035;
  p.driftX = (Math.random() - 0.5) * 0.05;
  p.driftZ = (Math.random() - 0.5) * 0.05;
  p.seed = Math.random() * 40;
  // Tiny heads — notes a hair larger than dust.
  p.size = kind === 0 ? 0.55 + Math.random() * 0.4 : 0.75 + Math.random() * 0.5;
}

/**
 * Tiny dust / note visualizer with short light trails — clearer, smaller,
 * driven by the live track.
 */
export function SongAura({
  intensity,
  sampleMusic,
}: {
  intensity: RefObject<number>;
  sampleMusic: RefObject<() => MusicLevels>;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const trailsRef = useRef<THREE.LineSegments>(null);
  const particles = useRef<Particle[]>([]);
  const spawnAcc = useRef(0);
  const trailTick = useRef(0);
  const smoothed = useRef({ ...EMPTY_MUSIC_LEVELS });

  const assets = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const kinds = new Float32Array(COUNT);
    const sizes = new Float32Array(COUNT);
    const alphas = new Float32Array(COUNT);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

    const trailPos = new Float32Array(TRAIL_SEGS * 2 * 3);
    const trailCol = new Float32Array(TRAIL_SEGS * 2 * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));

    const map = makeAuraAtlas();
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    const trailMat = new THREE.LineBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      opacity: 1,
    });

    const list: Particle[] = [];
    for (let i = 0; i < COUNT; i++) {
      list.push({
        x: 0,
        y: -10,
        z: 0,
        ox: 0,
        oy: 0,
        oz: 0,
        age: 0,
        life: 0,
        maxLife: 1,
        kind: 0,
        phase: 0,
        swayAmp: 0,
        swaySpeed: 0,
        rise: 0,
        driftX: 0,
        driftZ: 0,
        seed: 0,
        size: 1,
        hx: new Float32Array(TRAIL_LEN),
        hy: new Float32Array(TRAIL_LEN),
        hz: new Float32Array(TRAIL_LEN),
      });
    }
    particles.current = list;

    return { geo, mat, map, trailGeo, trailMat };
  }, []);

  useEffect(() => {
    return () => {
      assets.geo.dispose();
      assets.mat.dispose();
      assets.map.dispose();
      assets.trailGeo.dispose();
      assets.trailMat.dispose();
    };
  }, [assets]);

  useFrame((_state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const amount = Math.max(0, intensity.current);
    const levels = sampleMusic.current?.() ?? EMPTY_MUSIC_LEVELS;
    const smooth = smoothed.current;
    smooth.bass += (levels.bass - smooth.bass) * Math.min(1, delta * 5);
    smooth.mid += (levels.mid - smooth.mid) * Math.min(1, delta * 5);
    smooth.treble += (levels.treble - smooth.treble) * Math.min(1, delta * 6);
    smooth.energy += (levels.energy - smooth.energy) * Math.min(1, delta * 4);

    const visible = amount > 0.05;
    if (pointsRef.current) pointsRef.current.visible = visible;
    if (trailsRef.current) trailsRef.current.visible = visible;
    if (!visible) return;

    const pos = assets.geo.attributes.position as THREE.BufferAttribute;
    const col = assets.geo.attributes.color as THREE.BufferAttribute;
    const kindAttr = assets.geo.attributes.aKind as THREE.BufferAttribute;
    const sizeAttr = assets.geo.attributes.aSize as THREE.BufferAttribute;
    const alphaAttr = assets.geo.attributes.aAlpha as THREE.BufferAttribute;
    const trailPos = assets.trailGeo.attributes.position as THREE.BufferAttribute;
    const trailCol = assets.trailGeo.attributes.color as THREE.BufferAttribute;
    const list = particles.current;

    const rate =
      0.4 +
      amount * (0.7 + smooth.energy * 2 + smooth.mid * 1.2 + smooth.bass * 0.9);
    spawnAcc.current += delta * rate;
    while (spawnAcc.current >= 1) {
      spawnAcc.current -= 1;
      const slot = pickSlot(list);
      const wantNote =
        Math.random() < 0.3 + smooth.mid * 0.28 + smooth.treble * 0.15;
      const kind = wantNote ? 1 + Math.floor(Math.random() * 3) : 0;
      spawn(list[slot], kind, smooth.energy);
    }

    // Sample trail history a bit slower than the framerate for smoother ribbons.
    trailTick.current += delta;
    const recordTrail = trailTick.current >= 0.03;
    if (recordTrail) trailTick.current = 0;

    for (let i = 0; i < COUNT; i++) {
      const p = list[i];
      const trailBase = i * (TRAIL_LEN - 1);

      if (p.life <= 0) {
        pos.setXYZ(i, 0, -20, 0);
        col.setXYZ(i, 0, 0, 0);
        kindAttr.setX(i, 0);
        sizeAttr.setX(i, 0);
        alphaAttr.setX(i, 0);
        for (let s = 0; s < TRAIL_LEN - 1; s++) {
          const a = (trailBase + s) * 2;
          trailPos.setXYZ(a, 0, -20, 0);
          trailPos.setXYZ(a + 1, 0, -20, 0);
          trailCol.setXYZ(a, 0, 0, 0);
          trailCol.setXYZ(a + 1, 0, 0, 0);
        }
        continue;
      }

      p.life -= delta;
      p.age += delta;

      const sway =
        Math.sin(p.age * p.swaySpeed + p.phase) * p.swayAmp +
        Math.sin(p.age * (p.swaySpeed * 0.55) + p.seed) * p.swayAmp * 0.45;
      const swayZ =
        Math.cos(p.age * p.swaySpeed * 0.85 + p.phase) * p.swayAmp * 0.7;

      p.x = p.ox + p.driftX * p.age + sway;
      p.z = p.oz + p.driftZ * p.age + swayZ;
      p.y = p.oy + p.age * p.rise * (1 + smooth.energy * 0.2);

      if (recordTrail) pushTrail(p);
      else {
        p.hx[0] = p.x;
        p.hy[0] = p.y;
        p.hz[0] = p.z;
      }

      const t = 1 - p.life / p.maxLife;
      const fade =
        t < 0.18 ? t / 0.18 : t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.4) : 1;
      const band =
        p.kind === 0
          ? 0.55 + smooth.bass * 0.4 + smooth.energy * 0.25
          : 0.65 + smooth.mid * 0.35 + smooth.treble * 0.25;
      // Soft enough to sit in the scene without looking chalky.
      const alpha = Math.min(1, fade * amount * band * 0.72);

      pos.setXYZ(i, p.x, p.y, p.z);
      col.setXYZ(i, 1.0, 0.9, 0.62);
      kindAttr.setX(i, p.kind);
      sizeAttr.setX(i, p.size * (1 + smooth.energy * 0.1));
      alphaAttr.setX(i, alpha);

      for (let s = 0; s < TRAIL_LEN - 1; s++) {
        const a = (trailBase + s) * 2;
        const b = a + 1;
        const headFade = 1 - s / (TRAIL_LEN - 1);
        const tailFade = 1 - (s + 1) / (TRAIL_LEN - 1);
        trailPos.setXYZ(a, p.hx[s], p.hy[s], p.hz[s]);
        trailPos.setXYZ(b, p.hx[s + 1], p.hy[s + 1], p.hz[s + 1]);
        const ha = alpha * headFade * 0.55;
        const ta = alpha * tailFade * 0.25;
        trailCol.setXYZ(a, 1.0 * ha, 0.88 * ha, 0.5 * ha);
        trailCol.setXYZ(b, 0.9 * ta, 0.65 * ta, 0.25 * ta);
      }
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    kindAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    trailPos.needsUpdate = true;
    trailCol.needsUpdate = true;
  });

  return (
    <group>
      <lineSegments
        ref={trailsRef}
        geometry={assets.trailGeo}
        material={assets.trailMat}
        frustumCulled={false}
      />
      <points
        ref={pointsRef}
        geometry={assets.geo}
        material={assets.mat}
        frustumCulled={false}
      />
    </group>
  );
}

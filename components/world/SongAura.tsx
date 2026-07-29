"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import {
  EMPTY_MUSIC_LEVELS,
  type MusicLevels,
} from "@/lib/bard/performance";
import { daylight } from "@/lib/world/daylight";
import type { QualityBudget } from "@/lib/world/quality";

const COUNT = 56;
const TRAIL_LEN = 5;
const TRAIL_SEGS = COUNT * (TRAIL_LEN - 1);

// ---------------------------------------------------------------------------
// The note lights
// ---------------------------------------------------------------------------

/**
 * How many of the fifty-six motes are allowed to be actual light sources.
 *
 * A point light costs every lit fragment in the frame, whether or not it
 * reaches them, so this is the one number in the file that has to be a budget
 * rather than a taste call. Three is enough for the effect: the eye reads "the
 * notes are glowing" off the two or three brightest ones and invents the rest,
 * because the additive sprites are already selling the same idea for free.
 *
 * The count is fixed for the lifetime of the component on purpose. Adding or
 * removing a light — or hiding one, which amounts to the same thing, since the
 * renderer skips invisible objects when it collects lights — changes the shader
 * program every material in the scene is compiled against, and recompiling two
 * hundred thousand grass tufts' worth of shaders mid-song is a visible hitch.
 * That is why silence is `intensity = 0` rather than `visible = false`.
 */
const SONG_LIGHTS: Record<QualityBudget["tier"], number> = {
  low: 0,
  medium: 2,
  high: 3,
};

/** Peak candela for one note at full song, full dark. */
const SONG_LIGHT_PEAK = 1.25;
/**
 * Fraction of that left in broad daylight.
 *
 * Not zero — a mote passing a shaded jaw still owes the face a touch of warmth
 * at noon — but small enough that nobody could point at it, because a daylight
 * scene lit at 2.15 has no room for a candle and the effect would only read as
 * the bard's chin going slightly greasy.
 */
const SONG_LIGHT_DAY = 0.06;
/** Beyond this the note is not worth lighting; well short of the aura's reach. */
const SONG_LIGHT_RANGE = 7;
const SONG_LIGHT_DECAY = 2;
/** Warm, and a shade deeper than the sprite so the lit surfaces read as amber. */
const SONG_LIGHT_COLOR = "#ffcf92";
/**
 * A note dimmer than this is not worth a light slot.
 *
 * Doubles as the hand-off threshold: a slot holds its note until the note fades
 * past here, then takes the best unclaimed one. Re-picking every frame instead
 * would strobe, because the brightest particle changes constantly and the light
 * would teleport between them several times a second.
 */
const SONG_LIGHT_MIN_ALPHA = 0.06;

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
  /**
   * Alpha the sprite was drawn at this frame, 0 when dead.
   *
   * Cached on the particle rather than recomputed by the light pass because it
   * already folds in fade, band energy and the play-weight — everything that
   * makes one mote brighter than another — so the lights and the sprites can
   * never disagree about which note is the brightest one in the air.
   */
  alpha: number;
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
  p.alpha = 0;
  // Tiny heads — notes a hair larger than dust.
  p.size = kind === 0 ? 0.55 + Math.random() * 0.4 : 0.75 + Math.random() * 0.5;
}

/**
 * Tiny dust / note visualizer with short light trails — clearer, smaller,
 * driven by the live track.
 *
 * The sprites are additive and cost nothing but fill; the handful of point
 * lights that ride the brightest of them are the expensive part, and the reason
 * the aura affects the world after dark instead of merely floating over it.
 */
export function SongAura({
  intensity,
  sampleMusic,
  budget,
}: {
  intensity: RefObject<number>;
  sampleMusic: RefObject<() => MusicLevels>;
  budget: QualityBudget;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const trailsRef = useRef<THREE.LineSegments>(null);
  const particles = useRef<Particle[]>([]);
  const spawnAcc = useRef(0);
  const trailTick = useRef(0);
  const smoothed = useRef({ ...EMPTY_MUSIC_LEVELS });

  const lightCount = SONG_LIGHTS[budget.tier];
  const lightRefs = useRef<Array<THREE.PointLight | null>>([]);
  /** Particle index each light slot is riding, -1 for a slot with no note. */
  const lightOwner = useMemo(
    () => new Int32Array(lightCount).fill(-1),
    [lightCount]
  );

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
        alpha: 0,
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
    if (!visible) {
      // Silence has to be *dark*, and it has to be dark without unmounting
      // anything: the lights stay in the scene at zero so the song can start
      // again without every shader in the valley being rebuilt for it.
      for (let slot = 0; slot < lightCount; slot++) {
        const light = lightRefs.current[slot];
        if (light) light.intensity = 0;
        lightOwner[slot] = -1;
      }
      return;
    }

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
        p.alpha = 0;
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
      p.alpha = alpha;

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

    // --- note lights --------------------------------------------------------
    //
    // The sprites are additive, which means that until now the aura has been
    // painted *over* the valley rather than into it: bright at noon, and at
    // midnight a fistful of glowing confetti floating in front of a bard who is
    // still lit by nothing but the moon. These few point lights are what close
    // that gap — the notes stop being a decal and start being the reason his
    // face and the dirt under him are warm.
    //
    // So the night term is not a polish pass, it is the point. At noon the
    // lights are all but off because the sun has already spent the whole
    // dynamic range; after dusk they are the brightest thing near him.
    const night = SONG_LIGHT_DAY + daylight.nightFactor * (1 - SONG_LIGHT_DAY);
    // Loudness, not just "a song is playing" — a quiet passage should dim the
    // meadow it is lighting. Capped because a mastered track's energy and mid
    // peak together, and an uncapped product turns every chorus into a flare.
    const drive = Math.min(
      1.15,
      amount * (0.3 + smooth.energy * 0.85 + smooth.mid * 0.4 + smooth.treble * 0.25)
    );

    for (let slot = 0; slot < lightCount; slot++) {
      const light = lightRefs.current[slot];
      if (!light) continue;

      let owner = lightOwner[slot];
      if (owner >= 0 && list[owner].alpha < SONG_LIGHT_MIN_ALPHA) owner = -1;

      if (owner < 0) {
        // Brightest note in the air, tie-broken towards the youngest — a mote
        // on the way up carries its light further than one about to wink out,
        // so the pool spends its slots on notes with some life left in them.
        let best = -1;
        let bestScore = SONG_LIGHT_MIN_ALPHA;
        for (let i = 0; i < COUNT; i++) {
          const p = list[i];
          if (p.life <= 0) continue;
          let taken = false;
          for (let j = 0; j < lightCount; j++) {
            if (j !== slot && lightOwner[j] === i) {
              taken = true;
              break;
            }
          }
          if (taken) continue;
          const score = p.alpha * (0.6 + 0.4 * (p.life / p.maxLife));
          if (score > bestScore) {
            bestScore = score;
            best = i;
          }
        }
        owner = best;
        lightOwner[slot] = owner;
        // Land on the new note before it is lit, never drag a live light
        // across the intervening half metre.
        if (owner >= 0) {
          light.position.set(list[owner].x, list[owner].y, list[owner].z);
          light.intensity = 0;
        }
      }

      if (owner < 0) {
        light.intensity = 0;
        continue;
      }

      const p = list[owner];
      light.position.set(p.x, p.y, p.z);
      // Ease rather than snap: the hand-off from a spent note to a fresh one is
      // a step change in brightness, and a step change in a light reads as a
      // flashbulb even when the two notes are inches apart.
      const target = SONG_LIGHT_PEAK * p.alpha * drive * night;
      light.intensity += (target - light.intensity) * Math.min(1, delta * 10);
    }
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
      {/*
        Mounted for the lifetime of the scene and driven to zero when he is not
        playing. The count comes from the budget, which is fixed at boot, so the
        renderer's light state — and every shader compiled against it — never
        changes after the first frame.
      */}
      {Array.from({ length: lightCount }, (_, i) => (
        <pointLight
          key={i}
          ref={(light: THREE.PointLight | null) => {
            lightRefs.current[i] = light;
          }}
          color={SONG_LIGHT_COLOR}
          intensity={0}
          distance={SONG_LIGHT_RANGE}
          decay={SONG_LIGHT_DECAY}
          castShadow={false}
        />
      ))}
    </group>
  );
}

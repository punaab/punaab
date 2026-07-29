"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { daylight, NIGHT } from "@/lib/world/daylight";
import type { QualityBudget } from "@/lib/world/quality";

/**
 * Everything in the sky that only exists after dark: stars, the Milky Way, the
 * moon, and the occasional meteor.
 *
 * ## Why these are drawn at the far plane
 *
 * The scene camera has `far = 620` and the valley is 640 metres across, so
 * there is no radius at which a star dome is reliably *behind* the mountains
 * and still *inside* the frustum. Putting the dome on a sphere of radius 600
 * works until the bard walks towards a peak that is 700 metres away.
 *
 * So the star shader does what three's own `Sky` does and forces
 * `gl_Position.z = gl_Position.w`, pinning every vertex to the far plane no
 * matter where it actually is. The stars sit a hair inside it (`0.999999`) so
 * they draw in front of the sky dome, which is exactly *at* it, while still
 * losing the depth test against any terrain in the way. The result is a dome
 * that is always infinitely far away and always correctly occluded.
 *
 * ## Why the twinkle is in the shader
 *
 * Four thousand stars each needing a brightness every frame is four thousand
 * CPU writes into a buffer plus an upload, sixty times a second, to animate
 * something that is one multiply. The phase and rate are baked per star at
 * build time and the animation is a single uniform.
 */

/** Radius the geometry is authored at. Irrelevant to where it draws — see above. */
const DOME_RADIUS = 500;

/**
 * Deterministic PRNG.
 *
 * `Math.imul` is not decoration. The 32-bit constants below exceed 2^53 when
 * multiplied by a large seed under plain `*`, and the silent precision loss
 * destroys the sequence — this repo has already been bitten by exactly that in
 * its terrain hash, where it clustered every scattered prop into one quadrant
 * of the map. A sky built on a broken hash would put every star in one corner.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Star colours by spectral class, hottest first.
 *
 * A real night sky is not white. Rigel is blue, Betelgeuse is orange, and the
 * eye picks up the difference readily once a few of them are bright enough to
 * have any colour at all. Weighting towards the cool end matters as much: most
 * stars visible to the naked eye are yellow-white, so a sky of evenly mixed
 * colours reads as a screensaver.
 */
const STAR_COLOURS: Array<[number, string]> = [
  [0.06, "#9DB4FF"],
  [0.14, "#BFD0FF"],
  [0.34, "#EAF0FF"],
  [0.62, "#FFF6E8"],
  [0.85, "#FFE0B0"],
  [1.0, "#FFBE86"],
];

function starColour(u: number, out: THREE.Color): THREE.Color {
  for (const [threshold, hex] of STAR_COLOURS) {
    if (u <= threshold) return out.set(hex);
  }
  return out.set("#FFF6E8");
}

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aRate;
  attribute float aBright;

  uniform float uTime;
  uniform float uOpacity;
  uniform float uPixelRatio;

  varying vec3 vColour;
  varying float vAlpha;

  void main() {
    vColour = color;

    // Scintillation is atmospheric, so it is strongest near the horizon where
    // you are looking through the most air, and almost absent overhead. Two
    // incommensurable rates keep it from settling into a visible pulse.
    float horizon = 1.0 - abs( normalize( position ).y );
    float shimmer =
      sin( uTime * aRate + aPhase ) * 0.5 +
      sin( uTime * aRate * 2.37 + aPhase * 1.7 ) * 0.28;
    float twinkle = 1.0 + shimmer * ( 0.12 + horizon * 0.42 );

    vAlpha = aBright * uOpacity * twinkle;

    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    gl_PointSize = aSize * uPixelRatio * max( 0.35, twinkle );
    gl_Position = projectionMatrix * mvPosition;

    // Pin to just inside the far plane: in front of the sky dome, behind and
    // therefore occluded by any terrain the depth buffer already holds.
    gl_Position.z = gl_Position.w * 0.999999;
  }
`;

const STAR_FRAG = /* glsl */ `
  varying vec3 vColour;
  varying float vAlpha;

  void main() {
    vec2 d = gl_PointCoord - vec2( 0.5 );
    float r = length( d ) * 2.0;
    if ( r > 1.0 ) discard;

    // A star is a point source, so its profile is a tight core with a wide
    // faint halo — not a gaussian blob. Two falloffs summed gets there in far
    // fewer instructions than anything sampled from a texture.
    float core = pow( max( 0.0, 1.0 - r ), 7.0 );
    float halo = pow( max( 0.0, 1.0 - r ), 2.0 ) * 0.22;

    // Faint diffraction spikes, the artefact every eye reads as "bright star".
    float spike = max( 0.0, 1.0 - abs( d.x ) * 26.0 ) * max( 0.0, 1.0 - abs( d.y ) * 3.0 )
                + max( 0.0, 1.0 - abs( d.y ) * 26.0 ) * max( 0.0, 1.0 - abs( d.x ) * 3.0 );

    float a = ( core + halo + spike * 0.28 ) * vAlpha;
    if ( a < 0.004 ) discard;
    gl_FragColor = vec4( vColour, a );
  }
`;

type StarField = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
};

/**
 * Build the dome.
 *
 * Two populations. A uniform scatter over the whole sphere is the sky you can
 * see on any clear night; a second, denser, dimmer population pressed into a
 * band is the Milky Way. Drawing the galaxy as a texture was the alternative
 * and it is worse — a painted band has a visible edge and does not twinkle,
 * and at this count the stars themselves are cheaper than the fill rate a
 * dome-sized transparent quad would cost.
 */
function makeStarField(count: number, pixelRatio: number): StarField {
  const random = mulberry32(0x51a55eed);

  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const rates = new Float32Array(count);
  const brights = new Float32Array(count);

  const scratch = new THREE.Color();

  // The galactic plane, tilted well off both the horizon and the vertical so
  // the band cuts the sky diagonally from whatever direction you happen to be
  // facing. A band parallel to the horizon reads as a cloud.
  const bandNormal = new THREE.Vector3(0.42, 0.62, -0.66).normalize();
  const bandTangentA = new THREE.Vector3(1, 0, 0)
    .cross(bandNormal)
    .normalize();
  const bandTangentB = bandNormal.clone().cross(bandTangentA).normalize();

  const MILKY_SHARE = 0.34;

  for (let i = 0; i < count; i++) {
    const inBand = random() < MILKY_SHARE;

    let x: number;
    let y: number;
    let z: number;

    if (inBand) {
      // Inside the band: pick a bearing around the galactic plane, then push
      // off it by a normally-distributed amount so the band has soft edges and
      // a dense spine rather than a hard-edged stripe.
      const angle = random() * Math.PI * 2;
      // Sum of uniforms — a cheap, adequate normal, and it cannot produce the
      // unbounded outliers a true gaussian would fling across the whole sky.
      const spread =
        (random() + random() + random() - 1.5) * 0.17;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      x = bandTangentA.x * ca + bandTangentB.x * sa + bandNormal.x * spread;
      y = bandTangentA.y * ca + bandTangentB.y * sa + bandNormal.y * spread;
      z = bandTangentA.z * ca + bandTangentB.z * sa + bandNormal.z * spread;
      const inv = 1 / Math.hypot(x, y, z);
      x *= inv;
      y *= inv;
      z *= inv;
    } else {
      // Uniform on the sphere. Sampling the *height* uniformly rather than the
      // polar angle is what makes it uniform; the obvious version clumps at
      // the poles, which here would be a bald patch of sky straight overhead.
      const u = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - u * u));
      x = ring * Math.cos(angle);
      y = u;
      z = ring * Math.sin(angle);
    }

    // Nothing below the horizon: half the dome would be inside the terrain and
    // every one of those stars is a vertex shaded for nothing.
    if (y < 0) y = -y;
    // Lift off the horizon line itself, where the dome meets the ground plane
    // and a star would sit visibly *on* the mountains.
    y = 0.012 + y * 0.988;

    const inv = 1 / Math.hypot(x, y, z);
    positions[i * 3] = x * inv * DOME_RADIUS;
    positions[i * 3 + 1] = y * inv * DOME_RADIUS;
    positions[i * 3 + 2] = z * inv * DOME_RADIUS;

    // Apparent magnitude. The fourth power is what gives a real sky its
    // character: a handful of genuinely bright stars over a wash of faint
    // ones. Uniform brightness looks like static.
    const magnitude = Math.pow(random(), 4);
    const bandDim = inBand ? 0.4 : 1;

    starColour(random(), scratch);
    colours[i * 3] = scratch.r;
    colours[i * 3 + 1] = scratch.g;
    colours[i * 3 + 2] = scratch.b;

    sizes[i] = (0.9 + magnitude * 3.9) * (inBand ? 0.62 : 1);
    brights[i] = (0.22 + magnitude * 0.95) * bandDim;
    phases[i] = random() * Math.PI * 2;
    rates[i] = 0.6 + random() * 2.4;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aRate", new THREE.BufferAttribute(rates, 1));
  geometry.setAttribute("aBright", new THREE.BufferAttribute(brights, 1));
  // The dome is recentred on the camera every frame, so a bounding sphere
  // computed once at the origin would cull it the moment the bard walks away.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    DOME_RADIUS * 1.5
  );

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uPixelRatio: { value: pixelRatio },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  return { geometry, material };
}

/**
 * The moon disc, drawn once into a canvas.
 *
 * A textured billboard rather than lit geometry because the moon is the one
 * object in the scene whose shading is not a function of the scene's own
 * lighting — it has to look right when the key light is pointed *at the
 * camera from behind it*, which no material in the valley will do for free.
 */
function makeMoonTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const centre = size / 2;
  const discRadius = size * 0.27;

  if (ctx) {
    ctx.clearRect(0, 0, size, size);

    // Halo first, so the disc paints over its middle.
    const halo = ctx.createRadialGradient(
      centre,
      centre,
      discRadius * 0.8,
      centre,
      centre,
      centre
    );
    halo.addColorStop(0, "rgba(206, 224, 255, 0.40)");
    halo.addColorStop(0.28, "rgba(178, 202, 255, 0.13)");
    halo.addColorStop(1, "rgba(150, 180, 255, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, size, size);

    const body = ctx.createRadialGradient(
      centre - discRadius * 0.22,
      centre - discRadius * 0.26,
      discRadius * 0.1,
      centre,
      centre,
      discRadius
    );
    body.addColorStop(0, "rgba(255, 253, 246, 1)");
    body.addColorStop(0.68, "rgba(235, 238, 246, 1)");
    // Limb darkening — the edge of a real disc falls off before it ends.
    body.addColorStop(0.94, "rgba(198, 208, 226, 1)");
    body.addColorStop(1, "rgba(180, 192, 214, 0)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(centre, centre, discRadius, 0, Math.PI * 2);
    ctx.fill();

    // Maria. Hand-placed rather than random: the pattern on the moon is the
    // most recognisable shape in the night sky, and a random scatter of grey
    // blobs reads instantly as "not the moon".
    ctx.globalCompositeOperation = "source-atop";
    const maria: Array<[number, number, number, number]> = [
      [-0.30, -0.24, 0.30, 0.13],
      [0.02, -0.34, 0.22, 0.10],
      [-0.36, 0.14, 0.24, 0.09],
      [0.20, 0.10, 0.30, 0.08],
      [-0.06, 0.36, 0.20, 0.07],
      [0.34, -0.12, 0.16, 0.07],
    ];
    for (const [mx, my, mr, alpha] of maria) {
      const gx = centre + mx * discRadius;
      const gy = centre + my * discRadius;
      const gr = mr * discRadius;
      const patch = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      patch.addColorStop(0, `rgba(122, 134, 158, ${alpha})`);
      patch.addColorStop(1, "rgba(122, 134, 158, 0)");
      ctx.fillStyle = patch;
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A meteor.
 *
 * One at a time, on a long random interval. This is pure delight and costs two
 * triangles, but the restraint matters — a sky with a shooting star every three
 * seconds is a screensaver, and the whole effect of a meteor is that you are
 * not sure you saw it.
 */
function Meteor({ enabled }: { enabled: React.RefObject<number> }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const state = useRef({ wait: 6, life: 0, duration: 1 });

  const { geometry, material, from, to, axis, basis, right, up, normal } = useMemo(() => {
    // A tapered streak: wide and bright at the head, vanishing at the tail.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, 0.5, 0, 0, -0.5, 0, -1, -0.12, 0, 0, 0.5, 0, -1, -0.12, 0, -1, 0.12, 0],
        3
      )
    );
    geo.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0],
        3
      )
    );
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    return {
      geometry: geo,
      material: mat,
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      basis: new THREE.Matrix4(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      normal: new THREE.Vector3(),
    };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  useFrame((threeState, rawDelta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const visible = enabled.current;
    const delta = Math.min(rawDelta, 0.05);

    if (state.current.life > 0) {
      state.current.life -= delta;
      const progress = 1 - state.current.life / state.current.duration;
      mesh.position.lerpVectors(from, to, progress);
      mesh.position.add(threeState.camera.position);
      // Bright on entry, gone before it lands — the classic meteor envelope.
      const fade =
        Math.min(1, progress * 8) * Math.max(0, 1 - Math.pow(progress, 2.2));
      material.opacity = fade * visible;
      mesh.visible = material.opacity > 0.01;
      return;
    }

    mesh.visible = false;
    if (visible < 0.4) return;

    state.current.wait -= delta;
    if (state.current.wait > 0) return;

    // Somewhere in the upper sky, travelling a long shallow arc.
    const theta = Math.random() * Math.PI * 2;
    const height = 0.35 + Math.random() * 0.5;
    const ring = Math.sqrt(Math.max(0, 1 - height * height));
    from.set(
      Math.cos(theta) * ring,
      height,
      Math.sin(theta) * ring
    ).multiplyScalar(DOME_RADIUS);
    axis
      .set(Math.random() - 0.5, Math.random() * 0.4 - 0.55, Math.random() - 0.5)
      .normalize();
    to.copy(from).addScaledVector(axis, DOME_RADIUS * (0.28 + Math.random() * 0.3));

    // Long axis along travel, and long enough to read as a streak. The
    // geometry runs from x=0 at the head to x=-1 at the tail, so X is the
    // length and Y the width.
    mesh.scale.set(from.distanceTo(to) * 0.16, 2.6 + Math.random() * 2.4, 1);

    // Orient it by hand rather than with `lookAt`.
    //
    // `lookAt` aims local +Z at a target and leaves the roll to an arbitrary
    // up-vector, which for a streak means the trail points somewhere unrelated
    // to where the meteor is actually travelling — the one thing about a
    // meteor a viewer is guaranteed to notice.
    //
    // So the basis is built explicitly: the quad's normal faces the camera,
    // and its long axis lies along the direction of travel projected into that
    // plane. The dome is camera-centred, so `from` *is* the view direction.
    normal.copy(from).normalize().negate();
    right.subVectors(to, from).normalize().negate();
    // Gram-Schmidt: drop whatever part of the travel direction points at the
    // camera, leaving only what is visible on screen.
    right.addScaledVector(normal, -right.dot(normal));
    if (right.lengthSq() < 1e-6) {
      // Travelling straight at the viewer. There is no on-screen direction to
      // align to, so any perpendicular will do.
      right.set(normal.y, -normal.x, 0).normalize();
    } else {
      right.normalize();
    }
    up.crossVectors(normal, right).normalize();
    basis.makeBasis(right, up, normal);
    mesh.quaternion.setFromRotationMatrix(basis);

    state.current.duration = 0.55 + Math.random() * 0.5;
    state.current.life = state.current.duration;
    state.current.wait = 9 + Math.random() * 26;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}

const STAR_COUNT: Record<QualityBudget["tier"], number> = {
  low: 1400,
  medium: 3200,
  high: 5200,
};

/**
 * Stars, Milky Way, moon and meteors — the whole night half of the sky.
 *
 * Everything here recentres on the camera each frame rather than sitting at the
 * world origin, because a dome fixed in world space parallaxes as the bard
 * walks: stars would slide behind the mountains and the moon would drift across
 * the sky in the time it takes to cross the valley.
 */
export function NightSky({ budget }: { budget: QualityBudget }) {
  const camera = useThree((state) => state.camera);
  const domeRef = useRef<THREE.Points>(null);
  const moonRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const meteorEnabled = useRef(0);

  const stars = useMemo(
    () =>
      makeStarField(
        STAR_COUNT[budget.tier],
        Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio)
      ),
    [budget.tier]
  );

  const moon = useMemo(() => {
    const texture = makeMoonTexture(budget.tier === "low" ? 256 : 512);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      // The moon is the brightest thing in a night frame by a wide margin, and
      // tone mapping exists to roll off exactly that. Letting ACES compress it
      // turns a crisp disc into a grey smudge.
      toneMapped: false,
      opacity: 0,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    return { texture, material, geometry };
  }, [budget.tier]);

  useEffect(
    () => () => {
      stars.geometry.dispose();
      stars.material.dispose();
      moon.texture.dispose();
      moon.material.dispose();
      moon.geometry.dispose();
    },
    [stars, moon]
  );

  useFrame((state) => {
    const alpha = daylight.starAlpha;
    meteorEnabled.current = alpha;

    const dome = domeRef.current;
    if (dome) {
      dome.visible = alpha > 0.002;
      if (dome.visible) {
        dome.position.copy(camera.position);
        stars.material.uniforms.uTime.value = state.clock.elapsedTime;
        stars.material.uniforms.uOpacity.value = alpha;
        // A slow rotation about the vertical is the only motion a real sky has
        // over the length of a visit, and it is what stops the dome reading as
        // wallpaper. One full turn per twelve of our days.
        dome.rotation.y = daylight.t * Math.PI * 2 * 0.083;
      }
    }

    const moonMesh = moonRef.current;
    if (moonMesh) {
      const moonAlpha = daylight.moonAlpha;
      moonMesh.visible = moonAlpha > 0.004;
      if (moonMesh.visible) {
        moonMesh.position
          .copy(daylight.moonDir)
          .multiplyScalar(DOME_RADIUS * 0.94)
          .add(camera.position);
        moonMesh.quaternion.copy(camera.quaternion);
        // Dim towards the horizon, where a real moon reddens and fades through
        // the thick air rather than sitting at full brightness on the skyline.
        const low = THREE.MathUtils.smoothstep(daylight.moonDir.y, 0.02, 0.34);
        moon.material.opacity = moonAlpha * (0.35 + low * 0.65);
      }
    }

    // A faint cool fill anchored on the moon's side of the sky. The key light
    // already carries moonlight's direction; this is the wrap-around that keeps
    // the shadowed side of everything from going flat black.
    const glow = glowRef.current;
    if (glow) {
      glow.intensity = daylight.moonAlpha * 1.9;
      glow.visible = glow.intensity > 0.01;
      if (glow.visible) {
        glow.position
          .copy(daylight.moonDir)
          .multiplyScalar(42)
          .add(camera.position);
      }
    }
  });

  return (
    <group name="NightSky">
      <points
        ref={domeRef}
        geometry={stars.geometry}
        material={stars.material}
        frustumCulled={false}
        renderOrder={1}
      />
      <mesh
        ref={moonRef}
        geometry={moon.geometry}
        material={moon.material}
        scale={[92, 92, 1]}
        frustumCulled={false}
        renderOrder={1}
      />
      <pointLight
        ref={glowRef}
        color={NIGHT.star}
        distance={150}
        decay={1.1}
        intensity={0}
        castShadow={false}
      />
      {budget.tier !== "low" && <Meteor enabled={meteorEnabled} />}
    </group>
  );
}

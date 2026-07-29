import * as THREE from "three";
import { GHIBLI, GHIBLI_SUN_AZIM_DEG, GHIBLI_SUN_ELEV_DEG } from "@/lib/world/ghibli-palette";

/**
 * The valley's clock, and the single source of truth for every light in it.
 *
 * One module owns the sun, and everything that has to agree with the sun reads
 * from here: the sky dome, the key light, the fog, the terrain's aerial haze
 * uniforms, the grass tint, the lit windows, the fireflies, the lantern on
 * Punaab's back. The alternative — each of those deciding for itself what time
 * it is — is how you end up with a blue-hour sky over a noon-lit meadow.
 *
 * ## Why this is not React state
 *
 * It changes every frame. A `setState` at 60fps would re-render the whole scene
 * graph sixty times a second, which is the one thing `BardWorld` is carefully
 * built never to do. So this is a plain mutable singleton: `advance()` is
 * called once per frame from `Atmosphere`, and every other consumer reads the
 * fields it needs during its own `useFrame`. Read-only for everyone else.
 *
 * ## Two colour conventions, deliberately
 *
 * `THREE.Color` converts sRGB hex to the linear working space on construction.
 * The terrain's existing haze uniforms were tuned with an *extra*
 * `.convertSRGBToLinear()` on top of that, so those keyframes are built the
 * same doubled way (see `hazeStop`). Light colours were tuned without it, so
 * those use plain construction (see `lightStop`). Mixing the two up would shift
 * the look the moment this module took over, which is exactly the kind of
 * regression a day/night cycle is blamed for.
 */

// ---------------------------------------------------------------------------
// The arc
// ---------------------------------------------------------------------------

/**
 * Wall-clock seconds for one full cycle — Minecraft's twenty minutes.
 *
 * The arc is uniform, so this splits evenly: ten minutes of daylight, ten of
 * night. Minecraft's own night is shorter than its day (roughly ten and seven,
 * with three minutes of twilight between), and matching that exactly would mean
 * warping time.
 *
 * That was tried and abandoned. Every warp smooth enough to avoid a visible
 * change in the sun's speed can only shift the split by a percent or two, and
 * the abrupt ones put that speed change *at the horizon* — the one moment in
 * the whole cycle a viewer is actually watching the sky. Three extra minutes of
 * a night full of stars, fireflies and lit windows is a far better trade than a
 * sunset that visibly changes gear halfway through.
 */
export const DAY_SECONDS = 1200;

/** Sun elevation at local noon. */
const MAX_ELEVATION_DEG = 62;

/**
 * Direct sunlight at the palette's reference elevation, and at noon.
 *
 * This curve is not free to be any plausible falloff. The whole valley — grass,
 * terrain, water, flora, every authored colour — was balanced against a
 * *constant* 2.15-intensity sun sitting at `GHIBLI_SUN_ELEV_DEG`. So the curve
 * has to pass exactly through 2.15 at that elevation. Anything else and every
 * material in the world renders at an exposure it was not painted for.
 *
 * The meadow is the tell-tale, because the grass shader runs with
 * `lights: false` and derives its entire key colour from this number, so it
 * takes the error directly rather than having ambient and sky to hide behind.
 *
 * Getting it wrong is not subtle: an earlier version of this curve peaked at
 * 2.15 at *noon*, which left the reference look — the one the site opens on —
 * lit at 44% of intended, and the first thing anyone noticed was that the grass
 * had stopped looking lush.
 */
export const REFERENCE_SUN_INTENSITY = 2.15;
/**
 * Noon. Only a little above the reference, and deliberately so.
 *
 * The valley was authored under a *constant* 2.15 sun, so every step above that
 * is a step away from the look the textures were balanced for. 2.75 was tried
 * and read as blown out — grass in particular, because its shader multiplies
 * this straight into an already-bright tip colour with no specular roll-off to
 * absorb it. Midday should feel higher and harder than late afternoon, not
 * brighter than the film stock can hold.
 */
const NOON_SUN_INTENSITY = 2.32;

/**
 * `base + sin(elevation) · gain`, solved through the reference point and noon.
 *
 * Derived rather than typed in, so the two intensities above stay the only
 * numbers anyone has to reason about and the curve cannot drift off the
 * reference as the arc is retuned.
 */
const SUN_RISE_GAIN =
  (NOON_SUN_INTENSITY - REFERENCE_SUN_INTENSITY) /
  (Math.sin((MAX_ELEVATION_DEG * Math.PI) / 180) -
    Math.sin((GHIBLI_SUN_ELEV_DEG * Math.PI) / 180));
const SUN_BASE_INTENSITY =
  REFERENCE_SUN_INTENSITY -
  SUN_RISE_GAIN * Math.sin((GHIBLI_SUN_ELEV_DEG * Math.PI) / 180);

function bearing(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const azim = (azimuthDeg * Math.PI) / 180;
  const elev = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(elev) * Math.sin(azim),
    Math.sin(elev),
    Math.cos(elev) * Math.cos(azim)
  );
}

/**
 * Phase along the arc at which the sun matches the palette's reference
 * elevation, on the descending limb.
 *
 * Elevation alone fixes this: `sin(elevation) = sin θ · sin(MAX_ELEVATION)`,
 * independent of which compass bearing the arc runs along.
 */
const REFERENCE_PHASE = (() => {
  const sinElev = Math.sin((GHIBLI_SUN_ELEV_DEG * Math.PI) / 180);
  const sinNoon = Math.sin((MAX_ELEVATION_DEG * Math.PI) / 180);
  return Math.PI - Math.asin(THREE.MathUtils.clamp(sinElev / sinNoon, -1, 1));
})();

/**
 * Compass bearing where the sun clears the horizon, in the same convention as
 * `ghibliSunDirection`: 0° = +Z, 90° = +X.
 *
 * Solved rather than chosen. The obvious guess — the reference azimuth minus
 * 180°, so the sun *sets* on the palette's bearing — is wrong, because a sun on
 * a real arc only holds its setting azimuth at the instant it touches the
 * horizon. Thirteen degrees up it has already swung 7° back towards south, so
 * that guess misses the reference bearing by 7.3°.
 *
 * Writing the horizontal components as a single phase-shifted sinusoid,
 * `azimuth(θ) = riseAzimuth + atan2(sin θ · cos(MAX_ELEVATION), cos θ)`, the
 * offset at the reference phase falls out directly and the arc passes through
 * the reference elevation *and* bearing together.
 */
const RISE_AZIMUTH_DEG =
  GHIBLI_SUN_AZIM_DEG -
  (Math.atan2(
    Math.sin(REFERENCE_PHASE) * Math.cos((MAX_ELEVATION_DEG * Math.PI) / 180),
    Math.cos(REFERENCE_PHASE)
  ) *
    180) /
    Math.PI;
const NOON_AZIMUTH_DEG = RISE_AZIMUTH_DEG + 90;

/** Horizon point where the sun rises. Unit, horizontal. */
const RISE_DIR = bearing(RISE_AZIMUTH_DEG, 0);
/** Direction of the sun at noon. Unit, and perpendicular to `RISE_DIR`. */
const NOON_DIR = bearing(NOON_AZIMUTH_DEG, MAX_ELEVATION_DEG);

/**
 * Phase of the sun's arc, in radians.
 *
 * 0 = sunrise, π/2 = noon, π = sunset, 3π/2 = midnight. The sun's direction is
 * `RISE_DIR·cos θ + NOON_DIR·sin θ`, which traces a great circle through the
 * rise point and the noon point — a real solar arc, not a sine wave pasted onto
 * an elevation value. Because the two basis vectors are orthonormal by
 * construction the result needs no renormalising.
 */
function phaseFor(t: number): number {
  return (t - 0.25) * Math.PI * 2;
}

/**
 * The time of day that reproduces the palette's reference sun exactly.
 *
 * The whole valley — grass, terrain, water, haze — was authored against a
 * 13.5° late-afternoon sun. Starting the clock here means the first frame a
 * visitor sees is the one every material was tuned for, and the cycle walks
 * away from it into sunset rather than arriving at it from somewhere wrong.
 */
export const REFERENCE_TIME = 0.25 + REFERENCE_PHASE / (Math.PI * 2);

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

/** A light colour, converted once — matching how the scene's lights were tuned. */
function lightStop(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/**
 * A haze colour for the terrain's aerial-perspective uniforms.
 *
 * Doubled conversion on purpose: `Terrain` builds its constants as
 * `new THREE.Color(hex).convertSRGBToLinear()` and the fog was tuned against
 * that. Matching it here keeps the handover invisible.
 */
function hazeStop(hex: string): THREE.Color {
  return new THREE.Color(hex).convertSRGBToLinear();
}

/** Night sky and lamp colours — the half of the palette that did not exist yet. */
export const NIGHT = {
  keyLight: "#8FA8D8",
  ambSky: "#2A3C63",
  ambGround: "#151B28",
  ambient: "#1B2338",
  haze: "#243350",
  hazeMoon: "#4A5E8C",
  mist: "#16203A",
  fog: "#0C1424",
  star: "#DCE6FF",
  lamp: "#FFB25E",
  firefly: "#C8FF8A",
} as const;

const DUSK = {
  keyLight: "#FF9A52",
  ambSky: "#7C6FA8",
  ambGround: "#6B5238",
  ambient: "#A8809A",
  haze: "#C09A86",
  hazeSun: "#FFB271",
  mist: "#9E8C93",
  fog: "#B99A88",
} as const;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Daylight = {
  /** 0–1 through the day. 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  t: number;
  /** Sun elevation in radians. Negative when it is down. */
  sunElevation: number;
  /** Unit direction *towards* the sun. */
  sunDir: THREE.Vector3;
  /** Unit direction towards the moon — the sun's antipode, tilted off the ecliptic. */
  moonDir: THREE.Vector3;

  /**
   * The one shadow-casting light, aimed at the sun by day and the moon by
   * night. It swaps across the horizon, where both are near zero intensity, so
   * the cut is invisible and the scene only ever pays for one shadow map.
   */
  keyDir: THREE.Vector3;
  keyColor: THREE.Color;
  keyIntensity: number;

  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  ambientColor: THREE.Color;
  ambientIntensity: number;

  fogColor: THREE.Color;
  fogDensity: number;

  /** Aerial-perspective uniforms for the terrain shader (doubled-linear space). */
  hazeColor: THREE.Color;
  hazeSunColor: THREE.Color;
  mistColor: THREE.Color;

  /** Preetham sky parameters. */
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;

  /** 0 in full day, 1 in full night. Drives anything that only exists at night. */
  nightFactor: number;
  /** Lamps, windows, lanterns. Leads `nightFactor` — people light up at dusk. */
  lampFactor: number;
  /** Star dome opacity. Lags `nightFactor` so stars appear after the sky darkens. */
  starAlpha: number;
  /** Moon disc opacity. */
  moonAlpha: number;
  /** 0 at midday, 1 when the sun is on the horizon. Drives warm rim light. */
  goldenFactor: number;

  /** Renderer exposure and bloom threshold, so lamps read without blowing out day. */
  exposure: number;
  bloomThreshold: number;
  bloomIntensity: number;

  /** Cloud tint, so the puffs are not lit by a sun that set ten seconds ago. */
  cloudColor: THREE.Color;
};

export const daylight: Daylight = {
  t: REFERENCE_TIME,
  sunElevation: 0,
  sunDir: new THREE.Vector3(0, 1, 0),
  moonDir: new THREE.Vector3(0, -1, 0),

  keyDir: new THREE.Vector3(0, 1, 0),
  keyColor: lightStop(GHIBLI.sun),
  keyIntensity: 2.15,

  hemiSky: lightStop(GHIBLI.ambSky),
  hemiGround: lightStop(GHIBLI.ambGround),
  hemiIntensity: 1.05,
  ambientColor: lightStop(GHIBLI.mist),
  ambientIntensity: 0.32,

  fogColor: lightStop(GHIBLI.mist),
  fogDensity: 0.002,

  hazeColor: hazeStop(GHIBLI.haze),
  hazeSunColor: hazeStop(GHIBLI.skyHorizonSun),
  mistColor: hazeStop(GHIBLI.mist),

  turbidity: 9.2,
  rayleigh: 1.85,
  mieCoefficient: 0.0075,
  mieDirectionalG: 0.88,

  nightFactor: 0,
  lampFactor: 0,
  starAlpha: 0,
  moonAlpha: 0,
  goldenFactor: 0,

  exposure: 1.18,
  bloomThreshold: 0.84,
  bloomIntensity: 0.55,

  cloudColor: lightStop(GHIBLI.cloudBody),
};

// Keyframe colours, built once. Lerping between prebuilt colours each frame is
// free; re-parsing hex strings sixty times a second is not.
const DAY_KEY = lightStop(GHIBLI.sun);
const NOON_KEY = lightStop("#FFF6E2");
const DUSK_KEY = lightStop(DUSK.keyLight);
const NIGHT_KEY = lightStop(NIGHT.keyLight);

const DAY_HEMI_SKY = lightStop(GHIBLI.ambSky);
const DUSK_HEMI_SKY = lightStop(DUSK.ambSky);
const NIGHT_HEMI_SKY = lightStop(NIGHT.ambSky);
const DAY_HEMI_GROUND = lightStop(GHIBLI.ambGround);
const DUSK_HEMI_GROUND = lightStop(DUSK.ambGround);
const NIGHT_HEMI_GROUND = lightStop(NIGHT.ambGround);

const DAY_AMBIENT = lightStop(GHIBLI.mist);
const DUSK_AMBIENT = lightStop(DUSK.ambient);
const NIGHT_AMBIENT = lightStop(NIGHT.ambient);

const DAY_FOG = lightStop(GHIBLI.mist);
const DUSK_FOG = lightStop(DUSK.fog);
const NIGHT_FOG = lightStop(NIGHT.fog);

const DAY_HAZE = hazeStop(GHIBLI.haze);
const DUSK_HAZE = hazeStop(DUSK.haze);
const NIGHT_HAZE = hazeStop(NIGHT.haze);
const DAY_HAZE_SUN = hazeStop(GHIBLI.skyHorizonSun);
const DUSK_HAZE_SUN = hazeStop(DUSK.hazeSun);
const NIGHT_HAZE_SUN = hazeStop(NIGHT.hazeMoon);
const DAY_MIST = hazeStop(GHIBLI.mist);
const DUSK_MIST = hazeStop(DUSK.mist);
const NIGHT_MIST = hazeStop(NIGHT.mist);

const DAY_CLOUD = lightStop(GHIBLI.cloudBody);
const DUSK_CLOUD = lightStop("#E8A278");
const NIGHT_CLOUD = lightStop("#3A4970");

/**
 * Blend three keyframes — night, dusk, day — by a single 0–1 daylight value.
 *
 * Dusk sits at the midpoint rather than being a separate schedule because
 * every one of these quantities peaks in warmth exactly when the sun is on the
 * horizon, which is where `daySpan = 0.5` falls.
 */
function tri(
  out: THREE.Color,
  night: THREE.Color,
  dusk: THREE.Color,
  day: THREE.Color,
  daySpan: number
): void {
  if (daySpan <= 0.5) out.copy(night).lerp(dusk, daySpan * 2);
  else out.copy(dusk).lerp(day, (daySpan - 0.5) * 2);
}

const scratchMoonAxis = new THREE.Vector3();

/** Advance the clock to an absolute time-of-day and recompute every field. */
export function setDaylight(t: number): void {
  const time = ((t % 1) + 1) % 1;
  daylight.t = time;

  const theta = phaseFor(time);
  daylight.sunDir
    .copy(RISE_DIR)
    .multiplyScalar(Math.cos(theta))
    .addScaledVector(NOON_DIR, Math.sin(theta));
  daylight.sunElevation = Math.asin(
    THREE.MathUtils.clamp(daylight.sunDir.y, -1, 1)
  );

  // The moon rides the sun's antipode, tipped off the ecliptic so the two are
  // never in the same place in the sky at dawn and dusk. Without the tilt it
  // rises out of the exact spot the sun just set into, which reads as a bug.
  scratchMoonAxis.copy(NOON_DIR).cross(RISE_DIR).normalize();
  daylight.moonDir
    .copy(daylight.sunDir)
    .multiplyScalar(-1)
    .addScaledVector(scratchMoonAxis, 0.34)
    .normalize();

  const elevDeg = (daylight.sunElevation * 180) / Math.PI;

  // Civil twilight: the sun is gone but the sky is not. Everything that fades
  // between day and night is driven off this one curve so nothing can disagree.
  const daySpan = THREE.MathUtils.smoothstep(elevDeg, -7, 9);
  daylight.nightFactor = 1 - daySpan;

  // Lamps lead the darkness — a cottage lights its windows while there is still
  // colour in the west, which is precisely when lit windows look best.
  daylight.lampFactor = THREE.MathUtils.smoothstep(-elevDeg, -9, 3);
  // Stars lag it, because they are invisible until the sky is genuinely dark.
  daylight.starAlpha = THREE.MathUtils.smoothstep(-elevDeg, 1, 13);

  const moonUp = THREE.MathUtils.clamp(daylight.moonDir.y, 0, 1);
  daylight.moonAlpha =
    daylight.starAlpha * THREE.MathUtils.smoothstep(moonUp, -0.02, 0.16);

  // Peaks with the sun on the horizon, on both limbs, and only while it is up.
  daylight.goldenFactor =
    THREE.MathUtils.smoothstep(elevDeg, -6, 3) *
    (1 - THREE.MathUtils.smoothstep(elevDeg, 4, 26));

  // --- The one key light -------------------------------------------------
  //
  // Sun and moon share a single shadow-casting light, so the valley only ever
  // pays for one shadow map. That only works if the handover is invisible, and
  // the handover is only invisible if *both* contribute nothing at the moment
  // it happens — otherwise every shadow in the world pivots in one frame.
  //
  // So the two ramps are deliberately arranged to leave a dead band just below
  // the horizon: sunlight is gone by −1°, and moonlight has not started until
  // −2°. Inside that band the key light is off and the scene is lit purely by
  // sky and ambient, which is what twilight actually looks like anyway. The
  // direction swap is parked in the middle of it.
  const SWAP_ELEV = -1;
  const sunPower = Math.max(0, Math.sin(daylight.sunElevation));
  const sunIntensity =
    THREE.MathUtils.smoothstep(elevDeg, SWAP_ELEV, 7) *
    (SUN_BASE_INTENSITY + sunPower * SUN_RISE_GAIN);
  const moonIntensity =
    0.34 *
    THREE.MathUtils.smoothstep(-elevDeg, -SWAP_ELEV + 1, 12) *
    THREE.MathUtils.smoothstep(moonUp, 0, 0.25);

  const sunUp = elevDeg > SWAP_ELEV;
  daylight.keyDir.copy(sunUp ? daylight.sunDir : daylight.moonDir);
  daylight.keyIntensity = sunUp ? sunIntensity : moonIntensity;

  // Key colour walks night → dusk → day, then pushes on past the reference sun
  // towards white as the sun climbs above golden hour.
  tri(daylight.keyColor, NIGHT_KEY, DUSK_KEY, DAY_KEY, daySpan);
  const high = THREE.MathUtils.smoothstep(elevDeg, 18, 52);
  if (high > 0) daylight.keyColor.lerp(NOON_KEY, high);

  tri(daylight.hemiSky, NIGHT_HEMI_SKY, DUSK_HEMI_SKY, DAY_HEMI_SKY, daySpan);
  tri(
    daylight.hemiGround,
    NIGHT_HEMI_GROUND,
    DUSK_HEMI_GROUND,
    DAY_HEMI_GROUND,
    daySpan
  );
  daylight.hemiIntensity = 0.2 + daySpan * 0.85;

  tri(daylight.ambientColor, NIGHT_AMBIENT, DUSK_AMBIENT, DAY_AMBIENT, daySpan);
  daylight.ambientIntensity = 0.1 + daySpan * 0.22;

  tri(daylight.fogColor, NIGHT_FOG, DUSK_FOG, DAY_FOG, daySpan);
  // Night air reads thicker, and the extra density hides the far terrain LOD
  // that daylight's own contrast normally covers for us.
  daylight.fogDensity = 0.002 + daylight.nightFactor * 0.0013;

  tri(daylight.hazeColor, NIGHT_HAZE, DUSK_HAZE, DAY_HAZE, daySpan);
  tri(daylight.hazeSunColor, NIGHT_HAZE_SUN, DUSK_HAZE_SUN, DAY_HAZE_SUN, daySpan);
  tri(daylight.mistColor, NIGHT_MIST, DUSK_MIST, DAY_MIST, daySpan);

  tri(daylight.cloudColor, NIGHT_CLOUD, DUSK_CLOUD, DAY_CLOUD, daySpan);

  // Rayleigh scattering is what reddens a sunset, so it peaks at the horizon.
  // Dropping it at night matters as much: left high, the night sky stays a
  // washed-out slate instead of going deep enough for stars to show.
  daylight.turbidity = 2.4 + daySpan * 6.8 + daylight.goldenFactor * 3.4;
  daylight.rayleigh = 0.5 + daySpan * 1.35 + daylight.goldenFactor * 1.9;
  daylight.mieCoefficient = 0.0075 + daylight.goldenFactor * 0.006;
  daylight.mieDirectionalG = 0.88 - daylight.goldenFactor * 0.08;

  // Open up at night — not enough to grey the shadows, just enough that a
  // lantern and a firefly are visible rather than technically present.
  daylight.exposure = 1.18 + daylight.nightFactor * 0.16;
  // The day threshold is high on purpose: only genuinely bright things bloom.
  // At night the brightest things in frame *are* the lamps, so it has to drop
  // or nothing glows at all.
  daylight.bloomThreshold = 0.84 - daylight.nightFactor * 0.55;
  daylight.bloomIntensity = 0.55 + daylight.nightFactor * 0.62;
}

/** Advance by a frame delta. Called once per frame, by `Atmosphere` only. */
export function advanceDaylight(deltaSeconds: number): void {
  setDaylight(daylight.t + deltaSeconds / DAY_SECONDS);
}

/**
 * Starting time of day, honouring a `?time=` override.
 *
 * Accepts a phase name or a raw 0–1 number. Without it there is no way to
 * review the night from a machine whose first frame is always late afternoon,
 * and no way to screenshot dawn without waiting six minutes for it.
 */
export function initialTime(): number {
  if (typeof window === "undefined") return REFERENCE_TIME;
  const raw = new URLSearchParams(window.location.search).get("time");
  if (!raw) return REFERENCE_TIME;
  const named: Record<string, number> = {
    dawn: 0.25,
    sunrise: 0.26,
    morning: 0.34,
    noon: 0.5,
    afternoon: REFERENCE_TIME,
    dusk: 0.75,
    sunset: 0.74,
    night: 0.95,
    midnight: 0,
  };
  if (raw in named) return named[raw];
  const numeric = Number.parseFloat(raw);
  return Number.isFinite(numeric) ? ((numeric % 1) + 1) % 1 : REFERENCE_TIME;
}

/**
 * True when the clock should be pinned rather than run.
 *
 * Only `?time=` does that now, so a screenshot or a review can hold the sky
 * still; adding `&cycle=on` runs the cycle from that starting point instead.
 *
 * This used to freeze for `prefers-reduced-motion` as well, and that was wrong.
 * The setting exists to suppress motion that can cause discomfort — parallax,
 * spinning, things flying across the viewport — and the sun crossing the sky
 * over twenty minutes moves about a fiftieth of a degree per frame, which is
 * below the threshold of noticing. What freezing it actually achieved was that
 * anyone whose OS reports the preference never saw night at all, which on
 * Windows is anybody with "Animation effects" switched off. Half the world was
 * invisible to them, in exchange for suppressing motion nobody could see.
 */
export function daylightFrozen(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("time")) return params.get("cycle") !== "on";
  return false;
}

/**
 * Seed the clock, once per page load.
 *
 * `Atmosphere` mounts and unmounts more than you would expect — Fast Refresh in
 * development, navigating away from the hero and back, React's double-invoked
 * mount in strict mode. Seeding on every mount would snap the sky back to late
 * afternoon each time, so a visitor who left the page and returned could walk
 * towards sunset forever without arriving.
 */
let seeded = false;

export function seedDaylight(): void {
  if (seeded) return;
  seeded = true;
  setDaylight(initialTime());
}

setDaylight(REFERENCE_TIME);

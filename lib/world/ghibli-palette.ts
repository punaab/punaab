/**
 * Soft Ghibli-inspired valley palette (look reference only — not a separate page).
 *
 * Kept as sRGB hex strings so Atmosphere, terrain, water and flora all paint
 * from the same film stock. Convert with THREE.Color at the call site.
 */

/** Late-afternoon sun: 13.5° elevation, azimuth 292° (0 = +Z north → +X east). */
export const GHIBLI_SUN_ELEV_DEG = 13.5;
export const GHIBLI_SUN_AZIM_DEG = 292;

export function ghibliSunDirection(): [number, number, number] {
  const elev = (GHIBLI_SUN_ELEV_DEG * Math.PI) / 180;
  const azim = (GHIBLI_SUN_AZIM_DEG * Math.PI) / 180;
  return [
    Math.cos(elev) * Math.sin(azim),
    Math.sin(elev),
    Math.cos(elev) * Math.cos(azim),
  ];
}

export const GHIBLI = {
  // sky & air
  skyZenith: "#4E80B4",
  skyUpper: "#7BA9CE",
  skyMid: "#A8CAE0",
  skyHorizon: "#E4DAC2",
  skyHorizonSun: "#FBE2AE",
  sunGlow: "#FFF1CE",
  sunDisc: "#FFFAEA",
  haze: "#A9BCC7",
  mist: "#D6DDD4",
  // clouds
  cloudBody: "#F6E7D2",
  cloudUnder: "#B7ACC3",
  // grass / meadow (tip → base)
  gTip: "#C6D46B",
  gUpper: "#93B84E",
  gMid: "#6C9A47",
  gLow: "#436E4F",
  gBase: "#2B564F",
  gDry: "#D9C079",
  gTrans: "#E9EE7C",
  // terrain
  tLit: "#93B159",
  tMid: "#6A924F",
  tShade: "#456A54",
  tHollow: "#33564F",
  pathLit: "#C9AD80",
  pathShade: "#7A664D",
  rockLit: "#B4A794",
  rockShade: "#5F5C58",
  bounce: "#AA9C64",
  // water
  wShallow: "#A5CBBE",
  wMid: "#5F9CA0",
  wDeep: "#2F5F6C",
  wDeepShade: "#274E5C",
  wFoam: "#EEF5EF",
  // trees
  cLit: "#84A94C",
  cMid: "#5A8148",
  cShade: "#2F5546",
  cDeep: "#254A44",
  trunkLit: "#8E7659",
  trunkShade: "#4C3F34",
  // light
  sun: "#FFD79C",
  ambSky: "#9EC6E6",
  ambGround: "#AA9C64",
  shadowTint: "#5C6E9E",
  cream: "#F6ECD8",
  warm: "#E8C98A",
  teal: "#4E7F79",
} as const;

export type GhibliKey = keyof typeof GHIBLI;

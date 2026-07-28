/**
 * PIXELGREW, drawn as a map.
 *
 * ## Why this does not embed Azgaar's Fantasy Map Generator
 *
 * FMG is an excellent tool and its licence (MIT) would let us ship it. But it
 * is a world *generator*: you press a button and it invents coastlines, states,
 * burgs and rivers. We already have a world — 640 metres square, fourteen named
 * regions, eleven settlements, ten roads, three rivers, six lakes, and a height
 * function that every blade of grass and every footstep already agrees with.
 *
 * Importing an FMG map would give us a second world that disagrees with the
 * first. The map would show a town the bard cannot walk to and a coast that is
 * not where the water is, and every later feature would have to pick a side.
 * That is not a map of PIXELGREW; it is a picture of somewhere else.
 *
 * So this takes the opposite direction: the map is *rendered from* the world
 * data, in the cartographic language FMG made popular — parchment, echoed
 * coastlines, hill hachures, tapering rivers, burg icons scaled by importance,
 * region washes with soft edges. What you see on the map is, by construction,
 * where you will arrive.
 *
 * `importFmgPlaces` at the bottom is the bridge for anyone who *does* want to
 * author in FMG: it takes an exported `.map`/JSON burg list and matches it onto
 * our settlements by name, so FMG can be used as a naming and lore tool without
 * ever becoming a second source of truth about geography.
 */

import { DESTINATIONS, type Destination } from "@/lib/bard/destinations";
import { GHIBLI } from "./ghibli-palette";
import { REGIONS, type Region } from "./regions";
import { SETTLEMENTS, type Settlement } from "./settlements";
import {
  RIVERS,
  ROADS,
  WATERS,
  WATER_LEVEL,
  WORLD_SIZE,
  heightAt,
} from "./terrain";

export const WORLD_NAME = "PIXELGREW";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * World metres -> map pixels.
 *
 * The world's +Z runs south on the map, so this is a straight scale with a
 * flip: north on the map is -Z in the world, which is the convention the
 * region layout in `regions.ts` was authored to.
 */
export function worldToMap(x: number, z: number, size: number): [number, number] {
  const half = WORLD_SIZE / 2;
  return [((x + half) / WORLD_SIZE) * size, ((z + half) / WORLD_SIZE) * size];
}

/** Map pixels -> world metres. The inverse of `worldToMap`. */
export function mapToWorld(px: number, py: number, size: number): [number, number] {
  const half = WORLD_SIZE / 2;
  return [(px / size) * WORLD_SIZE - half, (py / size) * WORLD_SIZE - half];
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export type MapPlaceKind =
  | "town"
  | "village"
  | "hamlet"
  | "port"
  | "holy"
  | "industry"
  | "camp"
  | "ruin"
  | "landmark";

export type MapPlace = {
  /** Destination id — what `AdventureDirector.travelTo` takes. */
  id: string;
  name: string;
  kind: MapPlaceKind;
  /** World coordinates. */
  x: number;
  z: number;
  /** One in-world line, shown on hover. */
  blurb: string;
  regionId?: string;
  /** Settlements outrank lone landmarks when labels collide. */
  weight: number;
};

function settlementKind(kind: Settlement["kind"]): MapPlaceKind {
  return kind as MapPlaceKind;
}

/**
 * Every place worth putting a pin on.
 *
 * Settlements first, then the destinations that are landmarks in their own
 * right rather than a spot inside a settlement. A map with seventy-six pins on
 * it is not a map, it is a rash — so a destination only earns one if it is not
 * already inside a settlement's circle.
 */
export const MAP_PLACES: MapPlace[] = (() => {
  const places: MapPlace[] = [];
  const claimed = new Set<string>();

  for (const settlement of SETTLEMENTS) {
    // The destination that best represents this settlement, so clicking the
    // town actually sends him into the town rather than to its coordinates.
    const inside = DESTINATIONS.filter(
      (d) => d.settlementId === settlement.id
    );
    const anchor =
      inside.find((d) => d.activity === "trading") ??
      inside.find((d) => d.activity === "talking") ??
      inside[0];

    for (const d of inside) claimed.add(d.id);
    if (!anchor) continue;

    places.push({
      id: anchor.id,
      name: settlement.name,
      kind: settlementKind(settlement.kind),
      x: settlement.x,
      z: settlement.z,
      blurb: settlement.blurb,
      weight: settlement.kind === "town" ? 3 : settlement.kind === "village" ? 2 : 1.5,
    });
  }

  // Standalone landmarks: a destination far enough from every settlement to be
  // a place in its own right.
  for (const d of DESTINATIONS) {
    if (claimed.has(d.id)) continue;
    const nearSettlement = SETTLEMENTS.some(
      (s) => Math.hypot(s.x - d.x, s.z - d.z) < s.radius * 0.9
    );
    if (nearSettlement) continue;

    places.push({
      id: d.id,
      name: d.name,
      kind: "landmark",
      x: d.x,
      z: d.z,
      blurb: d.lines[0] ?? "",
      regionId: (d as Destination & { regionId?: string }).regionId,
      weight: 1,
    });
  }

  return places;
})();

export function findPlace(id: string): MapPlace | undefined {
  return MAP_PLACES.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Cartographic palette
// ---------------------------------------------------------------------------

/**
 * Parchment, not the world's own colours.
 *
 * A map tinted with the terrain's greens looks like a satellite photo with the
 * saturation turned down. Old maps read as maps because the paper is warm, the
 * ink is one brown, and colour is used sparingly and symbolically.
 */
const PAPER = "#e8dcbe";
const PAPER_DARK = "#d8c8a4";
const INK = "#4a3b28";
const INK_SOFT = "rgba(74, 59, 40, 0.42)";
const SEA = "#a9bfc0";
const SEA_DEEP = "#8fa8ab";

/** Region washes. Muted, so labels and ink stay on top of them. */
const BIOME_WASH: Record<string, string> = {
  meadow: "rgba(140, 168, 96, 0.30)",
  broadleaf: "rgba(104, 140, 84, 0.34)",
  pine: "rgba(72, 108, 92, 0.34)",
  highland: "rgba(150, 150, 140, 0.30)",
  marsh: "rgba(110, 138, 118, 0.32)",
  shore: "rgba(200, 186, 146, 0.34)",
  farmland: "rgba(196, 180, 104, 0.30)",
  orchard: "rgba(158, 176, 96, 0.30)",
  heath: "rgba(150, 132, 152, 0.26)",
  badlands: "rgba(178, 126, 92, 0.32)",
};

// ---------------------------------------------------------------------------
// Height sampling
// ---------------------------------------------------------------------------

export type ReliefField = {
  size: number;
  /** Height per cell, row-major. */
  height: Float32Array;
  min: number;
  max: number;
};

/**
 * Samples the terrain onto a coarse grid for the map.
 *
 * `heightAt` costs about two microseconds, so this deliberately stays small —
 * a map is read at a glance and a 192-cell grid over 640 metres is one sample
 * every three and a bit metres, which is finer than any hachure it will draw.
 */
export function bakeRelief(size = 192): ReliefField {
  const height = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const wx = ((i + 0.5) / size) * WORLD_SIZE - WORLD_SIZE / 2;
      const wz = ((j + 0.5) / size) * WORLD_SIZE - WORLD_SIZE / 2;
      const y = heightAt(wx, wz);
      height[j * size + i] = y;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }

  return { size, height, min, max };
}

function sampleRelief(field: ReliefField, i: number, j: number): number {
  const ci = Math.max(0, Math.min(field.size - 1, i));
  const cj = Math.max(0, Math.min(field.size - 1, j));
  return field.height[cj * field.size + ci];
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;

/** Fibrous parchment: a warm base, blotches, and a fine tooth. */
function drawPaper(ctx: Ctx, size: number): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);

  // Age blotches. Large, soft, and few — many small ones read as noise.
  for (let i = 0; i < 26; i++) {
    const h = hash(i * 7 + 3);
    const h2 = hash(i * 13 + 11);
    const h3 = hash(i * 29 + 5);
    const r = size * (0.06 + h3 * 0.18);
    const gradient = ctx.createRadialGradient(
      h * size, h2 * size, 0,
      h * size, h2 * size, r
    );
    gradient.addColorStop(0, `rgba(150, 120, 74, ${0.05 + h3 * 0.05})`);
    gradient.addColorStop(1, "rgba(150, 120, 74, 0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(h * size - r, h2 * size - r, r * 2, r * 2);
  }

  // Edge darkening, as if the sheet has been handled at its borders.
  const vignette = ctx.createRadialGradient(
    size / 2, size / 2, size * 0.34,
    size / 2, size / 2, size * 0.72
  );
  vignette.addColorStop(0, "rgba(120, 92, 54, 0)");
  vignette.addColorStop(1, "rgba(120, 92, 54, 0.30)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);
}

function hash(n: number): number {
  let h = Math.imul(n | 0, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Region washes, drawn as soft blobs rather than hard polygons. */
function drawRegions(ctx: Ctx, size: number): void {
  ctx.save();
  for (const region of REGIONS) {
    const [cx, cy] = worldToMap(region.x, region.z, size);
    const r = (region.radius / WORLD_SIZE) * size;
    const wash = BIOME_WASH[region.biome] ?? "rgba(140,160,110,0.28)";
    const gradient = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    gradient.addColorStop(0, wash);
    gradient.addColorStop(0.7, wash.replace(/[\d.]+\)$/, "0.14)"));
    gradient.addColorStop(1, wash.replace(/[\d.]+\)$/, "0)"));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Hill and mountain hachures.
 *
 * The oldest trick in fantasy cartography and still the most legible: little
 * hand-drawn humps whose size follows the land, rather than a shaded relief.
 * Shaded relief on parchment reads as a stain; hachures read as mountains.
 */
function drawRelief(ctx: Ctx, size: number, field: ReliefField): void {
  const step = Math.max(6, Math.round(size / 96));
  ctx.save();
  ctx.strokeStyle = INK_SOFT;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const cells = field.size;
  for (let j = 1; j < cells - 1; j++) {
    for (let i = 1; i < cells - 1; i++) {
      const y = sampleRelief(field, i, j);
      if (y < WATER_LEVEL + 2) continue;

      // Only draw where the land is actually rising — a hachure on flat ground
      // is a smudge.
      const dx = sampleRelief(field, i + 1, j) - sampleRelief(field, i - 1, j);
      const dz = sampleRelief(field, i, j + 1) - sampleRelief(field, i, j - 1);
      const slope = Math.hypot(dx, dz);
      const elevation = (y - field.min) / Math.max(1, field.max - field.min);
      if (slope < 1.1 && elevation < 0.28) continue;

      // Thin them out deterministically, or the whole map fills with humps.
      const keep = hash(i * 811 + j * 7919);
      const density = Math.min(1, slope / 5 + elevation * 0.55);
      if (keep > density * 0.42) continue;

      const px = ((i + 0.5) / cells) * size;
      const py = ((j + 0.5) / cells) * size;
      const scale = step * (0.55 + elevation * 1.5 + Math.min(1, slope / 6));
      const peaked = elevation > 0.55;

      ctx.lineWidth = Math.max(0.7, scale * 0.11);
      ctx.beginPath();
      if (peaked) {
        // A mountain: two strokes meeting at a summit, with a shaded flank.
        ctx.moveTo(px - scale * 0.5, py + scale * 0.32);
        ctx.lineTo(px, py - scale * 0.42);
        ctx.lineTo(px + scale * 0.5, py + scale * 0.32);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px, py - scale * 0.42);
        ctx.lineTo(px + scale * 0.18, py + scale * 0.32);
        ctx.stroke();
      } else {
        // A hill: a single soft hump.
        ctx.moveTo(px - scale * 0.45, py + scale * 0.2);
        ctx.quadraticCurveTo(px, py - scale * 0.38, px + scale * 0.45, py + scale * 0.2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/**
 * Water: lakes and the sea, with the echoed shoreline of an engraved map.
 *
 * Those concentric offset lines around a coast are doing real work — they are
 * what makes a blue shape read as *water* rather than as a blue shape.
 */
function drawWater(ctx: Ctx, size: number): void {
  ctx.save();
  for (const water of WATERS) {
    const [cx, cy] = worldToMap(water.x, water.z, size);
    const r = (water.radius / WORLD_SIZE) * size;

    // Echo lines first, fading outward.
    for (let e = 3; e >= 1; e--) {
      ctx.strokeStyle = `rgba(120, 150, 155, ${0.30 / e})`;
      ctx.lineWidth = Math.max(0.6, size * 0.0011);
      ctx.beginPath();
      wobbleCircle(ctx, cx, cy, r + e * size * 0.008, water.x * 7 + e);
      ctx.stroke();
    }

    const gradient = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    gradient.addColorStop(0, SEA_DEEP);
    gradient.addColorStop(1, SEA);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    wobbleCircle(ctx, cx, cy, r, water.x * 7);
    ctx.fill();

    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.8, size * 0.0014);
    ctx.beginPath();
    wobbleCircle(ctx, cx, cy, r, water.x * 7);
    ctx.stroke();
  }
  ctx.restore();
}

/** A circle with a hand-drawn wobble, so no shoreline is ever a true arc. */
function wobbleCircle(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  seed: number
): void {
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const n =
      Math.sin(a * 3 + seed) * 0.045 +
      Math.sin(a * 7 + seed * 1.7) * 0.022 +
      Math.sin(a * 13 + seed * 0.6) * 0.011;
    const rr = r * (1 + n);
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Rivers, tapering downstream the way an engraver would cut them. */
function drawRivers(ctx: Ctx, size: number): void {
  ctx.save();
  ctx.strokeStyle = "#7ba0a6";
  ctx.lineCap = "round";
  for (const river of RIVERS) {
    const points = river.getSpacedPoints(120);
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = worldToMap(points[i - 1].x, points[i - 1].z, size);
      const [x1, y1] = worldToMap(points[i].x, points[i].z, size);
      // Source is thin, mouth is broad.
      ctx.lineWidth = Math.max(0.7, (size * 0.0016) * (0.35 + (i / points.length) * 1.5));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Roads: the dashed line every map reader already knows means "route". */
function drawRoads(ctx: Ctx, size: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(74, 59, 40, 0.55)";
  ctx.lineWidth = Math.max(0.7, size * 0.0013);
  ctx.setLineDash([size * 0.006, size * 0.005]);
  ctx.lineCap = "round";
  for (const road of ROADS) {
    const points = road.getSpacedPoints(160);
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [px, py] = worldToMap(points[i].x, points[i].z, size);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** Region names, in the spaced small-caps a chart uses for a territory. */
function drawRegionLabels(ctx: Ctx, size: number): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const region of REGIONS) {
    const [cx, cy] = worldToMap(region.x, region.z, size);
    const fontSize = Math.max(8, size * 0.0165);
    ctx.font = `${fontSize}px "Iowan Old Style", Palatino, Georgia, serif`;
    ctx.fillStyle = "rgba(74, 59, 40, 0.62)";
    drawTracked(ctx, region.name.toUpperCase(), cx, cy, fontSize * 0.22);
  }
  ctx.restore();
}

/** Letter-spaced text, which canvas has no native support for. */
function drawTracked(
  ctx: Ctx,
  text: string,
  cx: number,
  cy: number,
  tracking: number
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((s, w) => s + w, 0) + tracking * (text.length - 1);
  let x = cx - total / 2;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x + widths[i] / 2, cy);
    x += widths[i] + tracking;
  }
}

/**
 * Bakes the whole map to a canvas.
 *
 * Everything here is static — the world does not change — so this runs once
 * and the result is used as an image. Place pins are NOT drawn here: they are
 * live DOM on top, so they can be hovered, focused and clicked, and so screen
 * readers can reach them.
 */
export function bakeMap(size = 1024, relief?: ReliefField): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const field = relief ?? bakeRelief(Math.min(192, Math.round(size / 5)));

  drawPaper(ctx, size);
  drawRegions(ctx, size);
  drawRelief(ctx, size, field);
  drawWater(ctx, size);
  drawRivers(ctx, size);
  drawRoads(ctx, size);
  drawRegionLabels(ctx, size);

  // A border rule, inset, like a plate mark.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, size * 0.0022);
  ctx.strokeRect(size * 0.012, size * 0.012, size * 0.976, size * 0.976);
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = Math.max(0.6, size * 0.001);
  ctx.strokeRect(size * 0.022, size * 0.022, size * 0.956, size * 0.956);

  return canvas;
}

// ---------------------------------------------------------------------------
// Azgaar's Fantasy Map Generator bridge
// ---------------------------------------------------------------------------

export type FmgBurg = { name?: string; x?: number; y?: number; population?: number };

/**
 * Adopts names from an FMG export without adopting its geography.
 *
 * FMG's JSON carries a `burgs` array. Matching those onto our settlements by
 * position — nearest burg to each settlement, after normalising FMG's own
 * canvas extent onto ours — lets somebody lay a generated map over PIXELGREW
 * and keep the names they liked, while the coastlines, roads and walkable
 * ground stay the ones the bard actually walks on.
 *
 * Returns a settlement-id -> name map. Deliberately does not mutate anything:
 * the caller decides whether to use it.
 */
export function importFmgPlaces(
  burgs: FmgBurg[],
  fmgWidth: number,
  fmgHeight: number
): Record<string, string> {
  const named: Record<string, string> = {};
  const usable = burgs.filter(
    (b) => b.name && Number.isFinite(b.x) && Number.isFinite(b.y)
  );
  if (!usable.length || fmgWidth <= 0 || fmgHeight <= 0) return named;

  const taken = new Set<number>();
  for (const settlement of SETTLEMENTS) {
    const [sx, sy] = worldToMap(settlement.x, settlement.z, 1);
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < usable.length; i++) {
      if (taken.has(i)) continue;
      const bx = (usable[i].x as number) / fmgWidth;
      const by = (usable[i].y as number) / fmgHeight;
      const d = Math.hypot(bx - sx, by - sy);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    if (best >= 0) {
      taken.add(best);
      named[settlement.id] = usable[best].name as string;
    }
  }
  return named;
}

export { GHIBLI, type Region, type Settlement };

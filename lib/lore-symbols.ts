import type { LoreCategoryId } from "@/lib/community-lore";

export const LORE_CATEGORY_COLORS: Record<LoreCategoryId, string> = {
  characters: "#2563eb",
  art: "#ea580c",
  quests: "#c4922a",
  dialogue: "#0d9488",
  places: "#16a34a",
  items: "#7c3aed",
  rumors: "#db2777",
  history: "#92400e",
};

/** Fixed hub size — category spokes never exceed a fraction of this. */
export const HUB_NODE_RADIUS = 22;

/**
 * Spoke radius from how packed a category is relative to its peers.
 * Empty areas stay small; the fullest approaches — but never passes — the hub.
 */
export function categorySpokeRadius(
  count: number,
  peerCounts: number[],
  hubRadius = HUB_NODE_RADIUS
): number {
  const maxPeer = Math.max(1, count, ...peerCounts);
  const minR = 9.5;
  const maxR = hubRadius * 0.82;
  if (count <= 0) return minR;
  // Square-root share so one huge category does not crush the rest of the ring.
  const relative = Math.sqrt(count / maxPeer);
  return minR + relative * (maxR - minR);
}

/**
 * Just the category glyph (no disc) — used inside graph spokes and entry nodes.
 * `s` is the glyph half-span, roughly 0.45–0.55 of the parent radius.
 */
export function drawCategoryGlyph(
  ctx: CanvasRenderingContext2D,
  category: LoreCategoryId,
  x: number,
  y: number,
  s: number,
  stroke: string,
  fill: string,
  accent: string
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1.4, s * 0.22);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (category) {
    case "characters": {
      // Traveler silhouette
      ctx.beginPath();
      ctx.arc(0, -s * 0.42, s * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = stroke;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-s * 0.72, s * 0.88);
      ctx.quadraticCurveTo(0, s * 0.02, s * 0.72, s * 0.88);
      ctx.stroke();
      break;
    }
    case "quests": {
      // Banner flag
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, s * 0.92);
      ctx.lineTo(-s * 0.2, -s * 0.88);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.2, -s * 0.88);
      ctx.lineTo(s * 0.78, -s * 0.42);
      ctx.lineTo(-s * 0.2, -s * 0.02);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "dialogue": {
      // Speech bubble
      const w = s * 1.15;
      const h = s * 0.78;
      roundRect(ctx, -w / 2, -h / 2 - s * 0.12, w, h, s * 0.22);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, h / 2 - s * 0.12);
      ctx.lineTo(-s * 0.38, h / 2 + s * 0.48);
      ctx.lineTo(s * 0.22, h / 2 - s * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Quip lines
      ctx.beginPath();
      ctx.moveTo(-s * 0.35, -s * 0.2);
      ctx.lineTo(s * 0.35, -s * 0.2);
      ctx.moveTo(-s * 0.35, s * 0.05);
      ctx.lineTo(s * 0.18, s * 0.05);
      ctx.stroke();
      break;
    }
    case "places": {
      // Map pin
      ctx.beginPath();
      ctx.moveTo(0, s * 0.92);
      ctx.bezierCurveTo(s * 0.95, s * 0.12, s * 0.72, -s * 0.72, 0, -s * 0.88);
      ctx.bezierCurveTo(-s * 0.72, -s * 0.72, -s * 0.95, s * 0.12, 0, s * 0.92);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -s * 0.28, s * 0.26, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "items": {
      // Gem / loot diamond
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.92);
      ctx.lineTo(s * 0.72, 0);
      ctx.lineTo(0, s * 0.92);
      ctx.lineTo(-s * 0.72, 0);
      ctx.closePath();
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, -s * 0.05);
      ctx.lineTo(0, -s * 0.55);
      ctx.lineTo(s * 0.42, -s * 0.05);
      ctx.stroke();
      break;
    }
    case "rumors": {
      // Whisper swirls
      for (const [dx, dy, rr] of [
        [-s * 0.32, -s * 0.12, s * 0.34],
        [s * 0.28, s * 0.12, s * 0.28],
        [s * 0.02, -s * 0.48, s * 0.2],
      ] as const) {
        ctx.beginPath();
        ctx.arc(dx, dy, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(s * 0.28, s * 0.12, s * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      break;
    }
    case "history": {
      // Open scroll
      roundRect(ctx, -s * 0.68, -s * 0.82, s * 1.36, s * 1.58, s * 0.1);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.38, -s * 0.38);
      ctx.lineTo(s * 0.38, -s * 0.38);
      ctx.moveTo(-s * 0.38, 0);
      ctx.lineTo(s * 0.38, 0);
      ctx.moveTo(-s * 0.38, s * 0.38);
      ctx.lineTo(s * 0.22, s * 0.38);
      ctx.stroke();
      break;
    }
    case "art":
    default: {
      // Framed landscape
      roundRect(ctx, -s * 0.78, -s * 0.62, s * 1.56, s * 1.24, s * 0.1);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.48, s * 0.28);
      ctx.lineTo(-s * 0.08, -s * 0.18);
      ctx.lineTo(s * 0.22, s * 0.12);
      ctx.lineTo(s * 0.58, -s * 0.38);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.38, -s * 0.28, s * 0.13, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      break;
    }
  }

  ctx.restore();
}

/** Draw a category glyph centered at (x, y). `r` is node radius. */
export function drawLoreSymbol(
  ctx: CanvasRenderingContext2D,
  category: LoreCategoryId,
  x: number,
  y: number,
  r: number,
  fill = "#fffaf0",
  stroke = "#152238"
) {
  const color = LORE_CATEGORY_COLORS[category] || "#2563eb";
  ctx.save();
  ctx.translate(x, y);

  // Soft disc
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1.2, r * 0.12);
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();

  drawCategoryGlyph(ctx, category, x, y, r * 0.55, stroke, fill, color);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function voteRadius(votes: number, isHub = false): number {
  if (isHub) return HUB_NODE_RADIUS;
  const t = Math.min(1, Math.log10(votes + 1) / Math.log10(40));
  return 7 + t * 14;
}

/**
 * Device quality tiers.
 *
 * The hero scene is the first thing a visitor sees, so it must not stall a
 * mid-range laptop or a phone. Rather than shipping one compromise everywhere,
 * every expensive knob in the world reads its budget from here.
 *
 * The numbers below were rebalanced when the valley went from 240 metres across
 * to 640 — a forty-fold increase in area. Almost none of them scaled by forty,
 * because the answer to a bigger world is not more of everything at once: it is
 * level of detail. The counts here are *placed* populations spread over the
 * whole map; what actually reaches the GPU each frame is whatever survives the
 * distance and frustum culling in `Flora.tsx` and `Terrain.tsx`, which is a
 * small and roughly constant fraction of them regardless of how big the world
 * gets. That is the whole reason a 640-metre valley can be denser than the
 * 240-metre one was and still run faster.
 */

export type QualityTier = "low" | "medium" | "high";

export type QualityBudget = {
  tier: QualityTier;

  // --- Terrain ------------------------------------------------------------

  /**
   * Uniform-grid resolution per side.
   *
   * Kept because it is part of `Terrain`'s public props and other callers pass
   * it. The terrain is chunked now and derives its real resolution from the
   * chunk fields below; this is the equivalent single-grid density, used only
   * when a caller supplies no budget at all.
   */
  terrainSegments: number;
  /** Terrain chunks per side. The world is `WORLD_SIZE / terrainChunks` per chunk. */
  terrainChunks: number;
  /**
   * How many chunks get the finest tessellation.
   *
   * Chunks are ranked by distance to the road network, because the camera
   * follows a bard who walks the roads and is therefore never anywhere else.
   * Detail spent more than a couple of hundred metres from a road is detail
   * nobody will ever stand close enough to see.
   */
  terrainNearChunks: number;
  /** How many of the remainder get the middle tessellation. */
  terrainMidChunks: number;
  /** Grid segments per side within a near / mid / far chunk. Each halves. */
  terrainNearSegments: number;
  terrainMidSegments: number;
  terrainFarSegments: number;

  // --- Flora --------------------------------------------------------------

  /**
   * Trees placed across the whole valley, all species.
   *
   * A *request*, not a guarantee. Placement rejects candidates on slope, on
   * proximity to a road and on proximity to water, so the population that
   * survives is around two thirds of this — which is measured and deliberate,
   * not slack. Asking for the number you want would put trees on cliffs.
   */
  trees: number;
  /** Bushes, scrub, gorse, reed stands — the layer between trees and grass. */
  shrubs: number;
  /** Small biome plants: heather, bracken, crops, sedge, wildflowers. */
  groundCover: number;
  /**
   * Grass *tufts*, not blades. Each instance is a merged clump of blades.
   *
   * This is the placed population, not the drawn one: tufts outside
   * `grassRadius` never reach the GPU, so raising it buys density near the
   * camera rather than draw calls.
   */
  grassTufts: number;
  /** Distance beyond which grass is not drawn at all. */
  grassRadius: number;
  rocks: number;
  /** Ferns and bracken. Kept as its own field; existing callers pass it. */
  ferns: number;
  /**
   * Flowering plants placed across the valley, all species.
   *
   * Like `trees`, a request rather than a promise: flowers are sited in drifts
   * and a drift that lands on a cliff or a rooftop is dropped whole, so the
   * delivered population runs a little under this.
   *
   * The number is smaller than `groundCover` for a reason that is not thrift.
   * Flowers do not spread evenly — the whole population lives in a few hundred
   * dense patches with bare sward between them — so raising this does not make
   * the meadow flowerier, it makes each patch denser until the plants
   * interpenetrate. More flowers past this point is more *drifts*, and that is
   * governed by the drift field in `lib/world/flowers.ts`, not here.
   */
  flowers: number;
  /**
   * Distance beyond which flowers are not drawn.
   *
   * Deliberately much shorter than `drawDistance`. A buttercup is three
   * centimetres across; past a hundred metres a whole drift of them is one
   * pixel of yellow, which the terrain's own colour already supplies.
   */
  flowerRadius: number;

  // --- Level of detail ----------------------------------------------------

  /** Below this distance, flora renders as full geometry with bark and leaves. */
  lodNear: number;
  /** Below this, simplified solid geometry. Beyond it, crossed billboards. */
  lodMid: number;
  /** Nothing scattered is drawn past this. The terrain itself still is. */
  drawDistance: number;

  // --- World dressing (consumed by the settlement and NPC layers) ---------

  /** Walking, talking NPCs. */
  npcs: number;
  /** Sheep, chickens, deer, cattle. Cheaper than people — no dialogue. */
  animals: number;
  /**
   * How much geometry a building is worth: 0 = boxes and roofs, 1 = adds
   * timbering, sills and chimneys, 2 = adds shutters, thatch layers, clutter.
   */
  structureDetail: 0 | 1 | 2;
  /** Structures further than this from the camera are not drawn. */
  structureRadius: number;

  // --- Renderer -----------------------------------------------------------

  /**
   * Directional shadow maps. Extremely expensive on mobile GPUs — off on the
   * low tier so the fill rate goes to the meadow instead.
   */
  shadows: boolean;
  shadowMapSize: number;
  /**
   * Radius the shadow camera covers around the bard, and the radius inside
   * which flora skips frustum culling — a tree behind the camera still casts a
   * shadow into the shot. Keep the two the same or shadows wink as you turn.
   */
  shadowDistance: number;
  /** Max device pixel ratio. */
  dpr: [number, number];
  postprocessing: boolean;
  waterReflections: boolean;
  /** Bearings around a water body's shoreline. */
  waterSegments: number;
  /** Rings from the centre of a water body out to its shore. */
  waterRings: number;
  /** Animated shoreline foam. First thing to go — it is pure decoration. */
  foam: boolean;
  /** Side length of the generated texture maps. */
  textureSize: number;
};

const BUDGETS: Record<QualityTier, QualityBudget> = {
  low: {
    tier: "low",

    terrainSegments: 112,
    terrainChunks: 12,
    terrainNearChunks: 24,
    terrainMidChunks: 40,
    terrainNearSegments: 14,
    terrainMidSegments: 7,
    terrainFarSegments: 4,

    // Canopy / dressing dialled down for phones. Grass tufts + radius stay as
    // before — the meadow is the hero shot and is already ring-culled.
    trees: 620,
    shrubs: 380,
    groundCover: 9000,
    grassTufts: 32000,
    grassRadius: 36,
    rocks: 140,
    ferns: 220,
    flowers: 2200,
    flowerRadius: 42,

    lodNear: 24,
    lodMid: 64,
    drawDistance: 145,

    npcs: 6,
    animals: 8,
    structureDetail: 0,
    structureRadius: 90,

    shadows: false,
    shadowMapSize: 512,
    shadowDistance: 10,
    dpr: [1, 1],
    postprocessing: false,
    waterReflections: false,
    waterSegments: 48,
    waterRings: 5,
    foam: false,
    textureSize: 128,
  },
  medium: {
    tier: "medium",

    terrainSegments: 208,
    terrainChunks: 16,
    terrainNearChunks: 54,
    terrainMidChunks: 92,
    terrainNearSegments: 20,
    terrainMidSegments: 10,
    terrainFarSegments: 5,

    trees: 4200,
    shrubs: 3200,
    groundCover: 36000,
    grassTufts: 120000,
    grassRadius: 68,
    rocks: 1000,
    ferns: 2200,
    flowers: 24000,
    flowerRadius: 95,

    lodNear: 48,
    lodMid: 130,
    drawDistance: 320,

    npcs: 36,
    animals: 56,
    structureDetail: 1,
    structureRadius: 240,

    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 20,
    dpr: [1, 1.6],
    postprocessing: true,
    waterReflections: false,
    waterSegments: 96,
    waterRings: 10,
    foam: true,
    textureSize: 512,
  },
  high: {
    tier: "high",

    terrainSegments: 288,
    terrainChunks: 20,
    terrainNearChunks: 76,
    terrainMidChunks: 132,
    terrainNearSegments: 24,
    terrainMidSegments: 12,
    terrainFarSegments: 6,

    trees: 7800,
    shrubs: 6400,
    groundCover: 62000,
    grassTufts: 220000,
    grassRadius: 90,
    rocks: 1700,
    ferns: 4000,
    flowers: 46000,
    flowerRadius: 125,

    lodNear: 64,
    lodMid: 170,
    drawDistance: 380,

    npcs: 54,
    animals: 84,
    structureDetail: 2,
    structureRadius: 300,

    shadows: true,
    shadowMapSize: 2048,
    shadowDistance: 26,
    dpr: [1, 2],
    postprocessing: true,
    waterReflections: true,
    waterSegments: 128,
    waterRings: 14,
    foam: true,
    textureSize: 512,
  },
};

/** Phones / tablets in any orientation — not just portrait width checks. */
function isMobileLike(): boolean {
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;
  const touchPoints = navigator.maxTouchPoints ?? 0;
  // Most phones report coarse + no-hover; landscape iPhones are >900 wide but
  // still ~430 on the short side — the old width-only test promoted them to
  // medium and melted the GPU.
  if ((coarse || noHover) && shortSide < 1024) return true;
  // A touchscreen alone proves nothing. Windows laptops report ten touch
  // points and still have a discrete GPU and a mouse, and their viewport is
  // under 820px tall on a 1366x768 panel or in any window that is not
  // maximised — so this branch on its own quietly hands a desktop the phone
  // budget. It has to agree with the pointer before it counts.
  if (touchPoints > 1 && (coarse || noHover) && shortSide < 820) return true;
  return false;
}

/**
 * Whether the visitor has asked the system for less animation.
 *
 * Deliberately *not* a quality tier. The two were the same thing here until it
 * became clear what that costs: the preference is common on Windows — it is on
 * whenever "Animation effects" is switched off — and routing it to the low tier
 * handed anyone with that setting a sixth of the grass over a sixth of the
 * area, no shadows, no bloom, quarter-resolution textures and a third of the
 * draw distance, on hardware that could run the full world comfortably.
 *
 * "Reduce animation" is a statement about *motion*, not about how much a GPU
 * can push. Anything that wants to hold still for these visitors — swaying
 * grass, wheeling birds, drifting cloud — should read this and damp its own
 * movement, and leave the density of the world alone.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function detectQuality(): QualityBudget {
  if (typeof window === "undefined") return BUDGETS.medium;

  // `?quality=high` forces a tier. Auto-detection reads the device, which
  // makes it impossible to review the high-end scene from a machine that
  // probes as low — including headless browsers, where every screenshot would
  // otherwise show the cut-down world.
  const forced = new URLSearchParams(window.location.search).get("quality");
  if (forced === "low" || forced === "medium" || forced === "high") {
    return BUDGETS[forced];
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory =
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  // Note what is *not* here: `prefers-reduced-motion`. It used to return the
  // low tier outright, which is a category error — it says the visitor wants
  // less movement, not that their machine is weak — and it cost anyone with
  // Windows animation effects switched off six sevenths of the meadow. See
  // `prefersReducedMotion` for the signal that motion should read instead.
  const tier: QualityTier =
    // Phones and tablets: the GPU is usually the bottleneck, not the CPU.
    // Always low — even flagship SoCs choke on the medium shadow + canopy load.
    isMobileLike() || cores <= 4 || memory <= 4
      ? "low"
      : cores <= 8 || memory <= 8
        ? "medium"
        : "high";

  // Two separate bugs have now been traced to a desktop being silently handed
  // the phone budget, and in both cases the symptom — a thin meadow, a sky that
  // never changed — pointed nowhere near the cause. Saying so out loud costs
  // one line in the console and makes the next one obvious.
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[punaab] quality: ${tier} (cores ${cores}, memory ${memory}GB, ` +
        `mobile-like ${isMobileLike()}, reduced-motion ${prefersReducedMotion()}) ` +
        `— override with ?quality=low|medium|high`
    );
  }

  return BUDGETS[tier];
}

export function budgetFor(tier: QualityTier): QualityBudget {
  return BUDGETS[tier];
}

/**
 * A budget derived from a bare segment count.
 *
 * The escape hatch for callers that still hand a component `segments` and
 * nothing else. It picks the tier whose terrain resolution is closest, so a
 * component given only a number still gets a coherent set of every other knob
 * rather than a scattering of defaults.
 */
export function budgetForSegments(segments: number): QualityBudget {
  let best: QualityTier = "medium";
  let bestGap = Infinity;
  for (const tier of ["low", "medium", "high"] as QualityTier[]) {
    const gap = Math.abs(BUDGETS[tier].terrainSegments - segments);
    if (gap < bestGap) {
      bestGap = gap;
      best = tier;
    }
  }
  return BUDGETS[best];
}

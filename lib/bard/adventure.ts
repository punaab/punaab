/**
 * Where Punaab is going, how he gets there, and what he notices on the way.
 *
 * He used to walk one closed loop forever, which was honest about the tech and
 * dishonest about the world: a 640-metre valley with a dozen named regions and
 * two dozen places worth seeing does not deserve a bard on rails. So this is a
 * director rather than a track. It picks somewhere he has not been lately,
 * routes him there over the road network, and hands him to the terrain for the
 * last stretch across country.
 *
 * Three things shape everything below:
 *
 * 1. **He never walks through anything.** Every position update in this file
 *    goes through `resolveMove`, and a stuck-detector using `nearestClearPoint`
 *    catches the cases geometry wins anyway. There is exactly one place in this
 *    module that writes `this.x` / `this.z`, and it is `step()`.
 * 2. **He walks with purpose.** About half a metre a second on the flat — quick
 *    enough to cover the valley, slow enough that the scenery still reads. He
 *    lingers when he arrives to talk, trade, and tell stories, then picks a
 *    fresh stretch of the map rather than commuting the same market loop.
 * 3. **Nothing here calls `Math.random`.** His itinerary is not world layout, so
 *    determinism is not strictly required — but a reproducible journey is worth
 *    having when you are trying to work out why he ended up in the fen, so the
 *    whole thing runs off one counter-based hash stream.
 *
 * Y is deliberately absent. This module solves a 2D problem on the XZ plane;
 * `components/world/Bard.tsx` owns the ground under his feet.
 */

import * as THREE from "three";

import { DESTINATIONS, type Destination } from "@/lib/bard/destinations";
import {
  isBlocked,
  nearestClearPoint,
  resolveMove,
} from "@/lib/world/collision";
import { NPCS, isAnimal } from "@/lib/world/npc";
import { findClearPath } from "@/lib/world/pathfind";
import { REGIONS, regionAt, type Region } from "@/lib/world/regions";
import {
  ROADS,
  ROAD_HALF_WIDTH,
  WATER_LEVEL,
  WORLD_SIZE,
  distanceToRoad,
  heightAt,
  slopeAt,
} from "@/lib/world/terrain";

/**
 * What he is doing right now.
 *
 * Structurally identical to `Destination["activity"]` on purpose — a
 * destination's authored activity is assigned straight into state — but
 * declared here because the camera and the UI both import it from the bard and
 * should not have to know that his itinerary lives in another file.
 */
export type Activity =
  | "travelling"
  | "performing"
  | "trading"
  | "talking"
  | "resting"
  | "wondering"
  | "discovering";

/** @deprecated The itinerary moved to `lib/bard/destinations`. Use `Destination`. */
export type Stop = Destination;

/** His collision footprint. Wider than his shoulders so he keeps a polite berth. */
export const BARD_RADIUS = 0.42;

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/**
 * Ground speed on the flat. A purposeful walk — quicker than a museum shuffle,
 * still well short of a jog. Animation timeScale is separate (see Bard.tsx).
 */
const WALK_SPEED = 0.58;

/** Radians per second he can turn. Slow enough to read as a body, not a turret. */
const TURN_RATE = 2.15;

/** Seconds to reach full pace from a standstill, and to shed it again. */
const ACCELERATION = 0.55;

/** How close counts as reaching a waypoint, and as reaching the destination. */
const WAYPOINT_RADIUS = 2.6;
const ARRIVE_RADIUS = 2.0;

/** Shortest trip worth routing over roads when he is cutting across country. */
const ROAD_MIN_TRIP = 55;

/**
 * How much further than the crow's flight a road route may be before he gives
 * up on it and goes overland. Roads are worth a detour — they are graded, they
 * are drawn, and they are where the world put its scenery — but not any detour.
 *
 * Corner-to-corner trips over the current network measure 1.12 to 1.58; the
 * headroom above that is for the walk to and from the network, which is what
 * actually decides it for anywhere built well off a road.
 */
const ROAD_DETOUR_LIMIT = 2;

/**
 * Most trips ask the road first. The rest he walks as the crow flies — a bard
 * on a whim, not a coach on a timetable.
 */
const ROAD_PREFER_CHANCE = 0.74;

/** When he is in a road mood, shorter hops still bother with the network. */
const ROAD_MIN_TRIP_PREFERRED = 28;

/** In a road mood he will accept a longer graded detour. */
const ROAD_DETOUR_PREFERRED = 2.75;

/** Seconds of no useful progress before he tries something other than pushing. */
const STALL_PATIENCE = 0.85;

/** How far ahead he peeks for trunks and walls before committing a step. */
const LOOK_AHEAD = 4.4;
/** Extra probe lengths when the far look-ahead is blocked — rocks beside the path. */
const LOOK_AHEAD_NEAR = [2.2, 3.2, 4.4] as const;

/** Hard cap on un-stick snaps — anything farther is a re-route, not a teleport. */
const MAX_UNSTICK_JUMP = 2.35;

/**
 * Seconds overlapping geometry before the un-stick fires. Long enough that
 * `resolveMove`'s own escape gets first refusal — it slides out of most contacts
 * within a frame or two — short enough that nobody watching sees him shudder.
 */
const STUCK_PATIENCE = 0.4;

/** Seconds after an un-stick before another may fire, so it cannot oscillate. */
const UNSTICK_COOLDOWN = 3;

/** Abandon a destination he has been failing to reach for this long. */
const TRAVEL_TIMEOUT = 420;

/**
 * Seconds a new region must stay the nearest one before it counts as entered.
 * Region membership is a nearest-centre test, so walking a border without this
 * would fire the banner a dozen times in twenty paces.
 */
const REGION_HYSTERESIS = 1.6;

/** Slope is resampled on this interval rather than every frame — see `step()`. */
const SLOPE_INTERVAL = 0.3;

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * Integer hash -> [0, 1). Copied from `lib/world/terrain.ts` rather than
 * imported, because that module does not export it and this one should not grow
 * a reason for it to.
 *
 * `Math.imul` is load-bearing, not a micro-optimisation. A plain `*` on these
 * constants produces results past 2^53, so the float silently drops its low
 * bits — and those low bits are the entire output of a hash.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Counter-based stream. Not a great generator, but a perfectly good one for
 * picking a line of dialogue, and it has the property that matters here: the
 * same seed always produces the same journey, so a bug you saw once is a bug you
 * can see again.
 */
class Stream {
  private step = 0;

  constructor(readonly seed: number) {}

  get cursor(): number {
    return this.step;
  }

  set cursor(value: number) {
    this.step = Math.max(0, value | 0);
  }

  next(): number {
    return hash2(this.seed, this.step++);
  }

  range(low: number, high: number): number {
    return low + this.next() * (high - low);
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.min(list.length - 1, Math.floor(this.next() * list.length))];
  }
}

// ---------------------------------------------------------------------------
// The road graph
// ---------------------------------------------------------------------------

type Waypoint = { x: number; z: number };

/** Dry, unblocked footing near a click or authored landmark. */
function standableNear(
  x: number,
  z: number,
  radius: number
): Waypoint | null {
  const half = WORLD_SIZE / 2 - 2;
  const tryPoint = (px: number, pz: number): Waypoint | null => {
    if (Math.abs(px) > half || Math.abs(pz) > half) return null;
    if (heightAt(px, pz) < WATER_LEVEL + 0.35) return null;
    if (isBlocked(px, pz, radius)) return null;
    return { x: px, z: pz };
  };

  const direct = tryPoint(x, z);
  if (direct) return direct;

  const clear = nearestClearPoint(x, z, radius);
  const fromClear = tryPoint(clear.x, clear.z);
  if (fromClear) return fromClear;

  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let i = 1; i <= 420; i++) {
    const angle = i * GOLDEN;
    const distance = 0.85 * Math.sqrt(i);
    const hit = tryPoint(x + Math.cos(angle) * distance, z + Math.sin(angle) * distance);
    if (hit) return hit;
  }
  return null;
}

type RoadGraph = {
  x: Float64Array;
  z: Float64Array;
  links: Array<Array<{ to: number; cost: number }>>;
};

/**
 * Metres between graph nodes. Fine enough that following the nodes traces the
 * curve rather than cutting its corners, coarse enough that the whole network is
 * a few hundred nodes and A* over it costs nothing worth measuring.
 */
const NODE_SPACING = 9;

/**
 * How close two nodes on *different* roads must be to count as a junction.
 * Every spur in `ROADS` starts on a control point of the circuit, but the
 * samples either side of that point land wherever the arc-length parameterisation
 * puts them — up to half a spacing away. This has to clear that.
 */
const JUNCTION_REACH = 7.5;

let graphCache: RoadGraph | null = null;

/**
 * Built on first use, not at import. `ROADS` already costs an arc-length table
 * per curve at module load; adding a graph build to that would put it on the
 * server's critical path for a component that only ever renders on the client.
 */
function roadGraph(): RoadGraph {
  if (graphCache) return graphCache;

  const xs: number[] = [];
  const zs: number[] = [];
  const roads: number[] = [];
  const links: Array<Array<{ to: number; cost: number }>> = [];

  const connect = (a: number, b: number) => {
    const cost = Math.hypot(xs[a] - xs[b], zs[a] - zs[b]);
    links[a].push({ to: b, cost });
    links[b].push({ to: a, cost });
  };

  for (let r = 0; r < ROADS.length; r++) {
    const curve = ROADS[r];
    const divisions = Math.max(2, Math.round(curve.getLength() / NODE_SPACING));
    const points = curve.getSpacedPoints(divisions);
    // `getSpacedPoints` returns divisions + 1 points; on a closed curve the last
    // duplicates the first, and the wrap edge below supplies the join.
    const count = curve.closed ? divisions : divisions + 1;
    const start = xs.length;

    for (let i = 0; i < count; i++) {
      xs.push(points[i].x);
      zs.push(points[i].z);
      roads.push(r);
      links.push([]);
    }
    for (let i = 1; i < count; i++) connect(start + i - 1, start + i);
    if (curve.closed) connect(start + count - 1, start);
  }

  // Junctions, by brute force. A few hundred nodes is under a hundred thousand
  // distance tests, once, ever — a spatial hash here would be more code than the
  // rest of this function for a saving nobody can perceive.
  for (let a = 0; a < xs.length; a++) {
    for (let b = a + 1; b < xs.length; b++) {
      // Same-road pairs are skipped deliberately: the circuit passes close to
      // itself in a couple of places, and welding those would let a route
      // short-cut across country and call it a road.
      if (roads[a] === roads[b]) continue;
      if (Math.hypot(xs[a] - xs[b], zs[a] - zs[b]) > JUNCTION_REACH) continue;
      connect(a, b);
    }
  }

  graphCache = { x: Float64Array.from(xs), z: Float64Array.from(zs), links };
  return graphCache;
}

function nearestNode(graph: RoadGraph, x: number, z: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < graph.x.length; i++) {
    const dx = graph.x[i] - x;
    const dz = graph.z[i] - z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * A* over the junction graph.
 *
 * The open set is a linear scan rather than a heap. With a few hundred nodes
 * that is worst-case tens of thousands of comparisons for a query he issues
 * once every few minutes; a heap would be strictly more code and strictly less
 * obvious.
 */
function findRoute(graph: RoadGraph, start: number, goal: number): number[] | null {
  const n = graph.x.length;
  const cost = new Float64Array(n).fill(Infinity);
  const estimate = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const open = new Uint8Array(n);
  const closed = new Uint8Array(n);

  const heuristic = (i: number) =>
    Math.hypot(graph.x[i] - graph.x[goal], graph.z[i] - graph.z[goal]);

  cost[start] = 0;
  estimate[start] = heuristic(start);
  open[start] = 1;

  for (;;) {
    let current = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (open[i] && estimate[i] < best) {
        best = estimate[i];
        current = i;
      }
    }
    // Open set exhausted without reaching the goal: the network is in two
    // pieces. Possible if a spur ever stops touching the circuit.
    if (current < 0) return null;
    if (current === goal) break;

    open[current] = 0;
    closed[current] = 1;

    for (const link of graph.links[current]) {
      if (closed[link.to]) continue;
      const tentative = cost[current] + link.cost;
      if (tentative >= cost[link.to]) continue;
      cameFrom[link.to] = current;
      cost[link.to] = tentative;
      estimate[link.to] = tentative + heuristic(link.to);
      open[link.to] = 1;
    }
  }

  const route: number[] = [];
  for (let i = goal; i >= 0; i = cameFrom[i]) {
    route.push(i);
    if (i === start) break;
  }
  route.reverse();
  return route[0] === start ? route : null;
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/**
 * Only reachable if `DESTINATIONS` is empty. One region centre each keeps him
 * walking the map instead of standing in a field, which is a far easier failure
 * to diagnose than a bard who does nothing for no visible reason.
 */
function fallbackDestinations(): Destination[] {
  return REGIONS.map((region) => ({
    id: `region-${region.id}`,
    name: region.name,
    x: region.x,
    z: region.z,
    activity: "wondering" as const,
    dwell: 20,
    lines: [region.blurb],
  }));
}

const PLACES: readonly Destination[] = DESTINATIONS.length
  ? DESTINATIONS
  : fallbackDestinations();

/**
 * How many places he must see before he is allowed back somewhere. Capped one
 * short of the whole list so there is always a legal move. Kept large so he
 * explores the valley instead of ping-ponging two neighbouring stalls.
 */
const RECENT_MEMORY = Math.max(1, Math.min(PLACES.length - 1, 32));

/** Chance to follow the authored tour order instead of a weighted whim. */
const TOUR_FOLLOW_CHANCE = 0.42;

/** Things he says to himself between places. */
const TRAVEL_LINES = [
  "Mm-hmm... hmm...",
  "Four days to the coast. Maybe five, the way I walk.",
  "Good light. Good road.",
  "Somebody's been this way recently.",
  "I'll rest at the next fire I find.",
  "Every road in this valley goes somewhere. That's rarer than you'd think.",
  "No hurry. Nothing at the end of a road that won't wait.",
  "The map's wrong here. The map's wrong most places.",
  "A tune for the next mile. That's how I keep the road company.",
  "Haven't taken this fork in a while. Good.",
  "Let's see what's over the next rise.",
];

/** Haggling / market chatter while he dwells on a trade stop. */
const TRADE_LINES = [
  "Two coins for the jar? Done — and a story thrown in.",
  "Fresh from the road. Nothing dusty but my boots.",
  "Trade fair and the day stays friendly.",
  "I'll take the bread. You take the tune.",
  "Mind the latch on that — it's older than both of us.",
  "A fair swap, then. Shake on it.",
];

/** Conversations with locals. */
const TALK_LINES = [
  "Tell me how the harvest treated you.",
  "I heard a rumour three valleys over — want the short version?",
  "Your well water's honest. Not every place can say that.",
  "Sit a minute. Roads are quieter with company.",
  "That scar? Long story. The funny part's at the end.",
  "Keep your children off the fen after dark. Old advice. Still good.",
];

/** Story beats — longer linger lines. */
const STORY_LINES = [
  "Once I traded a song for a boat ride and still got wet.",
  "There was a king who banned whistling. Lasted a week.",
  "I met a fox who spoke better than most mayors.",
  "In the watchtower they keep a candle for travellers. I left it burning.",
  "The first lute I owned had three strings and more opinions than I did.",
  "Remind me someday about the inn that charged for silence.",
];

/**
 * What he says when he actually stops to play — a wandering bard offering a
 * song he carries, not a half-formed hum on the road.
 */
export const SONG_INTRO_LINES = [
  "Here's a song I wrote.",
  "I've got a song for you — wrote it on the road.",
  "Let me play you something I made.",
  "A little tune I picked up between towns.",
  "This one's mine. Wrote it walking.",
  "Pull up a moment — I've got a song.",
  "Here's one from the road.",
  "I wrote this under a hedge one night. Listen.",
];

/** Said on crossing into somewhere named. `{name}` is the region. */
const REGION_LINES = [
  "{name}. I know this ground.",
  "So — {name}. Been a while.",
  "You can feel where {name} starts. Always could.",
  "{name}, then. Mind your footing.",
  "They sing a different tune in {name}.",
];

/** Filler for a destination whose author gave it no lines. */
const ARRIVAL_LINES = [
  "Here, then.",
  "This'll do.",
  "Right. Let's have a look at you.",
];

/**
 * Snapshot of the director for local resume after refresh.
 * Travels stay on this browser only — not shared with other visitors.
 */
export type AdventureSnapshot = {
  v: 1;
  seed: number;
  rngStep: number;
  x: number;
  z: number;
  heading: number;
  pace: number;
  route: Waypoint[];
  routeIndex: number;
  goal: Waypoint;
  started: boolean;
  recent: string[];
  visited: string[];
  lore: string[];
  quests: string[];
  travelTime: number;
  stallTime: number;
  detours: number;
  stuckTime: number;
  unstickCooldown: number;
  discoverRemaining: number;
  pauseRemaining: number;
  nextPause: number;
  chatterTimer: number;
  slopeTimer: number;
  slopeFactor: number;
  idleHeading: number;
  activity: Activity;
  destinationId: string | null;
  stopId: string | null;
  dwellRemaining: number;
  regionId: string;
  pendingRegionId: string | null;
  pendingRegionTime: number;
};

function placeById(id: string | null | undefined): Destination | null {
  if (!id) return null;
  return PLACES.find((place) => place.id === id) ?? null;
}

function regionById(id: string | null | undefined): Region | null {
  if (!id) return null;
  return REGIONS.find((region) => region.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type AdventureState = {
  activity: Activity;
  /**
   * Live world position on the XZ plane, mutated in place every frame. Read it,
   * do not retain it. `y` is always 0 — the ground is the renderer's problem.
   */
  position: THREE.Vector3;
  /** Facing, three.js Y-rotation convention: forward is (sin h, cos h). */
  heading: number;
  /** Ground speed actually achieved this frame, m/s. Zero when blocked. */
  speed: number;
  /** Where he is headed, or where he stands while stopped. */
  destination: Destination | null;
  /** Non-null only while he is actually stopped somewhere. */
  stop: Destination | null;
  dwellRemaining: number;
  /** The named region he is currently in, after hysteresis. */
  region: Region;
  /** True when the last move had to be resolved against geometry. */
  blocked: boolean;
};

/**
 * Everything the world can hear him do.
 *
 * All of these are called from inside `update()`, i.e. from inside a `useFrame`.
 * Anything expensive — audio, `setState` — should be scheduled, not done inline,
 * or you will pay for it in the frame he arrives somewhere.
 */
export type AdventureCallbacks = {
  /** A line of dialogue. `activity` is what he was doing when he said it. */
  onSay?: (line: string, activity: Activity) => void;
  /** He reached a destination and is about to dwell there. Fires first. */
  onArrive?: (destination: Destination) => void;
  /** He is leaving. Not fired if he gives up on a destination he never reached. */
  onDepart?: (destination: Destination) => void;
  /** He crossed a border. `previous` is null only for the very first region. */
  onRegionChange?: (region: Region, previous: Region | null) => void;
  /** A destination's `loreId`, the first time he ever arrives there. */
  onLore?: (loreId: string, destination: Destination) => void;
  /** A destination's `questId`, the first time he ever arrives there. */
  onQuest?: (questId: string, destination: Destination) => void;
  /** A destination's `waresTag`. Fires on every visit — trade reopens. */
  onTrade?: (waresTag: string, destination: Destination) => void;
  /** Activity changed. Cheaper to listen to than polling state every frame. */
  onActivityChange?: (activity: Activity, previous: Activity) => void;
};

// ---------------------------------------------------------------------------
// The director
// ---------------------------------------------------------------------------

export class AdventureDirector {
  /** Top pace, m/s. Read by the renderer to drive the walk blend. */
  readonly walkSpeed = WALK_SPEED;

  private readonly callbacks: AdventureCallbacks;
  private rng: Stream;

  private readonly state: AdventureState;

  // --- Position and steering ---
  private x = 0;
  private z = 0;
  private heading = 0;
  private pace = 0;

  // --- Route ---
  private route: Waypoint[] = [];
  private routeIndex = 0;
  private goal: Waypoint = { x: 0, z: 0 };
  /** Visitor map click / pin — hold the goal through stalls instead of wandering off. */
  private playerDirected = false;
  private timeoutRetries = 0;

  // --- Bookkeeping ---
  private started = false;
  private recent: string[] = [];
  private visited = new Set<string>();
  private lore = new Set<string>();
  private quests = new Set<string>();

  // --- Timers ---
  private travelTime = 0;
  private stallTime = 0;
  private detours = 0;
  /** Seconds before another mid-leg tree detour may splice into the route. */
  private detourCooldown = 0;
  private stuckTime = 0;
  private unstickCooldown = 0;
  private discoverRemaining = 0;
  private pauseRemaining = 0;
  private nextPause = 0;
  private chatterTimer = 0;
  private slopeTimer = 0;
  private slopeFactor = 1;
  private idleHeading = 0;

  /** Frozen in place while a song plays — no travel, no dwell clock. */
  private held = false;
  private activityBeforeHold: Activity | null = null;

  // --- Region hysteresis ---
  private pendingRegion: Region | null = null;
  private pendingRegionTime = 0;

  constructor(callbacks: AdventureCallbacks = {}, seed = 0x5eed) {
    this.callbacks = callbacks;
    this.rng = new Stream(seed);

    // He starts standing at the first authored place rather than at the origin,
    // so the opening shot is of somewhere rather than of a field.
    const opening = PLACES.length ? PLACES[0] : null;
    this.x = opening ? opening.x : 0;
    this.z = opening ? opening.z : 0;

    this.state = {
    activity: "travelling",
      position: new THREE.Vector3(this.x, 0, this.z),
      heading: 0,
    speed: 0,
      destination: null,
    stop: null,
    dwellRemaining: 0,
      region: regionAt(this.x, this.z),
      blocked: false,
    };

    this.nextPause = this.rng.range(70, 150);
    this.chatterTimer = this.rng.range(12, 30);
  }

  get current(): Readonly<AdventureState> {
    return this.state;
  }

  /** Places he has arrived at at least once, for a map screen or a save. */
  get seen(): ReadonlySet<string> {
    return this.visited;
  }

  /**
   * Pin him where he stands (used while a song is playing). Travel and dwell
   * timers freeze so a long track cannot burn through a stop or walk him off
   * mid-strum.
   */
  hold(held: boolean): void {
    if (held === this.held) return;
    this.held = held;
    if (held) {
      this.activityBeforeHold = this.state.activity;
      this.pace = 0;
      this.state.speed = 0;
      this.setActivity("performing");
      return;
    }
    const restore =
      this.state.stop?.activity ??
      (this.activityBeforeHold && this.activityBeforeHold !== "performing"
        ? this.activityBeforeHold
        : "travelling");
    this.activityBeforeHold = null;
    this.setActivity(restore);
  }

  /**
   * After a song: pack up, leave the stop if he was lingering, and take the
   * road again. Prefer `hold(false)` when he should finish talking/trading
   * first — this forces the next leg immediately.
   */
  resumeTravelling(): void {
    this.held = false;
    this.activityBeforeHold = null;
    this.pace = 0;
    this.state.speed = 0;

    const place = this.state.stop;
    if (place) {
      this.state.dwellRemaining = 0;
      this.discoverRemaining = 0;
      this.state.stop = null;
      this.callbacks.onDepart?.(place);
      this.chooseDestination();
      return;
    }

    this.setActivity("travelling");
  }

  update(delta: number): Readonly<AdventureState> {
    // A tab that was in the background hands back a delta measured in seconds.
    // Integrating that in one go would teleport him through a wall, so cap it.
    const dt = Math.min(Math.max(delta, 0), 0.05);
    if (!this.started) this.begin();
    this.tick(dt);
    return this.state;
  }

  snapshot(): AdventureSnapshot {
    return {
      v: 1,
      seed: this.rng.seed,
      rngStep: this.rng.cursor,
      x: this.x,
      z: this.z,
      heading: this.heading,
      pace: this.pace,
      route: this.route.map((p) => ({ x: p.x, z: p.z })),
      routeIndex: this.routeIndex,
      goal: { x: this.goal.x, z: this.goal.z },
      started: this.started,
      recent: [...this.recent],
      visited: [...this.visited],
      lore: [...this.lore],
      quests: [...this.quests],
      travelTime: this.travelTime,
      stallTime: this.stallTime,
      detours: this.detours,
      stuckTime: this.stuckTime,
      unstickCooldown: this.unstickCooldown,
      discoverRemaining: this.discoverRemaining,
      pauseRemaining: this.pauseRemaining,
      nextPause: this.nextPause,
      chatterTimer: this.chatterTimer,
      slopeTimer: this.slopeTimer,
      slopeFactor: this.slopeFactor,
      idleHeading: this.idleHeading,
      activity: this.state.activity,
      destinationId: this.state.destination?.id ?? null,
      stopId: this.state.stop?.id ?? null,
      dwellRemaining: this.state.dwellRemaining,
      regionId: this.state.region.id,
      pendingRegionId: this.pendingRegion?.id ?? null,
      pendingRegionTime: this.pendingRegionTime,
    };
  }

  /** Resume a local journey after refresh. Colliders must already be installed. */
  restore(snapshot: AdventureSnapshot): void {
    this.rng = new Stream(snapshot.seed);
    this.rng.cursor = snapshot.rngStep;
    this.x = snapshot.x;
    this.z = snapshot.z;
    this.heading = snapshot.heading;
    this.pace = snapshot.pace;
    this.route = snapshot.route.map((p) => ({ x: p.x, z: p.z }));
    this.routeIndex = snapshot.routeIndex;
    this.goal = { x: snapshot.goal.x, z: snapshot.goal.z };
    this.started = snapshot.started;
    this.recent = [...snapshot.recent];
    this.visited = new Set(snapshot.visited);
    this.lore = new Set(snapshot.lore);
    this.quests = new Set(snapshot.quests);
    this.travelTime = snapshot.travelTime;
    this.stallTime = snapshot.stallTime;
    this.detours = snapshot.detours;
    this.stuckTime = snapshot.stuckTime;
    this.unstickCooldown = snapshot.unstickCooldown;
    this.discoverRemaining = snapshot.discoverRemaining;
    this.pauseRemaining = snapshot.pauseRemaining;
    this.nextPause = snapshot.nextPause;
    this.chatterTimer = snapshot.chatterTimer;
    this.slopeTimer = snapshot.slopeTimer;
    this.slopeFactor = snapshot.slopeFactor;
    this.idleHeading = snapshot.idleHeading;
    this.held = false;
    this.activityBeforeHold = null;
    // Songs don't persist across refresh — don't resume mid-performance.
    this.state.activity =
      snapshot.activity === "performing"
        ? (placeById(snapshot.stopId)?.activity ?? "travelling")
        : snapshot.activity;
    this.state.destination = placeById(snapshot.destinationId);
    this.state.stop = placeById(snapshot.stopId);
    this.state.dwellRemaining = snapshot.dwellRemaining;
    this.state.region = regionById(snapshot.regionId) ?? regionAt(this.x, this.z);
    this.pendingRegion = regionById(snapshot.pendingRegionId);
    this.pendingRegionTime = snapshot.pendingRegionTime;
    this.state.position.set(this.x, 0, this.z);
    this.state.heading = this.heading;
    this.state.speed = 0;
    this.state.blocked = false;
  }

  private tick(dt: number): void {
    if (this.held) {
      this.pace = 0;
      this.state.speed = 0;
      this.state.position.set(this.x, 0, this.z);
      this.state.heading = this.heading;
      return;
    }

    if (this.state.stop) this.dwell(dt);
    else this.travel(dt);

    this.unstick(dt);
    this.trackRegion(dt);
    this.chatter(dt);

    this.state.position.set(this.x, 0, this.z);
    this.state.heading = this.heading;
  }

  // --- Lifecycle ---------------------------------------------------------

  /**
   * Deferred to the first frame rather than done in the constructor. The
   * director is built in a `useMemo` during render, and the structures whose
   * colliders he must not spawn inside are registered in effects that have not
   * run yet — asking the collision registry anything at construction time gets
   * an answer about an empty world.
   */
  private begin(): void {
    this.started = true;

    const clear = nearestClearPoint(this.x, this.z, BARD_RADIUS);
    this.x = clear.x;
    this.z = clear.z;
    this.state.region = regionAt(this.x, this.z);

    if (PLACES.length) {
      this.visited.add(PLACES[0].id);
      this.remember(PLACES[0].id);
    }
    this.callbacks.onRegionChange?.(this.state.region, null);
    this.chooseDestination();
  }

  // --- Travel ------------------------------------------------------------

  private travel(dt: number): void {
    this.travelTime += dt;

    // Nothing to walk to. Only happens if `PLACES` is empty, which the fallback
    // above makes very hard, but standing still beats dividing by zero.
    if (!this.state.destination) {
      this.pace += (0 - this.pace) * Math.min(1, dt / ACCELERATION);
      this.state.speed = 0;
      return;
    }

    if (this.travelTime > TRAVEL_TIMEOUT) {
      // Something between him and it has beaten him. When a visitor sent him,
      // re-path once before giving the valley back to wandering.
      if (this.playerDirected && this.timeoutRetries < 1) {
        this.timeoutRetries++;
        this.travelTime = 0;
        this.detours = 0;
        this.route = this.planRoute(this.goal);
        this.routeIndex = 0;
        return;
      }
      this.chooseDestination();
      return;
    }

    // A roadside pause: he stops to look at something for a few seconds without
    // it being a destination. Costs nothing and is most of what stops a long
    // walk reading as a conveyor belt. Skip it on player-directed trips — the
    // visitor asked him to go, not to daydream halfway.
    if (!this.playerDirected) {
      if (this.pauseRemaining > 0) {
        this.pauseRemaining -= dt;
        this.pace += (0 - this.pace) * Math.min(1, dt / ACCELERATION);
        this.state.speed = this.pace;
        if (this.pauseRemaining <= 0) this.setActivity("travelling");
        return;
      }
      this.nextPause -= dt;
      if (this.nextPause <= 0) {
        this.nextPause = this.rng.range(80, 170);
        this.pauseRemaining = this.rng.range(5, 11);
        this.setActivity("wondering");
        this.say(this.rng.pick(TRAVEL_LINES), "wondering");
        return;
      }
    }

    const target =
      this.routeIndex < this.route.length ? this.route[this.routeIndex] : this.goal;
    let dx = target.x - this.x;
    let dz = target.z - this.z;
    let distance = Math.hypot(dx, dz);

    const last = this.routeIndex >= this.route.length - 1;
    if (distance <= (last ? ARRIVE_RADIUS : WAYPOINT_RADIUS)) {
      if (last) {
        this.arrive();
        return;
      }
      // Skip anything else already underfoot — a route that doubles back on
      // itself near a junction otherwise has him turn round to touch a node he
      // is standing on.
      do {
        this.routeIndex++;
      } while (
        this.routeIndex < this.route.length - 1 &&
        Math.hypot(
          this.route[this.routeIndex].x - this.x,
          this.route[this.routeIndex].z - this.z
        ) <= WAYPOINT_RADIUS
      );
      const next =
        this.routeIndex < this.route.length ? this.route[this.routeIndex] : this.goal;
      dx = next.x - this.x;
      dz = next.z - this.z;
      distance = Math.hypot(dx, dz);
    }

    // Aim at the waypoint, then bend around anything solid in front of him so
    // he does not pinball into a trunk and stall. If the straight leg is blocked
    // by a stand of trees, splice an A* hop that still ends at the same target.
    this.detourCooldown = Math.max(0, this.detourCooldown - dt);
    if (
      this.detourCooldown <= 0 &&
      distance > 3.5 &&
      this.segmentBlocked(this.x, this.z, target.x, target.z)
    ) {
      const detour = findClearPath(
        this.x,
        this.z,
        target.x,
        target.z,
        BARD_RADIUS
      );
      if (detour && detour.length > 1) {
        this.route.splice(this.routeIndex, 0, ...detour.slice(0, -1));
        this.detourCooldown = 2.4;
        const next = this.route[this.routeIndex];
        dx = next.x - this.x;
        dz = next.z - this.z;
        distance = Math.hypot(dx, dz);
      } else {
        this.detourCooldown = 0.8;
      }
    }

    const desired = this.clearHeading(Math.atan2(dx, dz));
    const error = wrapAngle(desired - this.heading);
    const turn = Math.min(Math.abs(error), TURN_RATE * dt) * Math.sign(error);
    this.heading = wrapAngle(this.heading + turn);

    // Facing away from where he is going means pivoting on the spot, which is
    // what a person does rather than swinging round in a wide arc.
    const alignment = Math.max(0, Math.cos(wrapAngle(desired - this.heading)));
    const easeIn = Math.min(1, distance / 1.4);

    this.slopeTimer -= dt;
    if (this.slopeTimer <= 0) {
      this.slopeTimer = SLOPE_INTERVAL;
      // Four `heightAt` calls, and `heightAt` is not free. He cannot climb far
      // enough in a third of a second for the staleness to show.
      this.slopeFactor = 1 - 0.5 * clamp01(slopeAt(this.x, this.z) / 0.6);
    }

    const wanted = WALK_SPEED * alignment * easeIn * this.slopeFactor;
    this.pace += (wanted - this.pace) * Math.min(1, dt / ACCELERATION);

    const moved = this.step(Math.sin(this.heading), Math.cos(this.heading), this.pace * dt);
    this.state.speed = moved / dt;

    // Stalling: touching something is fine and happens constantly; failing to
    // make ground while trying to is not.
    const intended = this.pace * dt;
    if (intended > 0.004 && moved < intended * 0.4) this.stallTime += dt;
    else this.stallTime = Math.max(0, this.stallTime - dt * 2);

    if (this.stallTime > STALL_PATIENCE) {
      this.stallTime = 0;
      this.escalate();
    }
  }

  /**
   * If the straight line toward a goal is blocked a few metres out, pick the
   * nearest clear bearing that still roughly points the same way. This is what
   * stops him locking onto a cottage wall and walking into it forever.
   */
  private clearHeading(desired: number): number {
    const radius = BARD_RADIUS * 1.2;
    if (this.headingOpen(desired, LOOK_AHEAD, radius)) return desired;

    let best = desired;
    let bestScore = -Infinity;
    for (const probe of LOOK_AHEAD_NEAR) {
      for (const offset of [0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.55, -1.55, 2.1, -2.1]) {
        const heading = wrapAngle(desired + offset);
        if (!this.headingOpen(heading, probe, radius)) continue;
        // Prefer openings that stay aimed at the goal over wild pivots, and
        // nearer clearances that dodge a rock without abandoning the road.
        const score =
          Math.cos(offset) * 2 +
          (1 - Math.abs(offset)) +
          (LOOK_AHEAD - probe) * 0.08;
        if (score > bestScore) {
          bestScore = score;
          best = heading;
        }
      }
      if (bestScore > -Infinity) return best;
    }
    return best;
  }

  /** True when a short probe along `heading` stays clear of solids. */
  private headingOpen(heading: number, probe: number, radius: number): boolean {
    const steps = Math.max(2, Math.ceil(probe / 1.1));
    for (let i = 1; i <= steps; i++) {
      const t = (probe * i) / steps;
      const x = this.x + Math.sin(heading) * t;
      const z = this.z + Math.cos(heading) * t;
      if (isBlocked(x, z, radius)) return false;
    }
    return true;
  }

  /**
   * The ladder he climbs when the world will not let him past: step around it,
   * then ask the road network for a different way, then give up on the place
   * entirely. Each rung is cheaper to be wrong about than the one below it.
   */
  private escalate(): void {
    // Close enough. Somewhere authored at a well or a stall can end up with its
    // only clear standing room just outside the arrival radius, and a bard who
    // scrapes the last two metres of a four-hundred-metre walk forever is a
    // worse bug than one who calls it arrived.
    if (Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < 6) {
      this.arrive();
      return;
    }

    this.detours++;
    if (this.detours <= 3) {
      this.sidestep();
      return;
    }
    // Re-path around whatever he hit. Player-directed trips keep trying longer
    // before the director abandons the spot for somewhere else.
    const repathBudget = this.playerDirected ? 10 : 4;
    if (this.detours <= repathBudget) {
      this.route = this.planRoute(this.goal);
      this.routeIndex = 0;
      return;
    }
    this.chooseDestination();
  }

  /** Inserts clear waypoints around the obstacle, trying several openings. */
  private sidestep(): void {
    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);
    const reaches = [3.2, 5.0, 7.2, 9.5];
    const angles = [0.55, -0.55, 0.95, -0.95, 1.4, -1.4, 1.9, -1.9, Math.PI * 0.9];

    // Prefer a short A* hop past whatever is in front — smarter than a blind
    // flank when a rock sits on the graded road.
    const ahead = {
      x: this.x + forwardX * 8,
      z: this.z + forwardZ * 8,
    };
    const clearAhead = nearestClearPoint(ahead.x, ahead.z, BARD_RADIUS);
    const hop = findClearPath(
      this.x,
      this.z,
      clearAhead.x,
      clearAhead.z,
      BARD_RADIUS
    );
    if (hop && hop.length >= 1) {
      this.route.splice(this.routeIndex, 0, ...hop.slice(0, 4));
      return;
    }

    for (const reach of reaches) {
      for (const angle of angles) {
        const heading = wrapAngle(this.heading + angle);
        const x = this.x + Math.sin(heading) * reach + forwardX * 1.4;
        const z = this.z + Math.cos(heading) * reach + forwardZ * 1.4;
        if (isBlocked(x, z, BARD_RADIUS)) continue;
        const clear = nearestClearPoint(x, z, BARD_RADIUS);
        this.route.splice(this.routeIndex, 0, { x: clear.x, z: clear.z });
        return;
      }
    }

    // Nowhere obvious — shove a hashed flank in and keep going.
    const side = this.rng.next() < 0.5 ? -1 : 1;
    const px = -forwardZ * side;
    const pz = forwardX * side;
    const clear = nearestClearPoint(
      this.x + px * 5.5 + forwardX * 2,
      this.z + pz * 5.5 + forwardZ * 2,
      BARD_RADIUS
    );
    this.route.splice(this.routeIndex, 0, { x: clear.x, z: clear.z });
  }

  // --- Movement ----------------------------------------------------------

  /**
   * The one place in this module that moves him. Everything goes through
   * `resolveMove`, so there is no code path — not a detour, not an un-stick, not
   * a route change — that can put him inside a wall.
   *
   * Returns the distance actually covered, which is what the stall detector and
   * the walk-cycle blend both want.
   */
  private step(dirX: number, dirZ: number, distance: number): number {
    if (distance <= 0) return 0;
    const resolved = resolveMove(
      this.x,
      this.z,
      this.x + dirX * distance,
      this.z + dirZ * distance,
      BARD_RADIUS
    );
    const moved = Math.hypot(resolved.x - this.x, resolved.z - this.z);
    this.x = resolved.x;
    this.z = resolved.z;
    this.state.blocked = resolved.blocked;
    return moved;
  }

  /**
   * Recovery, not prevention. `resolveMove` never walks him into anything, but a
   * collider registered underneath him — a cart parked where he stands, a scene
   * rebuilt around him — can leave him overlapping without ever having moved.
   *
   * The cooldown is the important part. Un-sticking every frame while still
   * overlapping is exactly the vibration this is meant to avoid, so it fires
   * once, then holds off long enough to see whether it worked.
   */
  private unstick(dt: number): void {
    if (this.unstickCooldown > 0) {
      this.unstickCooldown -= dt;
      return;
    }
    if (!isBlocked(this.x, this.z, BARD_RADIUS)) {
      this.stuckTime = 0;
      return;
    }

    this.stuckTime += dt;
    if (this.stuckTime < STUCK_PATIENCE) return;

    this.stuckTime = 0;
    this.unstickCooldown = UNSTICK_COOLDOWN;

    const clear = nearestClearPoint(this.x, this.z, BARD_RADIUS);
    const jump = Math.hypot(clear.x - this.x, clear.z - this.z);

    if (jump <= MAX_UNSTICK_JUMP) {
      this.x = clear.x;
      this.z = clear.z;
    } else {
      // Large snaps read as teleports. Nudge locally, then re-route around it.
      this.nudgeClearLocal();
      this.sidestep();
      if (this.state.destination) {
        this.route = this.planRoute(this.goal);
        this.routeIndex = 0;
        this.detours = Math.max(this.detours, 2);
      }
      // Still overlapping after a local probe — accept the clear point only as
      // a last resort (usually a doorway / nested collider).
      if (isBlocked(this.x, this.z, BARD_RADIUS)) {
        this.x = clear.x;
        this.z = clear.z;
      }
      return;
    }

    if (jump > 1.2 && this.state.destination) {
      this.route = this.planRoute(this.goal);
      this.routeIndex = 0;
    }
  }

  /** Small ring search so un-stick never hurls him across the green. */
  private nudgeClearLocal(): void {
    const reaches = [1.1, 1.7, 2.3];
    const angles = [0.55, -0.55, 1.15, -1.15, 1.85, -1.85, Math.PI];
    for (const reach of reaches) {
      for (const angle of angles) {
        const heading = wrapAngle(this.heading + angle);
        const x = this.x + Math.sin(heading) * reach;
        const z = this.z + Math.cos(heading) * reach;
        if (isBlocked(x, z, BARD_RADIUS)) continue;
        const clear = nearestClearPoint(x, z, BARD_RADIUS);
        if (Math.hypot(clear.x - this.x, clear.z - this.z) > MAX_UNSTICK_JUMP) {
          continue;
        }
        this.x = clear.x;
        this.z = clear.z;
        return;
      }
    }
  }

  // --- Arriving and lingering --------------------------------------------

  private arrive(): void {
    const place = this.state.destination;
    if (!place) return;

    this.playerDirected = false;
    this.timeoutRetries = 0;
    this.state.stop = place;
    this.state.speed = 0;
    this.pace = 0;
    this.stallTime = 0;
    this.detours = 0;
    this.visited.add(place.id);
    this.remember(place.id);

    // Long enough to be a stop rather than a pause. The author's number wins
    // above the floor; the floor exists because a two-second visit to somewhere
    // that took four minutes to reach reads as a bug.
    const dwellScale =
      place.activity === "trading"
        ? this.rng.range(1.15, 1.45)
        : place.activity === "talking" || place.activity === "resting"
          ? this.rng.range(1.1, 1.4)
          : this.rng.range(0.9, 1.25);
    this.state.dwellRemaining = Math.max(14, place.dwell) * dwellScale;
    this.faceCompany();

    const loreId = place.loreId;
    const discovered = loreId !== undefined && !this.lore.has(loreId);
    if (discovered) this.lore.add(loreId);

    // Discovery reads as its own beat before he settles into whatever he came
    // here to do, so it takes the front of the dwell rather than replacing it.
    this.discoverRemaining = discovered
      ? Math.min(7, this.state.dwellRemaining * 0.4)
      : 0;
    this.setActivity(discovered ? "discovering" : place.activity);

    this.callbacks.onArrive?.(place);
    if (discovered) this.callbacks.onLore?.(loreId, place);

    const questId = place.questId;
    if (questId !== undefined && !this.quests.has(questId)) {
      this.quests.add(questId);
      this.callbacks.onQuest?.(questId, place);
    }
    if (place.waresTag) {
      this.callbacks.onTrade?.(place.waresTag, place);
    }

    this.say(this.arrivalLine(place), this.state.activity);
    // First conversation beat soon after he settles in.
    this.chatterTimer = this.rng.range(6, 12);
  }

  /** Turn toward the nearest person so talks/trades read as face-to-face. */
  private faceCompany(): void {
    let bestDist = 9;
    let bestHeading: number | null = null;
    for (const npc of NPCS) {
      if (isAnimal(npc.kind)) continue;
      const dx = npc.x - this.x;
      const dz = npc.z - this.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= bestDist) continue;
      bestDist = distance;
      bestHeading = Math.atan2(dx, dz);
    }
    this.idleHeading =
      bestHeading ?? wrapAngle(this.heading + this.rng.range(-0.9, 0.9));
  }

  private arrivalLine(place: Destination): string {
    if (place.lines.length && this.rng.next() < 0.7) {
      return this.rng.pick(place.lines);
    }
    switch (place.activity) {
      case "trading":
        return this.rng.pick([
          `Market day energy at ${place.name}. Let's see the stalls.`,
          "Anyone buying a song with their bread?",
          this.rng.pick(TRADE_LINES),
        ]);
      case "talking":
        return this.rng.pick([
          `Hail, ${place.name}. Got a minute for a traveller?`,
          this.rng.pick(TALK_LINES),
        ]);
      case "resting":
        return this.rng.pick([
          "Fire looks honest. Mind if I warm the strings?",
          this.rng.pick(STORY_LINES),
        ]);
      case "performing":
        return this.rng.pick(SONG_INTRO_LINES);
      case "discovering":
      case "wondering":
        return this.rng.pick([
          `${place.name}. Didn't expect this turn.`,
          this.rng.pick(ARRIVAL_LINES),
        ]);
      default:
        return place.lines.length
          ? this.rng.pick(place.lines)
          : this.rng.pick(ARRIVAL_LINES);
    }
  }

  private dwell(dt: number): void {
    const place = this.state.stop;
    if (!place) return;

    this.pace += (0 - this.pace) * Math.min(1, dt / ACCELERATION);
    this.state.speed = this.pace;

    // Idle drift, so he is not a statue while he stands there.
    const error = wrapAngle(this.idleHeading - this.heading);
    this.heading = wrapAngle(
      this.heading + Math.min(Math.abs(error), TURN_RATE * 0.25 * dt) * Math.sign(error)
    );

    if (this.discoverRemaining > 0) {
      this.discoverRemaining -= dt;
      if (this.discoverRemaining <= 0) this.setActivity(place.activity);
    }

    this.state.dwellRemaining -= dt;
    if (this.state.dwellRemaining > 0) return;

    this.state.dwellRemaining = 0;
    this.state.stop = null;
    this.callbacks.onDepart?.(place);
    this.chooseDestination();
  }

  // --- Choosing where to go next -----------------------------------------

  /**
   * Interest, not itinerary — with enough memory and variety that he explores
   * the valley instead of commuting the same green.
   *
   * Hard rule: recent places are excluded. Soft rules: prefer unvisited ground,
   * new regions and activities, medium-distance legs, and sometimes the next
   * stop on the authored tour.
   */
  private chooseDestination(): void {
    this.playerDirected = false;
    this.timeoutRetries = 0;
    const current = this.state.destination ?? this.state.stop;
    const excluded = new Set(this.recent);

    let candidates = PLACES.filter(
      (place) => place.id !== current?.id && !excluded.has(place.id)
    );
    if (!candidates.length) {
      candidates = PLACES.filter((place) => place.id !== current?.id);
    }
    if (!candidates.length) candidates = [...PLACES];
    if (!candidates.length) {
      this.state.destination = null;
      return;
    }

    let chosen: Destination | null = null;
    if (this.rng.next() < TOUR_FOLLOW_CHANCE) {
      chosen = this.nextTourCandidate(excluded, current?.id ?? null);
    }

    if (!chosen) {
      let total = 0;
      const weights = candidates.map((place) => {
        const distance = Math.hypot(place.x - this.x, place.z - this.z);
        let weight = 1;
        if (!this.visited.has(place.id)) weight *= 3.1;
        if (place.loreId && !this.lore.has(place.loreId)) weight *= 1.7;
        if (place.questId && !this.quests.has(place.questId)) weight *= 1.55;
        if (place.activity !== current?.activity) weight *= 1.35;
        if (place.regionId && place.regionId !== this.state.region.id) {
          weight *= 1.45;
        }
        // Mild market interest — not enough to pin him to Wanderer's Green.
        if (place.activity === "trading") weight *= 1.25;
        else if (place.waresTag) weight *= 1.1;
        // Discourage the stall next door; prefer a real walk.
        if (distance < 40) weight *= 0.28;
        else if (distance < 80) weight *= 0.7;
        // Soft distance falloff — far corners stay reachable over an afternoon.
        weight *= 240 / (240 + distance);
        total += weight;
        return weight;
      });

      let roll = this.rng.next() * total;
      chosen = candidates[candidates.length - 1];
      for (let i = 0; i < candidates.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          chosen = candidates[i];
        break;
        }
      }
    }

    this.departFor(chosen);
  }

  /**
   * Send him somewhere specific, by destination id.
   *
   * This is what the world map calls when a visitor picks a place. It goes
   * through exactly the same commit path the autonomous chooser uses — same
   * clearance search, same road routing, same activity change — so a place
   * reached by clicking behaves identically to one he wandered to himself.
   * Returns false for an unknown id rather than silently doing nothing.
   */
  travelTo(destinationId: string): boolean {
    const place = PLACES.find((candidate) => candidate.id === destinationId);
    if (!place) return false;

    // Clear the recent-visit memory of this place, or the wander logic will
    // treat a destination the visitor deliberately chose as one to avoid.
    this.recent = this.recent.filter((id) => id !== destinationId);
    this.playerDirected = true;
    this.timeoutRetries = 0;
    this.departFor(place);
    return true;
  }

  /**
   * Send him to bare ground the visitor clicked on the chart.
   *
   * Replaces any in-progress walk (redirect). Snaps onto the nearest standable
   * footing if the click landed in a wall, trunk, or pond.
   */
  travelToPoint(x: number, z: number): boolean {
    const half = WORLD_SIZE / 2 - 4;
    const clampedX = Math.max(-half, Math.min(half, x));
    const clampedZ = Math.max(-half, Math.min(half, z));
    const goal = standableNear(clampedX, clampedZ, BARD_RADIUS);
    if (!goal) return false;

    const region = regionAt(goal.x, goal.z);
    const place: Destination = {
      id: `point-${Math.round(goal.x)}-${Math.round(goal.z)}`,
      name: `a quiet patch of ${region.name}`,
      x: goal.x,
      z: goal.z,
      activity: "wondering",
      dwell: 18,
      lines: [
        "This will do for a while.",
        "Good ground. I'll take a breath here.",
        `Quiet stretch of ${region.name}.`,
      ],
    };

    this.playerDirected = true;
    this.timeoutRetries = 0;
    this.departFor(place);
    return true;
  }

  /** Commits to a destination: find a standable goal, route to it, and go. */
  private departFor(chosen: Destination): void {
    this.state.destination = chosen;
    // Somewhere he can actually stand. Destinations are authored at the thing
    // they describe — the well, the stall, the shrine — and the thing they
    // describe usually has a collider on it.
    this.goal =
      standableNear(chosen.x, chosen.z, BARD_RADIUS) ??
      nearestClearPoint(chosen.x, chosen.z, BARD_RADIUS);
    // Prefer plaza / roadside offset if the landmark itself is solid.
    if (isBlocked(this.goal.x, this.goal.z, BARD_RADIUS * 1.2)) {
      this.goal =
        standableNear(chosen.x, chosen.z, BARD_RADIUS * 1.35) ??
        nearestClearPoint(chosen.x, chosen.z, BARD_RADIUS * 1.35);
    }
    this.route = this.planRoute(this.goal);
    this.routeIndex = 0;

    this.travelTime = 0;
    this.stallTime = 0;
    this.detours = 0;
    this.pauseRemaining = 0;
    this.setActivity("travelling");
  }

  /** Next place along the authored TOUR that isn't recent / current. */
  private nextTourCandidate(
    excluded: Set<string>,
    currentId: string | null
  ): Destination | null {
    let start = currentId
      ? PLACES.findIndex((place) => place.id === currentId)
      : -1;
    if (start < 0) {
      // Nearest place on the tour to where he stands.
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < PLACES.length; i++) {
        const distance = Math.hypot(PLACES[i].x - this.x, PLACES[i].z - this.z);
        if (distance < bestDist) {
          bestDist = distance;
          best = i;
        }
      }
      start = best;
    }

    for (let step = 1; step <= PLACES.length; step++) {
      const place = PLACES[(start + step) % PLACES.length];
      if (place.id === currentId || excluded.has(place.id)) continue;
      return place;
    }
    return null;
  }

  private remember(id: string): void {
    this.recent.push(id);
    while (this.recent.length > RECENT_MEMORY) this.recent.shift();
  }

  // --- Routing -----------------------------------------------------------

  /**
   * Obstacle-aware route: grid A* around buildings, rocks, trunks, and water,
   * with a soft preference for graded road. Falls back to the authored road
   * graph when A* cannot finish, then to a direct last leg.
   */
  private planRoute(goal: Waypoint): Waypoint[] {
    const clear = findClearPath(this.x, this.z, goal.x, goal.z, BARD_RADIUS);
    if (clear && clear.length) {
      return this.trimRouteHead(clear);
    }

    const direct = Math.hypot(goal.x - this.x, goal.z - this.z);
    const route: Waypoint[] = [];

    // Player-directed trips always try the network; wanderers still roll for whim.
    const preferRoad =
      this.playerDirected || this.rng.next() < ROAD_PREFER_CHANCE;
    const minTrip = preferRoad ? ROAD_MIN_TRIP_PREFERRED : ROAD_MIN_TRIP;
    const detourLimit = preferRoad ? ROAD_DETOUR_PREFERRED : ROAD_DETOUR_LIMIT;

    if (direct > minTrip) {
      const graph = roadGraph();
      const entry = nearestNode(graph, this.x, this.z);
      const exit = nearestNode(graph, goal.x, goal.z);

      if (entry >= 0 && exit >= 0 && entry !== exit) {
        const nodes = findRoute(graph, entry, exit);
        if (nodes) {
          let length =
            Math.hypot(graph.x[entry] - this.x, graph.z[entry] - this.z) +
            Math.hypot(goal.x - graph.x[exit], goal.z - graph.z[exit]);
          for (let i = 1; i < nodes.length; i++) {
            length += Math.hypot(
              graph.x[nodes[i]] - graph.x[nodes[i - 1]],
              graph.z[nodes[i]] - graph.z[nodes[i - 1]]
            );
          }
          if (length < direct * detourLimit) {
            // Road nodes sit on the centreline. If a rock still overlaps one,
            // nudge onto clear ground beside the path, then A*-stitch any leg
            // that still cuts through a solid.
            const roadWaypoints: Waypoint[] = [];
            for (const node of nodes) {
              roadWaypoints.push(
                this.clearBesideRoad(graph.x[node], graph.z[node])
              );
            }
            let prev: Waypoint = { x: this.x, z: this.z };
            for (const next of roadWaypoints) {
              if (this.segmentBlocked(prev.x, prev.z, next.x, next.z)) {
                const detour = findClearPath(
                  prev.x,
                  prev.z,
                  next.x,
                  next.z,
                  BARD_RADIUS
                );
                if (detour && detour.length) {
                  for (const point of detour) route.push(point);
                  prev = route[route.length - 1] ?? next;
                  continue;
                }
              }
              route.push(next);
              prev = next;
            }
          }
        }
      }
    }

    route.push({ x: goal.x, z: goal.z });
    return this.trimRouteHead(route);
  }

  /**
   * Keep a road-graph sample walkable. Prefers the nearest clear point that is
   * still near the graded surface so a rock on the crown becomes a shoulder
   * detour rather than a cross-country hop.
   */
  private clearBesideRoad(x: number, z: number): Waypoint {
    if (!isBlocked(x, z, BARD_RADIUS)) return { x, z };
    const clear = nearestClearPoint(x, z, BARD_RADIUS);
    if (distanceToRoad(clear.x, clear.z) <= ROAD_HALF_WIDTH + 5) {
      return { x: clear.x, z: clear.z };
    }
    // Fall back to a lateral shoulder probe from the blocked node.
    for (const side of [1, -1]) {
      for (const reach of [2.4, 3.6, 5.0]) {
        for (const [px, pz] of [
          [x + side * reach, z],
          [x, z + side * reach],
          [x + side * reach * 0.7, z + side * reach * 0.7],
          [x + side * reach * 0.7, z - side * reach * 0.7],
        ] as const) {
          if (isBlocked(px, pz, BARD_RADIUS)) continue;
          if (distanceToRoad(px, pz) > ROAD_HALF_WIDTH + 5) continue;
          return { x: px, z: pz };
        }
      }
    }
    return { x: clear.x, z: clear.z };
  }

  /** True when the straight segment between two points hits a solid. */
  private segmentBlocked(
    ax: number,
    az: number,
    bx: number,
    bz: number
  ): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return isBlocked(ax, az, BARD_RADIUS);
    const steps = Math.max(2, Math.ceil(dist / 1.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isBlocked(ax + dx * t, az + dz * t, BARD_RADIUS)) return true;
    }
    return false;
  }

  /**
   * Trim the head of the route back to the first waypoint that is genuinely
   * ahead. The nearest node to a standing start is as often the one he just
   * walked past as the one he wants, and opening a four-hundred-metre journey
   * by turning round and walking eight metres backwards looks like a fault.
   */
  private trimRouteHead(route: Waypoint[]): Waypoint[] {
    const trimmed = route.slice();
    while (trimmed.length > 1) {
      const first = Math.hypot(trimmed[0].x - this.x, trimmed[0].z - this.z);
      if (first > WAYPOINT_RADIUS) {
        const second = Math.hypot(
          trimmed[1].x - this.x,
          trimmed[1].z - this.z
        );
        if (second > first) break;
      }
      trimmed.shift();
    }
    return trimmed;
  }

  // --- Reacting ----------------------------------------------------------

  private trackRegion(dt: number): void {
    const here = regionAt(this.x, this.z);
    if (here.id === this.state.region.id) {
      this.pendingRegion = null;
      return;
    }
    if (this.pendingRegion?.id !== here.id) {
      this.pendingRegion = here;
      this.pendingRegionTime = 0;
      return;
    }

    this.pendingRegionTime += dt;
    if (this.pendingRegionTime < REGION_HYSTERESIS) return;

    const previous = this.state.region;
    this.state.region = here;
    this.pendingRegion = null;
    this.callbacks.onRegionChange?.(here, previous);
    this.say(
      this.rng.pick(REGION_LINES).replace("{name}", here.name),
      this.state.activity
    );
    // He has just spoken; don't let the idle chatter tread on it.
    this.chatterTimer = this.rng.range(20, 40);
  }

  private chatter(dt: number): void {
    this.chatterTimer -= dt;
    if (this.chatterTimer > 0) return;

    if (this.state.stop) {
      this.chatterTimer = this.rng.range(10, 18);
      this.say(this.dwellLine(this.state.stop), this.state.activity);
      // Drift attention toward whoever he is with between lines.
      if (this.rng.next() < 0.55) this.faceCompany();
      return;
    }

    this.chatterTimer = this.rng.range(26, 60);
    // Silent while pivoting on the spot — a line delivered mid-turn reads as him
    // talking to a hedge.
    if (this.state.speed < 0.05) return;
    this.say(this.rng.pick(TRAVEL_LINES), "travelling");
  }

  private dwellLine(place: Destination): string {
    const authored = place.lines;
    switch (this.state.activity) {
      case "trading":
        return this.rng.pick(
          authored.length && this.rng.next() < 0.35
            ? [...TRADE_LINES, ...authored]
            : TRADE_LINES
        );
      case "talking":
        return this.rng.pick(
          authored.length ? [...TALK_LINES, ...authored] : TALK_LINES
        );
      case "resting":
        return this.rng.pick(
          authored.length ? [...STORY_LINES, ...authored] : STORY_LINES
        );
      case "performing":
        return this.rng.pick([...SONG_INTRO_LINES, ...STORY_LINES]);
      case "discovering":
        return authored.length
          ? this.rng.pick(authored)
          : this.rng.pick(STORY_LINES);
      default:
        return authored.length
          ? this.rng.pick(authored)
          : this.rng.pick(TALK_LINES);
    }
  }

  private say(line: string, activity: Activity): void {
    this.callbacks.onSay?.(line, activity);
  }

  private setActivity(next: Activity): void {
    if (next === this.state.activity) return;
    const previous = this.state.activity;
    this.state.activity = next;
    this.callbacks.onActivityChange?.(next, previous);
  }
}

// ---------------------------------------------------------------------------

/** Shortest signed angle, so a turn never takes the long way round. */
function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

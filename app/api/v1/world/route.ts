/**
 * GET /api/v1/world — the map Punaab is walking around, and where he is on it.
 *
 * Auth is the standard v1 key: `X-Api-Key: <key>` or `Authorization: Bearer
 * <key>`, resolved to a project. Same 401 shapes as `/api/v1/merchant`.
 *
 * Two things a game does with this:
 *
 *   MIRROR THE VALLEY — regions, settlements, water, roads and destinations are
 *   all plain coordinates in a 640-metre square centred on the origin, north at
 *   -Z. Enough to rebuild the place in another engine, or to draw a map screen
 *   that agrees with the one on the website.
 *
 *   ASK WHERE HE IS — `bard` is his position right now. His round is
 *   deterministic and anchored to the Unix epoch, so this answer needs no
 *   session and no running simulation: every client that asks at the same
 *   second gets the same place, the same activity and the same line. Pass
 *   `?t=<unix seconds>` to ask about another moment, past or future.
 *
 * The world itself is not overridable from the database — it is geometry, and
 * it only means anything against this terrain. What he *carries* is: `wares`
 * below is the resolved catalogue, your `items` rows merged over the defaults,
 * so a destination's `waresTag` resolves against your economy and not ours.
 * Lore and quests have their own routes.
 *
 * Query parameters:
 *   ?t=1753600000     ask about a particular second instead of now
 *   ?speed=1.2        his pace in m/s, if your world clock is not real time
 *   ?roads=1          include the road network as sampled polylines
 *   ?structures=1     include every placed structure (large)
 */

import { NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/api-keys";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  DESTINATIONS,
  TOUR_LENGTH_METRES,
  TRAVEL_SPEED,
  arrivalLine,
  itineraryAt,
  tourSeconds,
} from "@/lib/bard/destinations";
import { resolveWares, waresFor } from "@/lib/bard/wares";
import { REGIONS, regionAt } from "@/lib/world/regions";
import { SETTLEMENTS, STRUCTURES } from "@/lib/world/settlements";
import {
  ROADS,
  ROAD_HALF_WIDTH,
  WATERS,
  WATER_LEVEL,
  WORLD_SIZE,
  heightAt,
  roadHeight,
} from "@/lib/world/terrain";

/** Points per road when the caller asks for the network. */
const ROAD_SAMPLES = 64;

function getKey(req: Request) {
  return (
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  );
}

function numberParam(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  const raw = getKey(req);
  if (!supabase || !raw) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }
  const authz = await resolveApiKey(supabase, raw);
  if (!authz) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

  const { data: items } = await supabase
    .from("items")
    .select("id, name, description, price, category, icon_url")
    .eq("project_id", authz.projectId)
    .order("name");

  const params = new URL(req.url).searchParams;
  const wares = resolveWares(items);
  const speed = Math.max(0.01, numberParam(params.get("speed"), TRAVEL_SPEED));

  // Anchored to the epoch rather than to a server start time, so two machines
  // that never speak to each other still agree about where he is.
  const now = numberParam(params.get("t"), Date.now() / 1000);
  const cycle = tourSeconds(speed);
  const lap = Math.floor(now / cycle);
  const fix = itineraryAt(now, speed);

  const destinations = DESTINATIONS.map((destination) => ({
    ...destination,
    y: heightAt(destination.x, destination.z),
    regionId: regionAt(destination.x, destination.z).id,
    /** Ids only — look them up in `wares` to get your own catalogue's rows. */
    wares: waresFor(destination.waresTag, wares).map((ware) => ware.id),
  }));

  const body: Record<string, unknown> = {
    world: {
      size: WORLD_SIZE,
      waterLevel: WATER_LEVEL,
      roadHalfWidth: ROAD_HALF_WIDTH,
      north: "-Z",
      waters: WATERS,
    },
    regions: REGIONS,
    settlements: SETTLEMENTS,
    destinations,
    wares,
    tour: {
      stops: DESTINATIONS.length,
      lengthMetres: Math.round(TOUR_LENGTH_METRES),
      seconds: Math.round(cycle),
      speed,
    },
    bard: {
      at: Math.round(now),
      lap,
      phase: fix.phase,
      progress: Number(fix.progress.toFixed(4)),
      x: Number(fix.x.toFixed(2)),
      y: Number(heightAt(fix.x, fix.z).toFixed(2)),
      z: Number(fix.z.toFixed(2)),
      regionId: regionAt(fix.x, fix.z).id,
      // While walking he is between two places; the activity of the leg is
      // travelling, and `destination` is the one he has just left.
      activity: fix.phase === "travelling" ? "travelling" : fix.destination.activity,
      destinationId: fix.destination.id,
      destinationName: fix.destination.name,
      nextId: fix.next.id,
      nextName: fix.next.name,
      settlementId: fix.destination.settlementId ?? null,
      songId: fix.destination.songId ?? null,
      loreId: fix.destination.loreId ?? null,
      questId: fix.destination.questId ?? null,
      waresTag: fix.destination.waresTag ?? null,
      line: fix.phase === "dwelling" ? arrivalLine(fix.destination, lap) : null,
    },
  };

  if (params.get("roads")) {
    body.roads = ROADS.map((road, index) => ({
      index,
      closed: road.closed,
      length: Math.round(road.getLength()),
      points: road.getSpacedPoints(ROAD_SAMPLES).map((point) => ({
        x: Number(point.x.toFixed(2)),
        y: Number(roadHeight(point.x, point.z).toFixed(2)),
        z: Number(point.z.toFixed(2)),
      })),
    }));
  }

  if (params.get("structures")) {
    body.structures = STRUCTURES;
  }

  return NextResponse.json(body);
}

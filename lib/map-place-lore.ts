import type { SupabaseClient } from "@supabase/supabase-js";
import { DESTINATIONS } from "@/lib/bard/destinations";
import { loreById } from "@/lib/bard/lore";
import { ensureLoreHub } from "@/lib/lore-hub";
import { MAP_PLACES, locationKeyFor, type MapPlace } from "@/lib/world/cartography";

const KIND_LABEL: Record<MapPlace["kind"], string> = {
  town: "Town",
  village: "Village",
  hamlet: "Hamlet",
  port: "Port",
  holy: "Priory",
  industry: "Delve",
  camp: "Camp",
  ruin: "Ruin",
  landmark: "Landmark",
};

export function placeLoreSlug(mapPlaceId: string): string {
  return `place-${mapPlaceId}`;
}

function padBody(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 12) return trimmed.slice(0, 8000);
  return `${trimmed} ${fallback}`.trim().slice(0, 8000);
}

/** Build accepted World place rows from the live PIXELGREW chart. */
export function mapPlaceLoreSeeds() {
  const byId = new Map(DESTINATIONS.map((d) => [d.id, d]));

  return MAP_PLACES.map((place) => {
    const dest = byId.get(place.id);
    const lore = dest?.loreId ? loreById(dest.loreId) : null;
    const kind = KIND_LABEL[place.kind];
    const summary =
      (place.blurb || lore?.title || `${kind} on the PIXELGREW chart.`).slice(
        0,
        240
      );
    const bodyParts = [
      place.blurb,
      lore?.body,
      dest?.lines?.[0],
      dest?.lines?.[1],
    ].filter((part): part is string => Boolean(part && part.trim()));

    const body = padBody(
      bodyParts.join("\n\n"),
      `${place.name} is marked on the PIXELGREW chart as a ${kind.toLowerCase()}.`
    );

    return {
      slug: placeLoreSlug(place.id),
      title: place.name.slice(0, 120),
      summary,
      body,
      location_key: locationKeyFor(place.x, place.z),
      tags: ["map", place.kind, "pixelgrew"],
      meta: {
        mapPlaceId: place.id,
        kind: place.kind,
        x: place.x,
        z: place.z,
        source: "map_places",
      },
    };
  });
}

/**
 * Upsert chart places into `community_lore` (category places, accepted).
 * Safe to call on every places list — only inserts missing slugs.
 */
export async function ensureMapPlaceLore(
  supabase: SupabaseClient
): Promise<number> {
  const seeds = mapPlaceLoreSeeds();
  if (!seeds.length) return 0;

  const hub = await ensureLoreHub(supabase);

  let profileId: string | null = null;
  const system = await supabase
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", "system:punaab-hub")
    .maybeSingle();
  profileId = system.data?.id ?? null;
  if (!profileId) return 0;

  const { data: existing } = await supabase
    .from("community_lore")
    .select("slug")
    .like("slug", "place-%");

  const have = new Set(
    (existing || []).map((row) => String(row.slug || "")).filter(Boolean)
  );
  const missing = seeds.filter((seed) => !have.has(seed.slug));
  if (!missing.length) return 0;

  const rows = missing.map((seed) => ({
    author_id: profileId,
    category: "places",
    title: seed.title,
    body: seed.body,
    summary: seed.summary,
    slug: seed.slug,
    location_key: seed.location_key,
    tags: seed.tags,
    meta: seed.meta,
    is_hub: false,
    status: "accepted",
    reviewed_at: new Date().toISOString(),
  }));

  // Insert in batches so PostgREST payloads stay modest.
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    const { data, error } = await supabase
      .from("community_lore")
      .upsert(batch, { onConflict: "slug", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("ensureMapPlaceLore", error.message);
      break;
    }
    inserted += data?.length ?? 0;
  }

  if (hub?.id && inserted > 0) {
    const { data: placeRows } = await supabase
      .from("community_lore")
      .select("id")
      .eq("category", "places")
      .like("slug", "place-%")
      .eq("status", "accepted");

    const links = (placeRows || []).map((row) => ({
      from_id: hub.id,
      to_id: row.id,
      kind: "mentions",
      note: "Chart place",
    }));

    for (let i = 0; i < links.length; i += 40) {
      await supabase
        .from("community_lore_links")
        .upsert(links.slice(i, i + 40), {
          onConflict: "from_id,to_id,kind",
          ignoreDuplicates: true,
        });
    }
  }

  return inserted;
}

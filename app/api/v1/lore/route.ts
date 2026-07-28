/**
 * GET /api/v1/lore — everything Punaab knows, with your version on top.
 *
 * Auth is the standard v1 key: `X-Api-Key: <key>` or `Authorization: Bearer
 * <key>`, resolved to a project. Same 401 shapes as `/api/v1/merchant`.
 *
 * The response is `DEFAULT_LORE` with the calling project's `lore_docs` rows
 * merged over it — matched by title, so a row titled "The Nine at Hollowmoor"
 * replaces that entry's body and keeps its place in the world. Rows that match
 * nothing are appended; give them a `location:` directive at the top of the
 * body to pin them to a destination. See `lib/bard/lore.ts` for the full
 * override contract.
 *
 * Query parameters:
 *   ?location=hollowmoor-stones  what this place unlocks (plus placeless entries)
 *   ?region=hollowmoor           everything from one part of the map
 *   ?id=the-nine-at-hollowmoor   one entry
 *   ?defaults=off                your rows only — no valley, no bard's history
 */

import { NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/api-keys";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { loreFor, resolveLore, type LoreEntry } from "@/lib/bard/lore";

function getKey(req: Request) {
  return (
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  );
}

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  const raw = getKey(req);
  if (!supabase || !raw) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }
  const authz = await resolveApiKey(supabase, raw);
  if (!authz) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

  const { data } = await supabase
    .from("lore_docs")
    .select("id, title, body")
    .eq("project_id", authz.projectId)
    .order("title");

  const params = new URL(req.url).searchParams;
  const mode = params.get("defaults") === "off" ? "replace" : "merge";

  let lore: LoreEntry[] = resolveLore(data, { mode });

  const location = params.get("location");
  if (location) lore = loreFor(location, lore);

  const region = params.get("region");
  if (region) lore = lore.filter((entry) => entry.regionId === region);

  const id = params.get("id");
  if (id) lore = lore.filter((entry) => entry.id === id);

  return NextResponse.json({
    lore,
    // Mirrored under `data` for the SDK's generic list handling, exactly as
    // /api/v1/merchant does it.
    data: lore,
    count: lore.length,
    defaults: mode === "replace" ? "off" : "merged",
  });
}

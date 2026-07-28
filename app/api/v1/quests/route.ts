/**
 * GET /api/v1/quests — the errands he offers, with your version on top.
 *
 * Auth is the standard v1 key: `X-Api-Key: <key>` or `Authorization: Bearer
 * <key>`, resolved to a project. Same 401 shapes as `/api/v1/merchant`.
 *
 * The response is `DEFAULT_QUESTS` with the calling project's `quests` rows
 * merged over it, matched by title. The `quests` table is three columns, so
 * anything a quest needs beyond a title and a body — giver, steps, reward —
 * is declared in directive lines at the top of the body. See
 * `lib/bard/quests.ts` for the full override contract.
 *
 * Query parameters:
 *   ?giver=fen-causeway     what he offers at one destination
 *   ?region=thornwake       everything from one part of the map
 *   ?id=forty-one-posts     one quest
 *   ?defaults=off           your rows only
 */

import { NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/api-keys";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { questsFor, resolveQuests, type Quest } from "@/lib/bard/quests";

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
    .from("quests")
    .select("id, title, body")
    .eq("project_id", authz.projectId)
    .order("title");

  const params = new URL(req.url).searchParams;
  const mode = params.get("defaults") === "off" ? "replace" : "merge";

  let quests: Quest[] = resolveQuests(data, { mode });

  const giver = params.get("giver");
  if (giver) quests = questsFor(giver, quests);

  const region = params.get("region");
  if (region) quests = quests.filter((quest) => quest.regionId === region);

  const id = params.get("id");
  if (id) quests = quests.filter((quest) => quest.id === id);

  return NextResponse.json({
    quests,
    // Mirrored under `data` for the SDK's generic list handling, exactly as
    // /api/v1/merchant does it.
    data: quests,
    count: quests.length,
    defaults: mode === "replace" ? "off" : "merged",
  });
}

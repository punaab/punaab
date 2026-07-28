import { NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/api-keys";
import { getSupabaseAdmin } from "@/lib/supabase/server";

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
  if (!authz) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const { data: config } = await supabase
    .from("character_configs")
    .select("*, appearances(id, name, blurb)")
    .eq("project_id", authz.projectId)
    .maybeSingle();

  const { data: items } = await supabase
    .from("items")
    .select("id, name, description, price, category, icon_url")
    .eq("project_id", authz.projectId)
    .limit(50);

  const { data: behaviors } = await supabase
    .from("behaviors")
    .select("id, label, description")
    .order("id");

  const character = config || {
    display_name: "Punaab",
    appearance_id: "classic",
    brain: { personality: "traveling bard" },
    loadout: {},
  };
  const appearance =
    (config as { appearances?: { id: string; name: string; blurb: string | null } | null } | null)
      ?.appearances || {
      id: (character as { appearance_id?: string }).appearance_id || "classic",
      name: "Classic Bard",
      blurb: "The traveling storyteller.",
    };

  return NextResponse.json({
    project_id: authz.projectId,
    project_name: authz.projectName,
    mode: authz.mode,
    min_plugin_version: "0.1.0",
    character,
    appearance,
    merchant_items: items || [],
    behaviors: behaviors || [],
  });
}

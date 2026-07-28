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
  if (!authz) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

  const { data } = await supabase
    .from("items")
    .select("id, name, description, price, category, icon_url")
    .eq("project_id", authz.projectId)
    .order("name");

  const items = data || [];
  return NextResponse.json({ items, data: items });
}

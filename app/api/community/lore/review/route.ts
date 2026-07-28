import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isLoreAdmin } from "@/lib/lore-admin";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const SELECT =
  "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, image_url, status, profiles!community_lore_author_id_fkey(display_name)";

export async function GET() {
  const { userId } = await auth();
  if (!userId || !isLoreAdmin(userId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("community_lore")
    .select(SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lore = ((data || []) as LoreDbRow[]).map((row) => mapLoreRow(row));
  return NextResponse.json({ lore });
}

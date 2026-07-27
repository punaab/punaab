import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { SEED_ITEMS } from "@/lib/seed-data";

export async function GET() {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ data: SEED_ITEMS, source: "seed" });
  }

  const { data, error } = await supabase
    .from("item_definitions")
    .select("definition_id, name, description, rarity, tags, canon_level")
    .order("name");

  if (error) {
    return NextResponse.json({ data: SEED_ITEMS, source: "seed", warning: error.message });
  }

  return NextResponse.json({ data, source: "supabase" });
}

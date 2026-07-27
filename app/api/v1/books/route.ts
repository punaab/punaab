import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { SEED_BOOKS } from "@/lib/seed-data";

export async function GET() {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ data: SEED_BOOKS, source: "seed" });
  }

  const { data, error } = await supabase
    .from("books")
    .select("id, title, summary, status, created_at")
    .in("status", ["community", "realm_canon", "universal_canon", "historical_record"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ data: SEED_BOOKS, source: "seed", warning: error.message });
  }

  return NextResponse.json({ data, source: "supabase" });
}

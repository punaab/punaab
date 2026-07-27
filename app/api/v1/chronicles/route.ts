import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { SEED_CHRONICLES } from "@/lib/seed-data";

export async function GET() {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ data: SEED_CHRONICLES, source: "seed" });
  }

  const { data, error } = await supabase
    .from("chronicles")
    .select("*")
    .order("occurred_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({
      data: SEED_CHRONICLES,
      source: "seed",
      warning: error.message,
    });
  }
  return NextResponse.json({ data, source: "supabase" });
}

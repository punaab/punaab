import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { SEED_REALMS } from "@/lib/seed-data";

export async function GET() {
  const supabase = getSupabaseServer();
  if (!supabase) {
    return NextResponse.json({ data: SEED_REALMS, source: "seed" });
  }

  const { data, error } = await supabase.from("realms").select("*").order("name");
  if (error) {
    return NextResponse.json({ data: SEED_REALMS, source: "seed", warning: error.message });
  }
  return NextResponse.json({ data, source: "supabase" });
}

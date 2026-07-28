import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      data: [
        { id: "idle", label: "Idle" },
        { id: "talk", label: "Talk" },
        { id: "sing", label: "Sing" },
        { id: "open_shop", label: "Open Shop" },
      ],
      source: "seed",
    });
  }
  const { data } = await supabase.from("behaviors").select("*").order("id");
  return NextResponse.json({ data: data || [], source: "supabase" });
}

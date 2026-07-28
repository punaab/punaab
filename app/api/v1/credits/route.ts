import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ensureProfile } from "@/lib/profiles";
import { getCreditBalance } from "@/lib/credits";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ balance: 500, ledger: [] });
  }
  const balance = await getCreditBalance(supabase, profile.id);
  const { data: ledger } = await supabase
    .from("credit_ledger")
    .select("*")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return NextResponse.json({ balance, ledger: ledger || [] });
}

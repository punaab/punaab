import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isLoreAdmin } from "@/lib/lore-admin";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { userId } = await auth();
  if (!userId || !isLoreAdmin(userId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const { profile } = await ensureProfile(userId);
  if (profile.id === "local") {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    note?: string;
  } | null;

  const action = body?.action;
  if (action !== "accept" && action !== "deny") {
    return NextResponse.json(
      { error: "action must be accept or deny." },
      { status: 400 }
    );
  }

  const status = action === "accept" ? "accepted" : "denied";
  const note = (body?.note || "").trim().slice(0, 500) || null;

  const { data, error } = await supabase
    .from("community_lore")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: profile.id,
      review_note: note,
    })
    .eq("id", id)
    .eq("status", "pending")
    .eq("is_hub", false)
    .select("id, status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Pending submission not found." },
      { status: 404 }
    );
  }

  return NextResponse.json({ id: data.id, status: data.status });
}

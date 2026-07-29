import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/profiles";

const saveSchema = z.object({
  display_name: z.string().trim().min(2).max(48),
  title: z.string().trim().min(2).max(48).default("Traveler"),
  motto: z.string().trim().max(160).default(""),
  instrument: z.string().trim().min(1).max(40).default("lute"),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ character: null });
  }

  const { data } = await supabase
    .from("player_characters")
    .select("*")
    .eq("profile_id", profile.id)
    .maybeSingle();

  return NextResponse.json({ character: data });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid character." },
      { status: 400 }
    );
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const displayName = parsed.data.display_name.trim();

  // Names must be unique across camp (case-insensitive), excluding your own.
  const { data: clash } = await supabase
    .from("player_characters")
    .select("profile_id")
    .ilike("display_name", displayName)
    .neq("profile_id", profile.id)
    .limit(1)
    .maybeSingle();

  if (clash) {
    return NextResponse.json(
      {
        error:
          "That traveler name is already taken. Choose another name for the road.",
      },
      { status: 409 }
    );
  }

  const payload = {
    profile_id: profile.id,
    display_name: displayName,
    title: parsed.data.title,
    motto: parsed.data.motto,
    instrument: parsed.data.instrument,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("player_characters")
    .upsert(payload, { onConflict: "profile_id" })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "That traveler name is already taken. Choose another name for the road.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ character: data });
}

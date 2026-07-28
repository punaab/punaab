import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/profiles";

const schema = z.object({
  project_id: z.string().uuid(),
  display_name: z.string().min(1).max(64).optional(),
  brain: z.record(z.string(), z.unknown()).optional(),
  loadout: z.record(z.string(), z.unknown()).optional(),
});

/** Punaab has one voice — never configurable per project. */
const PUNAAB_VOICE = "punaab";
/** Punaab has one look — never configurable per project. */
const PUNAAB_APPEARANCE = "classic";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = new URL(req.url).searchParams.get("project_id");
  if (!projectId) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({
      config: { display_name: "Punaab", appearance_id: PUNAAB_APPEARANCE },
    });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("owner_id", profile.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: config } = await supabase
    .from("character_configs")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle();

  return NextResponse.json({ config });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ ok: true, source: "local" });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", parsed.data.project_id)
    .eq("owner_id", profile.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch = {
    display_name: parsed.data.display_name,
    appearance_id: PUNAAB_APPEARANCE,
    brain: parsed.data.brain,
    loadout: parsed.data.loadout,
    voice: PUNAAB_VOICE,
    updated_at: new Date().toISOString(),
  };

  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  );

  const { data, error } = await supabase
    .from("character_configs")
    .upsert(
      { project_id: parsed.data.project_id, ...clean },
      { onConflict: "project_id" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, config: data });
}

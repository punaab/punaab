import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/profiles";
import { projectLimit } from "@/lib/plans";
import type { PlanCode } from "@/lib/plans";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ data: [], source: "local" });
  }
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, source: "supabase" });
}

const createSchema = z.object({
  name: z.string().min(2).max(80),
  mode: z.enum(["cloud", "hybrid", "local"]).default("cloud"),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({
      project: {
        id: "local-project",
        name: parsed.data.name,
        mode: parsed.data.mode,
      },
      source: "local",
    });
  }

  const limit = projectLimit(profile.plan_code as PlanCode);
  const { count } = await supabase
    .from("projects")
    .select("*", { count: "exact", head: true })
    .eq("owner_id", profile.id);
  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      { error: `Plan limit reached (${limit} projects). Upgrade on Billing.` },
      { status: 403 }
    );
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      owner_id: profile.id,
      name: parsed.data.name,
      mode: parsed.data.mode,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("character_configs").insert({
    project_id: project.id,
    appearance_id: "classic",
    display_name: "Punaab",
  });

  await supabase.from("items").insert([
    {
      project_id: project.id,
      name: "Traveler's Map",
      description: "A worn map of roads between worlds.",
      price: 5,
      category: "lore",
    },
    {
      project_id: project.id,
      name: "Song Scroll",
      description: "Sheet music for Roads Between Worlds.",
      price: 12,
      category: "music",
    },
  ]);

  return NextResponse.json({ project, source: "supabase" });
}

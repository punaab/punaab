import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/profiles";
import { generateApiKey } from "@/lib/api-keys";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ keys: [] });
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("owner_id", profile.id);
  const ids = (projects || []).map((p) => p.id);
  if (!ids.length) return NextResponse.json({ keys: [] });

  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, project_id, created_at, revoked_at, last_used_at")
    .in("project_id", ids)
    .order("created_at", { ascending: false });

  return NextResponse.json({ keys: keys || [] });
}

const createSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(64).default("Default"),
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
      raw: "pg_local_dev_key",
      key: { key_prefix: "pg_local", name: parsed.data.name },
      warning: "Local mode — connect Supabase for real keys.",
    });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", parsed.data.project_id)
    .eq("owner_id", profile.id)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { raw, prefix, hash } = generateApiKey();
  const { data: key, error } = await supabase
    .from("api_keys")
    .insert({
      project_id: project.id,
      name: parsed.data.name,
      key_prefix: prefix,
      key_hash: hash,
    })
    .select("id, name, key_prefix, project_id, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    raw,
    key,
    warning: "Copy this key now — it will not be shown again.",
  });
}

const revokeSchema = z.object({ key_id: z.string().uuid() });

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = revokeSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ ok: true });
  }

  const { data: key } = await supabase
    .from("api_keys")
    .select("id, project_id, projects!inner(owner_id)")
    .eq("id", parsed.data.key_id)
    .maybeSingle();

  const owner = Array.isArray(key?.projects)
    ? key?.projects[0]
    : key?.projects;
  if (!key || (owner as { owner_id?: string } | null)?.owner_id !== profile.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", key.id);

  return NextResponse.json({ ok: true });
}

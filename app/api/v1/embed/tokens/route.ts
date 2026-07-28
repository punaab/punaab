import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateEmbedToken,
  normalizeOrigin,
  type EmbedSurface,
} from "@/lib/embed/tokens";
import { capabilitiesFor } from "@/lib/plans";
import { ensureProfile } from "@/lib/profiles";

/**
 * Dashboard-side management of embed tokens. Clerk-authenticated; the public
 * embed surfaces live under `/api/v1/embed/chat` and `/config`.
 */

async function ownedProjectIds(
  supabase: NonNullable<Awaited<ReturnType<typeof ensureProfile>>["supabase"]>,
  profileId: string
) {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("owner_id", profileId);
  return (data || []).map((row) => row.id as string);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ tokens: [], bridges: [], capabilities: capabilitiesFor(profile.plan_code) });
  }

  const ids = await ownedProjectIds(supabase, profile.id);
  if (!ids.length) {
    return NextResponse.json({
      tokens: [],
      bridges: [],
      capabilities: capabilitiesFor(profile.plan_code),
    });
  }

  const [{ data: tokens }, { data: bridges }] = await Promise.all([
    supabase
      .from("embed_tokens")
      .select(
        "id, project_id, name, token, allowed_origins, surface, daily_credit_cap, enabled, created_at, last_used_at"
      )
      .in("project_id", ids)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("chat_bridges")
      .select(
        "id, project_id, platform, channel, respond_mode, trigger_prefix, cooldown_seconds, enabled"
      )
      .in("project_id", ids),
  ]);

  return NextResponse.json({
    tokens: tokens || [],
    bridges: bridges || [],
    capabilities: capabilitiesFor(profile.plan_code),
  });
}

const createSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(64).default("Website"),
  surface: z.enum(["web", "obs"]).default("web"),
  allowed_origins: z.array(z.string().max(255)).max(20).default([]),
  daily_credit_cap: z.number().int().min(1).max(1_000_000).default(2000),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json(
      { error: "Connect Supabase to create embed tokens." },
      { status: 503 }
    );
  }

  const capabilities = capabilitiesFor(profile.plan_code);
  const surface = parsed.data.surface as EmbedSurface;
  const permitted =
    surface === "obs" ? capabilities.obsOverlay : capabilities.websiteEmbed;
  if (!permitted) {
    return NextResponse.json(
      {
        error: "Embedding Punaab requires a Creator plan or above.",
        code: "PLAN_REQUIRED",
      },
      { status: 402 }
    );
  }

  // The project must actually belong to the caller — otherwise anyone with an
  // account could mint a token against someone else's character and spend
  // their credits.
  const ids = await ownedProjectIds(supabase, profile.id);
  if (!ids.includes(parsed.data.project_id)) {
    return NextResponse.json({ error: "Unknown project" }, { status: 404 });
  }

  const { count } = await supabase
    .from("embed_tokens")
    .select("id", { count: "exact", head: true })
    .in("project_id", ids)
    .is("revoked_at", null);

  if ((count ?? 0) >= capabilities.embedTokens) {
    return NextResponse.json(
      {
        error: `Your plan allows ${capabilities.embedTokens} embed tokens.`,
        code: "LIMIT_REACHED",
      },
      { status: 409 }
    );
  }

  // Normalise now, at write time, so the hot path in `originAllowed` never has
  // to reason about `Example.com/` versus `https://example.com`.
  const origins = parsed.data.allowed_origins
    .map((value) => (value.trim() === "*" ? "*" : normalizeOrigin(value)))
    .filter((value): value is string => Boolean(value));

  const token = generateEmbedToken(surface);

  const { data, error } = await supabase
    .from("embed_tokens")
    .insert({
      project_id: parsed.data.project_id,
      name: parsed.data.name,
      token,
      surface,
      allowed_origins: origins,
      daily_credit_cap: parsed.data.daily_credit_cap,
    })
    .select(
      "id, project_id, name, token, allowed_origins, surface, daily_credit_cap, enabled, created_at"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ token: data }, { status: 201 });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  allowed_origins: z.array(z.string().max(255)).max(20).optional(),
  daily_credit_cap: z.number().int().min(1).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  revoke: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  const ids = await ownedProjectIds(supabase, profile.id);
  if (!ids.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (parsed.data.allowed_origins) {
    update.allowed_origins = parsed.data.allowed_origins
      .map((value) => (value.trim() === "*" ? "*" : normalizeOrigin(value)))
      .filter(Boolean);
  }
  if (parsed.data.daily_credit_cap !== undefined) {
    update.daily_credit_cap = parsed.data.daily_credit_cap;
  }
  if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled;
  if (parsed.data.revoke) update.revoked_at = new Date().toISOString();

  // Scoping the update to the caller's own projects is what makes the id in
  // the body safe to trust.
  const { error } = await supabase
    .from("embed_tokens")
    .update(update)
    .eq("id", parsed.data.id)
    .in("project_id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

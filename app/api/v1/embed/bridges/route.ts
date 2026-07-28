import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { capabilitiesFor } from "@/lib/plans";
import { ensureProfile } from "@/lib/profiles";

/** Twitch and Kick channels a project's bard listens to. */

const createSchema = z.object({
  project_id: z.string().uuid(),
  platform: z.enum(["twitch", "kick"]),
  // Channel names on both platforms are lowercase alphanumerics and
  // underscores; validating here keeps junk out of the websocket layer.
  channel: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-zA-Z0-9_]+$/, "Channel names are letters, numbers and underscores"),
  respond_mode: z.enum(["mentions", "commands", "all"]).default("mentions"),
  trigger_prefix: z.string().min(1).max(24).default("!punaab"),
  cooldown_seconds: z.number().int().min(3).max(600).default(12),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid payload" },
      { status: 400 }
    );
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  const capabilities = capabilitiesFor(profile.plan_code);
  const permitted =
    parsed.data.platform === "twitch"
      ? capabilities.twitchChat
      : capabilities.kickChat;
  if (!permitted) {
    return NextResponse.json(
      {
        error: "Live chat bridges require a Creator plan or above.",
        code: "PLAN_REQUIRED",
      },
      { status: 402 }
    );
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("owner_id", profile.id);
  const ids = (projects || []).map((row) => row.id as string);
  if (!ids.includes(parsed.data.project_id)) {
    return NextResponse.json({ error: "Unknown project" }, { status: 404 });
  }

  const { count } = await supabase
    .from("chat_bridges")
    .select("id", { count: "exact", head: true })
    .in("project_id", ids);

  if ((count ?? 0) >= capabilities.chatBridges) {
    return NextResponse.json(
      {
        error: `Your plan allows ${capabilities.chatBridges} chat bridges.`,
        code: "LIMIT_REACHED",
      },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("chat_bridges")
    .upsert(
      {
        project_id: parsed.data.project_id,
        platform: parsed.data.platform,
        channel: parsed.data.channel.toLowerCase(),
        respond_mode: parsed.data.respond_mode,
        trigger_prefix: parsed.data.trigger_prefix,
        cooldown_seconds: parsed.data.cooldown_seconds,
        enabled: true,
      },
      { onConflict: "project_id,platform,channel" }
    )
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ bridge: data }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("owner_id", profile.id);
  const ids = (projects || []).map((row) => row.id as string);
  if (!ids.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await supabase
    .from("chat_bridges")
    .delete()
    .eq("id", id)
    .in("project_id", ids);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

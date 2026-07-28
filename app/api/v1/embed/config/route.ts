import { NextResponse } from "next/server";
import { originAllowed, resolveEmbedToken } from "@/lib/embed/tokens";
import { capabilitiesFor } from "@/lib/plans";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * What an embedded Punaab needs to know about himself before saying anything:
 * his name, his look, and which live chats he is listening to.
 *
 * Returns only presentation data. Nothing here is sensitive — no keys, no
 * lore, no usage figures — because the response is readable by anyone who can
 * see the token in the page source.
 */

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: cors(req.headers.get("origin")),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const url = new URL(req.url);
  const raw =
    req.headers.get("x-punaab-embed") || url.searchParams.get("token") || "";

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { error: "Backend not configured" },
      { status: 503, headers: cors(origin) }
    );
  }

  const token = await resolveEmbedToken(supabase, raw);
  if (!token) {
    return NextResponse.json(
      { error: "Invalid embed token" },
      { status: 401, headers: cors(origin) }
    );
  }

  if (token.surface === "web" && !originAllowed(token.allowedOrigins, origin)) {
    return NextResponse.json(
      { error: "Not allowed on this domain", code: "ORIGIN_NOT_ALLOWED" },
      { status: 403, headers: cors(origin) }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan_code")
    .eq("id", token.ownerId)
    .maybeSingle();
  const capabilities = capabilitiesFor(profile?.plan_code);

  const { data: config } = await supabase
    .from("character_configs")
    .select("display_name, appearance_id, voice")
    .eq("project_id", token.projectId)
    .maybeSingle();

  const { data: bridges } = await supabase
    .from("chat_bridges")
    .select("platform, channel, respond_mode, trigger_prefix, cooldown_seconds")
    .eq("project_id", token.projectId)
    .eq("enabled", true);

  // Only advertise bridges the plan actually permits, so a downgrade quietly
  // stops the overlay listening rather than letting it spend on a feature the
  // account no longer has.
  const permitted = (bridges || []).filter((bridge) =>
    bridge.platform === "twitch" ? capabilities.twitchChat : capabilities.kickChat
  );

  return NextResponse.json(
    {
      name: config?.display_name || "Punaab",
      appearance: "classic",
      voice: "punaab",
      surface: token.surface,
      bridges: permitted,
    },
    {
      headers: {
        ...cors(origin),
        // Config changes rarely and every overlay refetches it on reconnect.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    }
  );
}

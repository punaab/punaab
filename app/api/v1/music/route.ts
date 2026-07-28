import { NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/api-keys";
import { getSupabaseAdmin } from "@/lib/supabase/server";

function getKey(req: Request) {
  return (
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  );
}

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  const raw = getKey(req);
  if (!supabase || !raw) {
    return NextResponse.json({ error: "API key required" }, { status: 401 });
  }
  const authz = await resolveApiKey(supabase, raw);
  if (!authz) return NextResponse.json({ error: "Invalid API key" }, { status: 401 });

  const { data: playlists } = await supabase
    .from("playlists")
    .select("id, name, mode, tracks(id, title, url, sort_order)")
    .eq("project_id", authz.projectId);

  const nextTrack = {
    title: "Roads Between Worlds",
    url: null as string | null,
    note: "Upload tracks in the dashboard to enable streaming.",
  };
  const first = playlists?.[0]?.tracks?.[0] as
    | { title?: string; url?: string | null }
    | undefined;
  if (first?.title) {
    nextTrack.title = first.title;
    nextTrack.url = first.url ?? null;
  }

  return NextResponse.json({
    data: playlists || [],
    playlist: playlists?.[0]?.name || "Radio",
    track: nextTrack,
    radio: {
      enabled: true,
      next: nextTrack,
    },
  });
}

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isLoreAdmin } from "@/lib/lore-admin";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import { isPendingRevision } from "@/lib/lore-write";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { normalizeLegacyCategory } from "@/lib/community-lore";

const SELECT =
  "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, image_url, status, pending_revision, profiles!community_lore_author_id_fkey(display_name)";

export async function GET() {
  const { userId } = await auth();
  if (!userId || !isLoreAdmin(userId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const [{ data: pendingRows, error: pendingError }, { data: revisionRows, error: revError }] =
    await Promise.all([
      supabase
        .from("community_lore")
        .select(SELECT)
        .eq("status", "pending")
        .eq("is_hub", false)
        .order("created_at", { ascending: true })
        .limit(100),
      supabase
        .from("community_lore")
        .select(SELECT)
        .eq("status", "accepted")
        .eq("is_hub", false)
        .not("pending_revision", "is", null)
        .order("updated_at", { ascending: true })
        .limit(100),
    ]);

  if (pendingError || revError) {
    return NextResponse.json(
      { error: pendingError?.message || revError?.message || "Load failed." },
      { status: 500 }
    );
  }

  const pending = ((pendingRows || []) as LoreDbRow[]).map((row) => mapLoreRow(row));

  const edits = ((revisionRows || []) as LoreDbRow[]).map((row) => {
    const base = mapLoreRow(row);
    const rev = row.pending_revision;
    if (!isPendingRevision(rev)) return base;
    // Surface the proposed title/body in the queue card so admins see the edit.
    return {
      ...base,
      title: String(rev.title || base.title),
      body: String(rev.body || base.body),
      summary: String(rev.summary || base.summary),
      category: normalizeLegacyCategory(String(rev.category || base.category)),
      imageUrl:
        typeof rev.imageUrl === "string" ? rev.imageUrl : base.imageUrl,
      hasPendingRevision: true,
    };
  });

  const seen = new Set(pending.map((p) => p.id));
  const lore = [...pending, ...edits.filter((e) => !seen.has(e.id))];

  return NextResponse.json({ lore });
}

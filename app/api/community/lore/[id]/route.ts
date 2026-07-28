import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  isLoreLinkKind,
  normalizeLegacyCategory,
  type CommunityLoreComment,
  type CommunityLoreDetail,
  type LoreLinkKind,
} from "@/lib/community-lore";
import { isLoreAdmin } from "@/lib/lore-admin";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const { userId } = await auth();
  let myProfileId: string | null = null;
  if (userId) {
    const { profile } = await ensureProfile(userId);
    myProfileId = profile.id === "local" ? null : profile.id;
  }

  const { data: row, error } = await supabase
    .from("community_lore")
    .select(
      "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, image_url, status, profiles!community_lore_author_id_fkey(display_name)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Lore not found." }, { status: 404 });
  }

  const mappedPreview = mapLoreRow(row as LoreDbRow);
  const isOwner = Boolean(myProfileId && mappedPreview.authorId === myProfileId);
  const admin = isLoreAdmin(userId);
  if (
    mappedPreview.status !== "accepted" &&
    !mappedPreview.isHub &&
    !isOwner &&
    !admin
  ) {
    return NextResponse.json({ error: "Lore not found." }, { status: 404 });
  }

  const [{ count: voteCount }, { data: myVote }, { data: commentRows }, { data: outLinks }, { data: inLinks }] =
    await Promise.all([
      supabase
        .from("community_lore_votes")
        .select("*", { count: "exact", head: true })
        .eq("lore_id", id),
      myProfileId
        ? supabase
            .from("community_lore_votes")
            .select("lore_id")
            .eq("lore_id", id)
            .eq("voter_id", myProfileId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("community_lore_comments")
        .select(
          "id, body, created_at, author_id, profiles!community_lore_comments_author_id_fkey(display_name)"
        )
        .eq("lore_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("community_lore_links")
        .select("from_id, to_id, kind, note")
        .eq("from_id", id),
      supabase
        .from("community_lore_links")
        .select("from_id, to_id, kind, note")
        .eq("to_id", id),
    ]);

  const commentsFixed: CommunityLoreComment[] = (commentRows || []).map((c) => {
    const profiles = c.profiles as LoreDbRow["profiles"];
    let name = "Traveler";
    if (profiles) {
      name = Array.isArray(profiles)
        ? profiles[0]?.display_name || "Traveler"
        : profiles.display_name || "Traveler";
    }
    return {
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      authorId: c.author_id,
      authorName: name,
    };
  });

  const peerIds = [
    ...new Set([
      ...(outLinks || []).map((e) => e.to_id),
      ...(inLinks || []).map((e) => e.from_id),
    ]),
  ];
  const peerMap = new Map<string, { title: string; category: string }>();
  if (peerIds.length > 0) {
    const { data: peers } = await supabase
      .from("community_lore")
      .select("id, title, category, status, is_hub")
      .in("id", peerIds);
    for (const peer of peers || []) {
      if (peer.status !== "accepted" && !peer.is_hub) continue;
      peerMap.set(peer.id, {
        title: peer.title,
        category: peer.category,
      });
    }
  }

  const linksOut = (outLinks || [])
    .filter((e) => isLoreLinkKind(e.kind) && peerMap.has(e.to_id))
    .map((e) => {
      const p = peerMap.get(e.to_id)!;
      return {
        from: e.from_id,
        to: e.to_id,
        kind: e.kind as LoreLinkKind,
        note: e.note,
        title: p.title,
        category: normalizeLegacyCategory(p.category),
      };
    });

  const linksIn = (inLinks || [])
    .filter((e) => isLoreLinkKind(e.kind) && peerMap.has(e.from_id))
    .map((e) => {
      const p = peerMap.get(e.from_id)!;
      return {
        from: e.from_id,
        to: e.to_id,
        kind: e.kind as LoreLinkKind,
        note: e.note,
        title: p.title,
        category: normalizeLegacyCategory(p.category),
      };
    });

  const base = mapLoreRow(row as LoreDbRow, {
    voteCount: voteCount || 0,
    commentCount: commentsFixed.length,
    votedByMe: Boolean(myVote),
  });

  const lore: CommunityLoreDetail = {
    ...base,
    comments: commentsFixed,
    linksOut,
    linksIn,
  };

  return NextResponse.json({ lore });
}

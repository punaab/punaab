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
import { ensureLoreHub } from "@/lib/lore-hub";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import { ensureMapPlaceLore } from "@/lib/map-place-lore";
import { looksLikeUuid, resolveLoreId } from "@/lib/lore-resolve";
import {
  ensureArtMirror,
  fieldsToPendingRevision,
  isPendingRevision,
  parseLoreWriteBody,
  replaceOutboundLinks,
  revisionToDbUpdate,
} from "@/lib/lore-write";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const DETAIL_SELECT =
  "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, image_url, status, pending_revision, profiles!community_lore_author_id_fkey(display_name)";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: idOrSlug } = await context.params;
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

  // Map pins navigate with slugs (`place-crowfoot`); UUIDs still work for cards.
  if (!looksLikeUuid(idOrSlug) && idOrSlug.startsWith("place-")) {
    await ensureMapPlaceLore(supabase);
  }

  let detailQuery = supabase.from("community_lore").select(DETAIL_SELECT);
  detailQuery = looksLikeUuid(idOrSlug)
    ? detailQuery.eq("id", idOrSlug)
    : detailQuery.eq("slug", idOrSlug);

  const { data: row, error } = await detailQuery.maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Lore not found." }, { status: 404 });
  }

  const id = (row as LoreDbRow).id;

  const mappedPreview = mapLoreRow(row as LoreDbRow);
  const isOwner = Boolean(myProfileId && mappedPreview.authorId === myProfileId);
  const admin = await isLoreAdmin(userId);
  if (
    mappedPreview.status !== "accepted" &&
    !mappedPreview.isHub &&
    !isOwner &&
    !admin
  ) {
    return NextResponse.json({ error: "Lore not found." }, { status: 404 });
  }

  const [
    { count: voteCount },
    { data: myVote },
    { data: commentRows },
    { data: outLinks },
    { data: inLinks },
  ] = await Promise.all([
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
      const show =
        peer.status === "accepted" ||
        peer.is_hub ||
        (isOwner && peer.status !== "denied");
      if (!show) continue;
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

  const rawRevision = (row as LoreDbRow).pending_revision;
  const pendingRevision =
    (isOwner || admin) && isPendingRevision(rawRevision)
      ? {
          title: String(rawRevision.title),
          body: String(rawRevision.body),
          summary: String(rawRevision.summary || ""),
          category: normalizeLegacyCategory(String(rawRevision.category || base.category)),
          locationKey:
            typeof rawRevision.locationKey === "string"
              ? rawRevision.locationKey
              : null,
          tags: Array.isArray(rawRevision.tags)
            ? rawRevision.tags.filter((t): t is string => typeof t === "string")
            : [],
          imageUrl:
            typeof rawRevision.imageUrl === "string" ? rawRevision.imageUrl : null,
          links: Array.isArray(rawRevision.links)
            ? rawRevision.links
                .filter(
                  (l): l is { toId: string; kind: LoreLinkKind; note?: string } =>
                    Boolean(l) &&
                    typeof l === "object" &&
                    typeof (l as { toId?: string }).toId === "string" &&
                    isLoreLinkKind(String((l as { kind?: string }).kind || "related"))
                )
                .map((l) => ({
                  toId: l.toId,
                  kind: (l.kind || "related") as LoreLinkKind,
                  note: l.note,
                }))
            : [],
          submittedAt: String(rawRevision.submittedAt || new Date().toISOString()),
        }
      : null;

  const lore: CommunityLoreDetail = {
    ...base,
    comments: commentsFixed,
    linksOut,
    linksIn,
    isOwner,
    pendingRevision,
  };

  return NextResponse.json({ lore });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: idOrSlug } = await context.params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to edit." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const id = await resolveLoreId(supabase, idOrSlug);
  if (!id) {
    return NextResponse.json({ error: "Lore not found." }, { status: 404 });
  }

  const hub = await ensureLoreHub(supabase);
  const { profile } = await ensureProfile(userId);
  if (profile.id === "local") {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const { data: existing, error: loadError } = await supabase
    .from("community_lore")
    .select(
      "id, author_id, status, is_hub, title, body, summary, category, location_key, tags, image_url"
    )
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing || existing.is_hub) {
    return NextResponse.json({ error: "Lore not found." }, { status: 404 });
  }
  if (existing.author_id !== profile.id && !(await isLoreAdmin(userId))) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Parameters<
    typeof parseLoreWriteBody
  >[0];
  const parsed = parseLoreWriteBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const fields = parsed.fields;

  // Accepted live entries: stage changes for admin review.
  if (existing.status === "accepted") {
    const { error } = await supabase
      .from("community_lore")
      .update({
        pending_revision: fieldsToPendingRevision(fields),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id,
      status: "accepted",
      needsReview: true,
      message:
        "Edits submitted for admin approval. The live entry is unchanged until accepted.",
    });
  }

  // Pending / denied: update in place and resubmit.
  const { error } = await supabase
    .from("community_lore")
    .update({
      ...revisionToDbUpdate(fields),
      status: "pending",
      reviewed_at: null,
      reviewed_by: null,
      review_note: null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await replaceOutboundLinks(supabase, id, fields.links, hub?.id);
  await ensureArtMirror(supabase, {
    sourceId: id,
    authorId: existing.author_id,
    title: fields.title,
    summary: fields.summary,
    body: fields.body,
    imageUrl: fields.imageUrl,
    category: fields.category,
    status: "pending",
    hubId: hub?.id,
  });

  return NextResponse.json({
    id,
    status: "pending",
    needsReview: true,
    message: "Submission updated and sent back for review.",
  });
}

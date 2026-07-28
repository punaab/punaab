import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  isLoreCategory,
  isLoreLinkKind,
  isLoreSort,
  LORE_BODY_MAX,
  LORE_BODY_MIN,
  LORE_SUMMARY_MAX,
  LORE_TITLE_MAX,
  makeLoreSlug,
  normalizeLegacyCategory,
  type CommunityLoreListItem,
  type LoreCategoryId,
  type LoreLinkKind,
  type LoreSort,
} from "@/lib/community-lore";
import { ensureLoreHub } from "@/lib/lore-hub";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const SELECT =
  "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, image_url, status, profiles!community_lore_author_id_fkey(display_name)";

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

function parseLinks(
  raw: unknown
): Array<{ toId: string; kind: LoreLinkKind; note?: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ toId: string; kind: LoreLinkKind; note?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const toId = String((item as { toId?: string }).toId || "").trim();
    const kindRaw = String((item as { kind?: string }).kind || "related");
    const note = String((item as { note?: string }).note || "").trim();
    if (!toId || !isLoreLinkKind(kindRaw)) continue;
    out.push({ toId, kind: kindRaw, note: note || undefined });
  }
  return out.slice(0, 24);
}

function sortLore(lore: CommunityLoreListItem[], sort: LoreSort) {
  const copy = [...lore];
  copy.sort((a, b) => {
    if (a.isHub !== b.isHub) return a.isHub ? -1 : 1;
    switch (sort) {
      case "newest":
        return b.createdAt.localeCompare(a.createdAt);
      case "oldest":
        return a.createdAt.localeCompare(b.createdAt);
      case "alpha":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      case "longest":
        return b.body.length - a.body.length || b.createdAt.localeCompare(a.createdAt);
      case "votes":
      default:
        if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
        return b.createdAt.localeCompare(a.createdAt);
    }
  });
  return copy;
}

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  const params = new URL(req.url).searchParams;
  const sortRaw = params.get("sort") || "votes";
  const sort: LoreSort = isLoreSort(sortRaw) ? sortRaw : "votes";
  const categoryParam = params.get("category");
  const category =
    categoryParam && isLoreCategory(categoryParam) ? categoryParam : null;
  const mine = params.get("mine") === "1";

  if (!supabase) {
    return NextResponse.json({
      lore: [] as CommunityLoreListItem[],
      sort,
      category,
    });
  }

  await ensureLoreHub(supabase);

  const { userId } = await auth();
  let myProfileId: string | null = null;
  if (userId) {
    const { profile } = await ensureProfile(userId);
    myProfileId = profile.id === "local" ? null : profile.id;
  }

  let query = supabase.from("community_lore").select(SELECT).limit(200);

  if (mine && myProfileId) {
    query = query.eq("author_id", myProfileId);
  } else if (myProfileId) {
    // Public hall + the traveler's own pending posts, so a fresh character
    // shows up under Characters for them even before (or without) review.
    query = query.or(`status.eq.accepted,author_id.eq.${myProfileId}`);
  } else {
    query = query.eq("status", "accepted");
  }

  if (category) query = query.eq("category", category);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        lore: [] as CommunityLoreListItem[],
        sort,
        category,
      },
      { status: error.message.includes("community_lore") ? 503 : 500 }
    );
  }

  const rows = ((data || []) as LoreDbRow[]).filter((row) => {
    if (row.status === "accepted") return true;
    if (mine && myProfileId && row.author_id === myProfileId) return true;
    // Own pending stays visible to the author in area lists / search.
    if (
      myProfileId &&
      row.author_id === myProfileId &&
      row.status === "pending"
    ) {
      return true;
    }
    return false;
  });
  const ids = rows.map((row) => row.id);

  const voteCounts = new Map<string, number>();
  const commentCounts = new Map<string, number>();
  const myVotes = new Set<string>();

  if (ids.length > 0) {
    const [{ data: votes }, { data: comments }] = await Promise.all([
      supabase
        .from("community_lore_votes")
        .select("lore_id, voter_id")
        .in("lore_id", ids),
      supabase
        .from("community_lore_comments")
        .select("lore_id")
        .in("lore_id", ids),
    ]);

    for (const vote of votes || []) {
      voteCounts.set(vote.lore_id, (voteCounts.get(vote.lore_id) || 0) + 1);
      if (myProfileId && vote.voter_id === myProfileId) myVotes.add(vote.lore_id);
    }
    for (const comment of comments || []) {
      commentCounts.set(
        comment.lore_id,
        (commentCounts.get(comment.lore_id) || 0) + 1
      );
    }
  }

  const lore = sortLore(
    rows.map((row) =>
      mapLoreRow(row, {
        voteCount: voteCounts.get(row.id) || 0,
        commentCount: commentCounts.get(row.id) || 0,
        votedByMe: myVotes.has(row.id),
      })
    ),
    sort
  );

  return NextResponse.json({ lore, sort, category });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to share lore." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const hub = await ensureLoreHub(supabase);
  const { profile } = await ensureProfile(userId);
  if (profile.id === "local") {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as {
    title?: string;
    body?: string;
    summary?: string;
    category?: string;
    locationKey?: string;
    tags?: unknown;
    meta?: unknown;
    links?: unknown;
    imageUrl?: string;
  } | null;

  const title = (body?.title || "").trim();
  const text = (body?.body || "").trim();
  const summary = (body?.summary || "").trim().slice(0, LORE_SUMMARY_MAX);
  const category: LoreCategoryId = normalizeLegacyCategory(body?.category);
  const locationKey = (body?.locationKey || "").trim().slice(0, 80) || null;
  const tags = parseTags(body?.tags);
  const meta =
    body?.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
      ? (body.meta as Record<string, unknown>)
      : {};
  const links = parseLinks(body?.links);
  const imageUrl = (body?.imageUrl || "").trim() || null;

  if (title.length < 3 || title.length > LORE_TITLE_MAX) {
    return NextResponse.json(
      { error: `Title needs 3–${LORE_TITLE_MAX} characters.` },
      { status: 400 }
    );
  }
  if (text.length < LORE_BODY_MIN || text.length > LORE_BODY_MAX) {
    return NextResponse.json(
      { error: `Entry needs ${LORE_BODY_MIN}–${LORE_BODY_MAX} characters.` },
      { status: 400 }
    );
  }
  if (!isLoreCategory(category)) {
    return NextResponse.json({ error: "Unknown lore area." }, { status: 400 });
  }
  if (category === "art" && !imageUrl) {
    return NextResponse.json(
      { error: "Art submissions need an image." },
      { status: 400 }
    );
  }

  const slug = makeLoreSlug(title);

  const { data, error } = await supabase
    .from("community_lore")
    .insert({
      author_id: profile.id,
      category,
      title,
      body: text,
      summary,
      slug,
      location_key: locationKey,
      tags,
      meta,
      image_url: imageUrl,
      is_hub: false,
      // Publish straight into the hall so Characters / Art / etc. show up for
      // the author and everyone else without waiting on a review queue.
      status: "accepted",
      reviewed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Could not publish lore." },
      { status: 500 }
    );
  }

  const edgeRows: Array<{
    from_id: string;
    to_id: string;
    kind: LoreLinkKind;
    note: string | null;
  }> = [];

  const linked = new Set<string>();
  for (const link of links) {
    if (link.toId === data.id || linked.has(`${link.toId}:${link.kind}`)) continue;
    linked.add(`${link.toId}:${link.kind}`);
    edgeRows.push({
      from_id: data.id,
      to_id: link.toId,
      kind: link.kind,
      note: link.note || null,
    });
  }

  if (hub && !edgeRows.some((e) => e.to_id === hub.id)) {
    edgeRows.push({
      from_id: data.id,
      to_id: hub.id,
      kind: "related",
      note: null,
    });
  }

  if (edgeRows.length > 0) {
    await supabase.from("community_lore_links").insert(edgeRows);
  }

  return NextResponse.json(
    { id: data.id, slug, category, status: "pending" },
    { status: 201 }
  );
}

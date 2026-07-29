import { NextResponse } from "next/server";
import {
  LORE_CATEGORY_IDS,
  isLoreCategory,
  isLoreLinkKind,
  isLoreSort,
  type CommunityLoreEdge,
  type CommunityLoreListItem,
  type LoreLinkKind,
  type LoreSort,
} from "@/lib/community-lore";
import { ensureLoreHub } from "@/lib/lore-hub";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const PAGE = 40;
const SELECT =
  "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, image_url, status, profiles!community_lore_author_id_fkey(display_name)";

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({
      hub: null,
      nodes: [] as CommunityLoreListItem[],
      edges: [] as CommunityLoreEdge[],
      nextOffset: null,
      done: true,
    });
  }

  const hub = await ensureLoreHub(supabase);
  const params = new URL(req.url).searchParams;
  const offset = Math.max(0, Number(params.get("offset") || 0) || 0);
  const limit = Math.min(
    80,
    Math.max(10, Number(params.get("limit") || PAGE) || PAGE)
  );
  const categoryParam = params.get("category");
  const category =
    categoryParam && isLoreCategory(categoryParam) ? categoryParam : null;
  const q = (params.get("q") || "").trim().toLowerCase();
  const sortRaw = params.get("sort") || "votes";
  const sort: LoreSort = isLoreSort(sortRaw) ? sortRaw : "votes";

  const { data, error } = await supabase
    .from("community_lore")
    .select(SELECT)
    .eq("status", "accepted")
    .order("is_hub", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        nodes: [],
        edges: [],
        nextOffset: null,
        done: true,
      },
      { status: 503 }
    );
  }

  const rows = (data || []) as LoreDbRow[];
  const ids = rows.map((r) => r.id);
  const voteCounts = new Map<string, number>();

  if (ids.length > 0) {
    const { data: votes } = await supabase
      .from("community_lore_votes")
      .select("lore_id")
      .in("lore_id", ids);
    for (const vote of votes || []) {
      voteCounts.set(vote.lore_id, (voteCounts.get(vote.lore_id) || 0) + 1);
    }
  }

  let nodes = rows.map((row) =>
    mapLoreRow(row, { voteCount: voteCounts.get(row.id) || 0 })
  );

  if (category) nodes = nodes.filter((n) => n.category === category || n.isHub);
  // Mixed graph (no category): hide auto art mirrors — source entries stay.
  if (!category) {
    nodes = nodes.filter(
      (n) =>
        typeof n.meta?.mirrored_from !== "string" && !n.tags.includes("mirror")
    );
  }
  if (q) {
    nodes = nodes.filter(
      (n) =>
        n.isHub ||
        n.title.toLowerCase().includes(q) ||
        n.summary.toLowerCase().includes(q) ||
        n.tags.some((t) => t.includes(q))
    );
  }

  nodes.sort((a, b) => {
    if (a.isHub !== b.isHub) return a.isHub ? -1 : 1;
    switch (sort) {
      case "newest":
        return b.createdAt.localeCompare(a.createdAt);
      case "oldest":
        return a.createdAt.localeCompare(b.createdAt);
      case "alpha":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      case "longest":
        return b.body.length - a.body.length;
      case "votes":
      default:
        if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
        return b.createdAt.localeCompare(a.createdAt);
    }
  });

  const hubNode = nodes.find((n) => n.isHub) || null;
  const rest = nodes.filter((n) => !n.isHub);
  const pageRest = rest.slice(offset, offset + limit);
  const pageNodes = offset === 0 && hubNode ? [hubNode, ...pageRest] : pageRest;
  const nextOffset = offset + limit < rest.length ? offset + limit : null;

  const pageIds = new Set(pageNodes.map((n) => n.id));
  if (hubNode) pageIds.add(hubNode.id);

  const edges: CommunityLoreEdge[] = [];
  if (pageIds.size > 0) {
    const idList = [...pageIds];
    const [{ data: fromLinks }, { data: toLinks }] = await Promise.all([
      supabase
        .from("community_lore_links")
        .select("from_id, to_id, kind, note")
        .in("from_id", idList),
      supabase
        .from("community_lore_links")
        .select("from_id, to_id, kind, note")
        .in("to_id", idList),
    ]);

    const seen = new Set<string>();
    for (const e of [...(fromLinks || []), ...(toLinks || [])]) {
      const key = `${e.from_id}:${e.to_id}:${e.kind}`;
      if (seen.has(key)) continue;
      if (!pageIds.has(e.from_id) || !pageIds.has(e.to_id)) continue;
      if (!isLoreLinkKind(e.kind)) continue;
      seen.add(key);
      edges.push({
        from: e.from_id,
        to: e.to_id,
        kind: e.kind as LoreLinkKind,
        note: e.note ?? null,
      });
    }
  }

  // Per-category totals, for the graph's first level.
  //
  // Counted with a dedicated query rather than tallied from `data`, because
  // `data` is capped at 500 rows — deriving counts from it would quietly
  // under-report exactly the categories that are big enough to matter, which
  // are the ones the graph decides to expand by default.
  const counts: Record<string, number> = {};
  for (const id of LORE_CATEGORY_IDS) counts[id] = 0;
  const { data: categoryRows } = await supabase
    .from("community_lore")
    .select("category")
    .eq("status", "accepted")
    .eq("is_hub", false);
  for (const row of categoryRows ?? []) {
    const key = (row as { category?: string }).category;
    if (key && key in counts) counts[key] += 1;
  }

  return NextResponse.json({
    counts,
    hub: hub
      ? { id: hub.id, slug: hub.slug, title: hub.title }
      : hubNode
        ? { id: hubNode.id, slug: hubNode.slug, title: hubNode.title }
        : null,
    nodes: pageNodes,
    edges,
    nextOffset,
    done: nextOffset === null,
  });
}

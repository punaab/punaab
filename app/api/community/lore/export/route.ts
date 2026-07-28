import { NextResponse } from "next/server";
import {
  isLoreCategory,
  isLoreLinkKind,
  type LoreLinkKind,
} from "@/lib/community-lore";
import { ensureLoreHub } from "@/lib/lore-hub";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const SELECT =
  "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, image_url, status, profiles!community_lore_author_id_fkey(display_name)";

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const hub = await ensureLoreHub(supabase);
  const params = new URL(req.url).searchParams;
  const categoryParam = params.get("category");
  const category =
    categoryParam && isLoreCategory(categoryParam) ? categoryParam : null;
  const nodeId = (params.get("node") || "").trim();

  const { data, error } = await supabase
    .from("community_lore")
    .select(SELECT)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  const { data: linkRows } = await supabase
    .from("community_lore_links")
    .select("from_id, to_id, kind, note");

  let edges = (linkRows || [])
    .filter((e) => isLoreLinkKind(e.kind))
    .map((e) => ({
      from: e.from_id,
      to: e.to_id,
      kind: e.kind as LoreLinkKind,
      note: e.note ?? null,
    }));

  // Only edges between accepted nodes in the export set
  const acceptedIds = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => acceptedIds.has(e.from) && acceptedIds.has(e.to));

  if (category) {
    const keep = new Set(
      nodes.filter((n) => n.category === category || n.isHub).map((n) => n.id)
    );
    nodes = nodes.filter((n) => keep.has(n.id));
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  }

  if (nodeId) {
    const neighborIds = new Set<string>([nodeId]);
    for (const e of edges) {
      if (e.from === nodeId) neighborIds.add(e.to);
      if (e.to === nodeId) neighborIds.add(e.from);
    }
    if (hub) neighborIds.add(hub.id);
    nodes = nodes.filter((n) => neighborIds.has(n.id));
    edges = edges.filter((e) => neighborIds.has(e.from) && neighborIds.has(e.to));
  }

  const pack = {
    version: 1,
    exportedAt: new Date().toISOString(),
    hub: hub ? { id: hub.id, slug: hub.slug, title: hub.title } : null,
    nodes: nodes.map((n) => ({
      id: n.id,
      slug: n.slug,
      category: n.category,
      title: n.title,
      summary: n.summary,
      body: n.body,
      locationKey: n.locationKey,
      tags: n.tags,
      meta: n.meta,
      imageUrl: n.imageUrl,
      votes: n.voteCount,
      author: n.authorName,
      createdAt: n.createdAt,
      isHub: Boolean(n.isHub),
    })),
    edges,
  };

  const filename = category
    ? `punaab-lore-${category}.json`
    : nodeId
      ? `punaab-lore-node.json`
      : "punaab-lore-pack.json";

  return new NextResponse(JSON.stringify(pack, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

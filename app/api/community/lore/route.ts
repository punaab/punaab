import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  isLoreCategory,
  isLoreSort,
  makeLoreSlug,
  type CommunityLoreListItem,
  type LoreSort,
} from "@/lib/community-lore";
import { ensureLoreHub } from "@/lib/lore-hub";
import { ensureMapPlaceLore } from "@/lib/map-place-lore";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import {
  ensureArtMirror,
  parseLoreWriteBody,
  replaceOutboundLinks,
} from "@/lib/lore-write";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const SELECT =
  "id, title, body, category, created_at, author_id, slug, summary, location_key, tags, meta, is_hub, image_url, status, pending_revision, profiles!community_lore_author_id_fkey(display_name)";

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
        return (
          b.body.length - a.body.length || b.createdAt.localeCompare(a.createdAt)
        );
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
  const q = (params.get("q") || "").trim().slice(0, 80);
  const limit = Math.min(
    200,
    Math.max(1, Number(params.get("limit") || 200) || 200)
  );

  if (!supabase) {
    return NextResponse.json({
      lore: [] as CommunityLoreListItem[],
      sort,
      category,
    });
  }

  await ensureLoreHub(supabase);
  if (category === "places") {
    await ensureMapPlaceLore(supabase);
  }

  const { userId } = await auth();
  let myProfileId: string | null = null;
  if (userId) {
    const { profile } = await ensureProfile(userId);
    myProfileId = profile.id === "local" ? null : profile.id;
  }

  let query = supabase.from("community_lore").select(SELECT).limit(limit);

  if (mine && myProfileId) {
    query = query.eq("author_id", myProfileId);
  } else if (myProfileId) {
    query = query.or(`status.eq.accepted,author_id.eq.${myProfileId}`);
  } else {
    query = query.eq("status", "accepted");
  }

  if (category) query = query.eq("category", category);
  if (q) {
    const safe = q.replace(/[%_,]/g, " ").trim();
    if (safe) {
      query = query.or(
        `title.ilike.%${safe}%,summary.ilike.%${safe}%,body.ilike.%${safe}%`
      );
    }
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        lore: [] as CommunityLoreListItem[],
        sort,
        category,
      },
      { status: 500 }
    );
  }

  const rows = (data || []) as LoreDbRow[];
  const ids = rows.map((r) => r.id);
  const voteMap = new Map<string, number>();
  const commentMap = new Map<string, number>();
  const votedSet = new Set<string>();

  if (ids.length > 0) {
    const [{ data: votes }, { data: comments }, myVotes] = await Promise.all([
      supabase.from("community_lore_votes").select("lore_id").in("lore_id", ids),
      supabase
        .from("community_lore_comments")
        .select("lore_id")
        .in("lore_id", ids),
      myProfileId
        ? supabase
            .from("community_lore_votes")
            .select("lore_id")
            .eq("voter_id", myProfileId)
            .in("lore_id", ids)
        : Promise.resolve({ data: [] as { lore_id: string }[] }),
    ]);
    for (const v of votes || []) {
      voteMap.set(v.lore_id, (voteMap.get(v.lore_id) || 0) + 1);
    }
    for (const c of comments || []) {
      commentMap.set(c.lore_id, (commentMap.get(c.lore_id) || 0) + 1);
    }
    for (const v of myVotes.data || []) votedSet.add(v.lore_id);
  }

  let lore = rows.map((row) =>
    mapLoreRow(row, {
      voteCount: voteMap.get(row.id) || 0,
      commentCount: commentMap.get(row.id) || 0,
      votedByMe: votedSet.has(row.id),
    })
  );

  if (!mine) {
    lore = lore.filter(
      (item) =>
        item.status === "accepted" ||
        item.isHub ||
        (myProfileId && item.authorId === myProfileId)
    );
  }

  return NextResponse.json({
    lore: sortLore(lore, sort),
    sort,
    category,
    q: q || null,
  });
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

  const body = (await req.json().catch(() => null)) as Parameters<
    typeof parseLoreWriteBody
  >[0];
  const parsed = parseLoreWriteBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const fields = parsed.fields;
  const slug = makeLoreSlug(fields.title);

  const { data, error } = await supabase
    .from("community_lore")
    .insert({
      author_id: profile.id,
      category: fields.category,
      title: fields.title,
      body: fields.body,
      summary: fields.summary,
      slug,
      location_key: fields.locationKey,
      tags: fields.tags,
      meta: {},
      image_url: fields.imageUrl,
      is_hub: false,
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

  await replaceOutboundLinks(supabase, data.id, fields.links, hub?.id);
  await ensureArtMirror(supabase, {
    sourceId: data.id,
    authorId: profile.id,
    title: fields.title,
    summary: fields.summary,
    body: fields.body,
    imageUrl: fields.imageUrl,
    category: fields.category,
    status: "accepted",
    hubId: hub?.id,
  });

  return NextResponse.json(
    { id: data.id, slug, category: fields.category, status: "accepted" },
    { status: 201 }
  );
}

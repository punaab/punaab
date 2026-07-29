import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isLoreAdmin } from "@/lib/lore-admin";
import { ensureLoreHub } from "@/lib/lore-hub";
import { mapLoreRow, type LoreDbRow } from "@/lib/lore-map";
import {
  ensureArtMirror,
  isPendingRevision,
  replaceOutboundLinks,
  revisionToDbUpdate,
  type LoreWriteFields,
} from "@/lib/lore-write";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { normalizeLegacyCategory } from "@/lib/community-lore";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { userId } = await auth();
  if (!userId || !isLoreAdmin(userId)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
    action?: string;
    note?: string;
  } | null;

  const action = body?.action;
  if (action !== "accept" && action !== "deny") {
    return NextResponse.json(
      { error: "action must be accept or deny." },
      { status: 400 }
    );
  }

  const note = (body?.note || "").trim().slice(0, 500) || null;

  const { data: row, error: loadError } = await supabase
    .from("community_lore")
    .select(
      "id, author_id, status, is_hub, pending_revision, title, body, summary, category, location_key, tags, image_url"
    )
    .eq("id", id)
    .eq("is_hub", false)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const revision = isPendingRevision(row.pending_revision)
    ? (row.pending_revision as LoreWriteFields & { submittedAt?: string })
    : null;

  // Accepted entry with staged edits.
  if (row.status === "accepted" && revision) {
    if (action === "deny") {
      const { error } = await supabase
        .from("community_lore")
        .update({
          pending_revision: null,
          review_note: note,
          reviewed_at: new Date().toISOString(),
          reviewed_by: profile.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ id, status: "accepted", revision: "denied" });
    }

    const fields: LoreWriteFields = {
      title: revision.title,
      body: revision.body,
      summary: revision.summary || "",
      category: normalizeLegacyCategory(revision.category),
      locationKey: revision.locationKey ?? null,
      tags: revision.tags || [],
      imageUrl: revision.imageUrl ?? null,
      links: revision.links || [],
    };

    const { error } = await supabase
      .from("community_lore")
      .update({
        ...revisionToDbUpdate(fields),
        status: "accepted",
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.id,
        review_note: note,
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await replaceOutboundLinks(supabase, id, fields.links, hub?.id);
    await ensureArtMirror(supabase, {
      sourceId: id,
      authorId: row.author_id,
      title: fields.title,
      summary: fields.summary,
      body: fields.body,
      imageUrl: fields.imageUrl,
      category: fields.category,
      status: "accepted",
      hubId: hub?.id,
    });

    return NextResponse.json({ id, status: "accepted", revision: "accepted" });
  }

  // Fresh pending submission (or denied → resubmitted as pending).
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: "Nothing pending for this entry." },
      { status: 404 }
    );
  }

  const status = action === "accept" ? "accepted" : "denied";
  const { data, error } = await supabase
    .from("community_lore")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: profile.id,
      review_note: note,
      pending_revision: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, status, author_id, title, body, summary, category, image_url")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Pending submission not found." },
      { status: 404 }
    );
  }

  if (status === "accepted") {
    await ensureArtMirror(supabase, {
      sourceId: data.id,
      authorId: data.author_id,
      title: data.title,
      summary: data.summary || "",
      body: data.body,
      imageUrl: data.image_url,
      category: normalizeLegacyCategory(data.category),
      status: "accepted",
      hubId: hub?.id,
    });
  }

  return NextResponse.json({ id: data.id, status: data.status });
}

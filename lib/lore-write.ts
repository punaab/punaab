import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isLoreCategory,
  isLoreLinkKind,
  LORE_BODY_MAX,
  LORE_BODY_MIN,
  LORE_SUMMARY_MAX,
  LORE_TITLE_MAX,
  makeLoreSlug,
  normalizeLegacyCategory,
  type LoreCategoryId,
  type LoreLinkKind,
} from "@/lib/community-lore";

export type LoreLinkInput = {
  toId: string;
  kind: LoreLinkKind;
  note?: string;
};

export type LoreWriteFields = {
  title: string;
  body: string;
  summary: string;
  category: LoreCategoryId;
  locationKey: string | null;
  tags: string[];
  imageUrl: string | null;
  links: LoreLinkInput[];
};

export type PendingRevision = LoreWriteFields & {
  submittedAt: string;
};

export function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

export function parseLinks(raw: unknown): LoreLinkInput[] {
  if (!Array.isArray(raw)) return [];
  const out: LoreLinkInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const toId = String((item as { toId?: string }).toId || "").trim();
    const kindRaw = String((item as { kind?: string }).kind || "related");
    const note = String((item as { note?: string }).note || "").trim();
    if (!toId || !isLoreLinkKind(kindRaw)) continue;
    const key = `${toId}:${kindRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ toId, kind: kindRaw, note: note || undefined });
  }
  return out.slice(0, 24);
}

export function parseLoreWriteBody(body: {
  title?: string;
  body?: string;
  summary?: string;
  category?: string;
  locationKey?: string;
  tags?: unknown;
  links?: unknown;
  imageUrl?: string;
} | null): { ok: true; fields: LoreWriteFields } | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Missing body." };

  const title = (body.title || "").trim();
  const text = (body.body || "").trim();
  const summary = (body.summary || "").trim().slice(0, LORE_SUMMARY_MAX);
  const category = normalizeLegacyCategory(body.category);
  const locationKey = (body.locationKey || "").trim().slice(0, 80) || null;
  const tags = parseTags(body.tags);
  const links = parseLinks(body.links);
  const imageUrl = (body.imageUrl || "").trim() || null;

  if (title.length < 3 || title.length > LORE_TITLE_MAX) {
    return { ok: false, error: `Title needs 3–${LORE_TITLE_MAX} characters.` };
  }
  if (text.length < LORE_BODY_MIN || text.length > LORE_BODY_MAX) {
    return {
      ok: false,
      error: `Entry needs ${LORE_BODY_MIN}–${LORE_BODY_MAX} characters.`,
    };
  }
  if (!isLoreCategory(category)) {
    return { ok: false, error: "Unknown lore area." };
  }
  if (category === "art" && !imageUrl) {
    return { ok: false, error: "Art submissions need an image." };
  }

  return {
    ok: true,
    fields: {
      title,
      body: text,
      summary,
      category,
      locationKey,
      tags,
      imageUrl,
      links,
    },
  };
}

export function isPendingRevision(value: unknown): value is PendingRevision {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.title === "string" && typeof row.body === "string";
}

/** Replace outbound links for an entry (keeps hub related if present). */
export async function replaceOutboundLinks(
  supabase: SupabaseClient,
  fromId: string,
  links: LoreLinkInput[],
  hubId?: string | null
) {
  await supabase.from("community_lore_links").delete().eq("from_id", fromId);

  const edgeRows: Array<{
    from_id: string;
    to_id: string;
    kind: LoreLinkKind;
    note: string | null;
  }> = [];
  const linked = new Set<string>();

  for (const link of links) {
    if (link.toId === fromId) continue;
    const key = `${link.toId}:${link.kind}`;
    if (linked.has(key)) continue;
    linked.add(key);
    edgeRows.push({
      from_id: fromId,
      to_id: link.toId,
      kind: link.kind,
      note: link.note || null,
    });
  }

  if (hubId && !edgeRows.some((e) => e.to_id === hubId)) {
    edgeRows.push({
      from_id: fromId,
      to_id: hubId,
      kind: "related",
      note: null,
    });
  }

  if (edgeRows.length > 0) {
    await supabase.from("community_lore_links").insert(edgeRows);
  }
}

/**
 * Non-art entries with an image get a mirror Art card (searchable / linkable)
 * connected with kind `about`. Existing art mirrors are updated in place.
 */
export async function ensureArtMirror(
  supabase: SupabaseClient,
  params: {
    sourceId: string;
    authorId: string;
    title: string;
    summary: string;
    body: string;
    imageUrl: string | null;
    category: LoreCategoryId;
    status: "pending" | "accepted" | "denied";
    hubId?: string | null;
  }
) {
  if (params.category === "art" || !params.imageUrl) return null;

  const { data: existingLink } = await supabase
    .from("community_lore_links")
    .select("to_id")
    .eq("from_id", params.sourceId)
    .eq("kind", "about")
    .limit(1)
    .maybeSingle();

  let artId = existingLink?.to_id as string | undefined;
  if (artId) {
    const { data: artRow } = await supabase
      .from("community_lore")
      .select("id, category")
      .eq("id", artId)
      .maybeSingle();
    if (!artRow || artRow.category !== "art") artId = undefined;
  }

  const artTitle = `${params.title}`.slice(0, LORE_TITLE_MAX);
  const artBody =
    params.summary.trim().length >= LORE_BODY_MIN
      ? params.summary.trim()
      : `Art for “${params.title}”. ${params.body}`.slice(0, LORE_BODY_MAX);
  const payload = {
    title: artTitle,
    body: artBody.length >= LORE_BODY_MIN ? artBody : params.body.slice(0, LORE_BODY_MAX),
    summary: params.summary || `Illustration for ${params.title}`.slice(0, LORE_SUMMARY_MAX),
    image_url: params.imageUrl,
    category: "art" as const,
    status: params.status === "denied" ? "pending" : params.status,
    updated_at: new Date().toISOString(),
    tags: ["mirror"],
    meta: { mirrored_from: params.sourceId },
  };

  if (artId) {
    await supabase.from("community_lore").update(payload).eq("id", artId);
  } else {
    const { data: created, error } = await supabase
      .from("community_lore")
      .insert({
        author_id: params.authorId,
        slug: makeLoreSlug(`${params.title} art`),
        location_key: null,
        is_hub: false,
        reviewed_at:
          params.status === "accepted" ? new Date().toISOString() : null,
        ...payload,
      })
      .select("id")
      .single();
    if (error || !created) return null;
    artId = created.id;
    await supabase.from("community_lore_links").upsert(
      {
        from_id: params.sourceId,
        to_id: artId,
        kind: "about",
        note: "Auto art from image",
      },
      { onConflict: "from_id,to_id,kind" }
    );
    if (params.hubId) {
      await supabase.from("community_lore_links").upsert(
        {
          from_id: artId,
          to_id: params.hubId,
          kind: "related",
          note: null,
        },
        { onConflict: "from_id,to_id,kind" }
      );
    }
  }

  return artId ?? null;
}

export function fieldsToPendingRevision(fields: LoreWriteFields): PendingRevision {
  return { ...fields, submittedAt: new Date().toISOString() };
}

export function revisionToDbUpdate(fields: LoreWriteFields) {
  return {
    title: fields.title,
    body: fields.body,
    summary: fields.summary,
    category: fields.category,
    location_key: fields.locationKey,
    tags: fields.tags,
    image_url: fields.imageUrl,
    updated_at: new Date().toISOString(),
    pending_revision: null,
  };
}

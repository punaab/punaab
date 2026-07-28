import {
  isLoreStatus,
  normalizeLegacyCategory,
  type CommunityLoreListItem,
  type LoreCategoryId,
  type LoreStatus,
} from "@/lib/community-lore";

type ProfileJoin = { display_name: string } | { display_name: string }[] | null;

export type LoreDbRow = {
  id: string;
  title: string;
  body: string;
  category: string;
  created_at: string;
  author_id: string;
  slug?: string | null;
  summary?: string | null;
  location_key?: string | null;
  tags?: string[] | null;
  meta?: Record<string, unknown> | null;
  is_hub?: boolean | null;
  image_url?: string | null;
  status?: string | null;
  profiles?: ProfileJoin;
};

export function displayName(profiles: ProfileJoin | undefined): string {
  if (!profiles) return "Traveler";
  if (Array.isArray(profiles)) return profiles[0]?.display_name || "Traveler";
  return profiles.display_name || "Traveler";
}

export function mapLoreRow(
  row: LoreDbRow,
  extras: {
    voteCount?: number;
    commentCount?: number;
    votedByMe?: boolean;
  } = {}
): CommunityLoreListItem {
  const category: LoreCategoryId = normalizeLegacyCategory(row.category);
  const status: LoreStatus =
    row.status && isLoreStatus(row.status)
      ? row.status
      : row.is_hub
        ? "accepted"
        : "accepted";
  return {
    id: row.id,
    slug: row.slug || row.id,
    title: row.title,
    body: row.body,
    summary: (row.summary || "").trim(),
    category,
    locationKey: row.location_key ?? null,
    tags: row.tags || [],
    meta: row.meta || {},
    imageUrl: row.image_url ?? null,
    status,
    createdAt: row.created_at,
    authorId: row.author_id,
    authorName: displayName(row.profiles),
    voteCount: extras.voteCount ?? 0,
    commentCount: extras.commentCount ?? 0,
    votedByMe: extras.votedByMe ?? false,
    isHub: Boolean(row.is_hub) || row.slug === "punaab",
  };
}

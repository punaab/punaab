export const LORE_CATEGORIES = [
  {
    id: "characters",
    label: "Characters",
    blurb: "Punaab, villagers, rivals, and faces on the road.",
    placeholder:
      "Who are they? Temper, habits, secrets, how they greet a stranger…",
    symbol: "person",
    downloadLabel: "Download characters",
  },
  {
    id: "art",
    label: "Art",
    blurb: "Community illustrations, portraits, and visions to help inspire others.",
    placeholder: "Describe the piece — who or what it shows, mood, setting…",
    symbol: "frame",
    downloadLabel: "Download art",
  },
  {
    id: "quests",
    label: "Quests",
    blurb: "Jobs, errands, and story hooks worth walking for.",
    placeholder:
      "The ask, who gives it, where it leads, what success (or failure) looks like…",
    symbol: "flag",
    downloadLabel: "Download quests",
  },
  {
    id: "dialogue",
    label: "Dialogue",
    blurb: "Conversation lines, banter, and bark strings.",
    placeholder:
      "Lines he (or they) might say — greetings, refusals, jokes, song intros…",
    symbol: "speech",
    downloadLabel: "Download dialogues",
  },
  {
    id: "places",
    label: "Places",
    blurb: "Towns, inns, ruins, and stretches of road.",
    placeholder:
      "What does it look like, smell like, who gathers there, what rumour sticks…",
    symbol: "house",
    downloadLabel: "Download places",
  },
  {
    id: "items",
    label: "Items",
    blurb: "Wares, relics, instruments, and pack clutter.",
    placeholder:
      "Name it, what it does, where it came from, what a merchant might ask…",
    symbol: "gem",
    downloadLabel: "Download items",
  },
  {
    id: "rumors",
    label: "Rumors",
    blurb: "Roadside gossip and half-true leads.",
    placeholder:
      "What people whisper, who believes it, and what a curious bard might chase…",
    symbol: "whisper",
    downloadLabel: "Download rumors",
  },
  {
    id: "history",
    label: "History",
    blurb: "Past ages, wars, laws, and the wider tale of the valley.",
    placeholder:
      "A scrap of history, a law of the road, a power that still shapes the valley…",
    symbol: "scroll",
    downloadLabel: "Download history",
  },
] as const;

export type LoreCategoryId = (typeof LORE_CATEGORIES)[number]["id"];

export const LORE_CATEGORY_IDS = LORE_CATEGORIES.map((c) => c.id) as [
  LoreCategoryId,
  ...LoreCategoryId[],
];

export const LORE_LINK_KINDS = [
  "related",
  "involves",
  "found_in",
  "given_by",
  "leads_to",
  "mentions",
  "about",
] as const;

export type LoreLinkKind = (typeof LORE_LINK_KINDS)[number];

export const LORE_STATUSES = ["pending", "accepted", "denied"] as const;
export type LoreStatus = (typeof LORE_STATUSES)[number];

export const LORE_SORTS = [
  "votes",
  "newest",
  "oldest",
  "alpha",
  "longest",
] as const;
export type LoreSort = (typeof LORE_SORTS)[number];

export type CommunityLoreLink = {
  toId: string;
  kind: LoreLinkKind;
  note?: string;
};

export type CommunityLoreListItem = {
  id: string;
  slug: string;
  title: string;
  body: string;
  summary: string;
  category: LoreCategoryId;
  locationKey: string | null;
  tags: string[];
  meta: Record<string, unknown>;
  imageUrl: string | null;
  status: LoreStatus;
  createdAt: string;
  authorName: string;
  authorId: string;
  voteCount: number;
  commentCount: number;
  votedByMe: boolean;
  isHub?: boolean;
  /** Accepted entry has an edit waiting on the review queue. */
  hasPendingRevision?: boolean;
};

export type CommunityLoreComment = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorId: string;
};

export type CommunityLoreEdge = {
  from: string;
  to: string;
  kind: LoreLinkKind;
  note: string | null;
};

export type CommunityLoreDetail = CommunityLoreListItem & {
  comments: CommunityLoreComment[];
  linksOut: Array<
    CommunityLoreEdge & { title: string; category: LoreCategoryId }
  >;
  linksIn: Array<
    CommunityLoreEdge & { title: string; category: LoreCategoryId }
  >;
  isOwner?: boolean;
  pendingRevision?: {
    title: string;
    body: string;
    summary: string;
    category: LoreCategoryId;
    locationKey: string | null;
    tags: string[];
    imageUrl: string | null;
    links: Array<{ toId: string; kind: LoreLinkKind; note?: string }>;
    submittedAt: string;
  } | null;
};

export const LORE_TITLE_MAX = 120;
export const LORE_SUMMARY_MAX = 280;
export const LORE_BODY_MAX = 8000;
export const LORE_BODY_MIN = 12;
export const LORE_COMMENT_MAX = 2000;
export const LORE_HUB_SLUG = "punaab";

export function isLoreCategory(value: string): value is LoreCategoryId {
  return (LORE_CATEGORY_IDS as readonly string[]).includes(value);
}

export function isLoreLinkKind(value: string): value is LoreLinkKind {
  return (LORE_LINK_KINDS as readonly string[]).includes(value);
}

/** Human label for a link edge kind (compose UI + detail pages). */
export function loreLinkKindLabel(kind: LoreLinkKind): string {
  switch (kind) {
    case "given_by":
      return "Quest giver";
    case "involves":
      return "Involves";
    case "found_in":
      return "Found in";
    case "leads_to":
      return "Leads to";
    case "mentions":
      return "Mentions";
    case "about":
      return "About";
    case "related":
    default:
      return "Related";
  }
}

export function isLoreSort(value: string): value is LoreSort {
  return (LORE_SORTS as readonly string[]).includes(value);
}

export function isLoreStatus(value: string): value is LoreStatus {
  return (LORE_STATUSES as readonly string[]).includes(value);
}

export function loreCategoryMeta(id: LoreCategoryId) {
  return LORE_CATEGORIES.find((c) => c.id === id) ?? LORE_CATEGORIES[0];
}

export function downloadLabelForCategory(
  category: LoreCategoryId | "all" | null | undefined
): string {
  if (!category || category === "all") return "Download lore pack";
  return loreCategoryMeta(category).downloadLabel;
}

export function normalizeLegacyCategory(
  value: string | null | undefined
): LoreCategoryId {
  if (!value) return "history";
  if (value === "world" || value === "songs") return "history";
  if (isLoreCategory(value)) return value;
  return "history";
}

export function clipPreview(body: string, max = 220): string {
  const trimmed = body.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "lore";
}

export function makeLoreSlug(title: string, idHint?: string): string {
  const suffix = (idHint || Math.random().toString(36).slice(2, 8)).slice(0, 8);
  return `${slugifyTitle(title)}-${suffix}`;
}

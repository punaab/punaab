/**
 * In-memory cache for World hall list fetches.
 *
 * Section switches remount the forum; without this every click flashes
 * "Unfurling…" and waits on the network. With it, a revisited area paints
 * from RAM on the first frame and quietly revalidates in the background.
 */

import type {
  CommunityLoreListItem,
  LoreCategoryId,
  LoreSort,
} from "@/lib/community-lore";

export type LoreListQuery = {
  category?: LoreCategoryId | null;
  sort?: LoreSort | "votes" | "newest";
  q?: string;
  limit?: number;
  mine?: boolean;
};

type CacheEntry = {
  lore: CommunityLoreListItem[];
  at: number;
};

const TTL_MS = 90_000;
const store = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CommunityLoreListItem[]>>();

export function loreListCacheKey(query: LoreListQuery): string {
  return [
    query.mine ? "mine" : "pub",
    query.category ?? "all",
    query.sort ?? "votes",
    (query.q || "").trim().toLowerCase(),
    String(query.limit ?? 200),
  ].join("|");
}

export function peekLoreList(query: LoreListQuery): CommunityLoreListItem[] | null {
  const entry = store.get(loreListCacheKey(query));
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) return entry.lore; // stale-while-revalidate
  return entry.lore;
}

export function putLoreList(
  query: LoreListQuery,
  lore: CommunityLoreListItem[]
): void {
  store.set(loreListCacheKey(query), { lore, at: Date.now() });
}

export function invalidateLoreListCache(): void {
  store.clear();
}

async function fetchLoreListNetwork(
  query: LoreListQuery,
  signal?: AbortSignal
): Promise<CommunityLoreListItem[]> {
  const params = new URLSearchParams({
    sort: query.sort ?? "votes",
  });
  if (query.category) params.set("category", query.category);
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.limit) params.set("limit", String(query.limit));
  if (query.mine) params.set("mine", "1");

  const res = await fetch(`/api/community/lore?${params}`, { signal });
  const data = (await res.json()) as {
    lore?: CommunityLoreListItem[];
    error?: string;
  };
  if (!res.ok && data.error) {
    throw new Error(data.error);
  }
  return (data.lore || []).filter((item) => !item.isHub);
}

/**
 * Returns cached rows immediately when present; always refreshes unless
 * `preferCache` and the entry is still fresh.
 */
export async function loadLoreList(
  query: LoreListQuery,
  opts?: { signal?: AbortSignal; force?: boolean }
): Promise<{ lore: CommunityLoreListItem[]; fromCache: boolean }> {
  const key = loreListCacheKey(query);
  const cached = store.get(key);

  if (cached && !opts?.force) {
    const age = Date.now() - cached.at;
    // Soft revalidate in the background when aging; never block the paint.
    if (age > 8_000 && !inflight.has(key)) {
      const p = fetchLoreListNetwork(query)
        .then((lore) => {
          putLoreList(query, lore);
          return lore;
        })
        .catch(() => cached.lore)
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return { lore: cached.lore, fromCache: true };
  }

  let pending = opts?.force ? undefined : inflight.get(key);
  if (!pending) {
    pending = fetchLoreListNetwork(query, opts?.signal)
      .then((lore) => {
        putLoreList(query, lore);
        return lore;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }

  const lore = await pending;
  return { lore, fromCache: false };
}

/** Warm the cache for a section so the next click paints instantly. */
export function prefetchLoreList(query: LoreListQuery): void {
  const key = loreListCacheKey(query);
  if (store.has(key) && Date.now() - (store.get(key)?.at ?? 0) < TTL_MS) {
    return;
  }
  if (inflight.has(key)) return;
  const p = fetchLoreListNetwork(query)
    .then((lore) => {
      putLoreList(query, lore);
      return lore;
    })
    .catch(() => [] as CommunityLoreListItem[])
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
}

/** Prefetch every World area (default sort) after first paint. */
export function prefetchAllWorldSections(sort: LoreSort = "votes"): void {
  if (typeof window === "undefined") return;
  const run = () => {
    prefetchLoreList({ sort: "votes", limit: 12 });
    prefetchLoreList({ sort: "newest", limit: 12 });
    for (const area of [
      "characters",
      "art",
      "quests",
      "dialogue",
      "places",
      "items",
      "rumors",
      "history",
    ] as LoreCategoryId[]) {
      prefetchLoreList({ category: area, sort });
    }
  };
  // Read the function off `window` rather than testing `"requestIdleCallback" in
  // window`. TypeScript's DOM library declares the method unconditionally, so
  // the `in` check narrows to *always true* and the fallback branch becomes
  // unreachable — which types `window` as `never` there and fails the build on
  // the perfectly ordinary `setTimeout` inside it. Safari still has no
  // requestIdleCallback, so the branch is real even though the types disagree.
  const idle = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
    }
  ).requestIdleCallback;

  if (typeof idle === "function") idle.call(window, run, { timeout: 1200 });
  else window.setTimeout(run, 400);
}

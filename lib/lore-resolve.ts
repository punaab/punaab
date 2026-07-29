import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureMapPlaceLore } from "@/lib/map-place-lore";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Resolve a lore URL param (UUID or slug like `place-crowfoot`) to the row id.
 * Chart place slugs are seeded on first miss via `ensureMapPlaceLore`.
 */
export async function resolveLoreId(
  supabase: SupabaseClient,
  idOrSlug: string
): Promise<string | null> {
  const key = idOrSlug.trim();
  if (!key) return null;

  if (looksLikeUuid(key)) {
    const { data } = await supabase
      .from("community_lore")
      .select("id")
      .eq("id", key)
      .maybeSingle();
    return data?.id ?? null;
  }

  if (key.startsWith("place-")) {
    await ensureMapPlaceLore(supabase);
  }

  const { data } = await supabase
    .from("community_lore")
    .select("id")
    .eq("slug", key)
    .maybeSingle();
  return data?.id ?? null;
}

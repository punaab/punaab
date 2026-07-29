import type { SupabaseClient } from "@supabase/supabase-js";
import { LORE_HUB_SLUG } from "@/lib/community-lore";

export type LoreHubRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string;
  body: string;
  is_hub: boolean;
};

/** Ensure the Punaab hub row exists. Safe on every graph/export request. */
export async function ensureLoreHub(
  supabase: SupabaseClient
): Promise<LoreHubRow | null> {
  const existing = await supabase
    .from("community_lore")
    .select("id, slug, title, category, summary, body, is_hub")
    .or(`slug.eq.${LORE_HUB_SLUG},is_hub.eq.true`)
    .limit(1)
    .maybeSingle();

  if (existing.data) {
    return existing.data as LoreHubRow;
  }

  let profileId: string | null = null;
  const system = await supabase
    .from("profiles")
    .select("id")
    .eq("clerk_user_id", "system:punaab-hub")
    .maybeSingle();

  if (system.data?.id) {
    profileId = system.data.id;
  } else {
    const created = await supabase
      .from("profiles")
      .insert({
        clerk_user_id: "system:punaab-hub",
        display_name: "Punaab",
      })
      .select("id")
      .single();
    profileId = created.data?.id ?? null;
  }

  if (!profileId) return null;

  const inserted = await supabase
    .from("community_lore")
    .insert({
      author_id: profileId,
      category: "characters",
      title: "Punaab the Traveling Bard",
      body:
        "The wandering bard at the centre of the valley's tales. He walks the roads with a lute, a pack, and stories gathered from every hamlet that will still open a door.",
      summary: "Smart traveling bard — hub of the community lore graph.",
      slug: LORE_HUB_SLUG,
      tags: ["hub", "bard"],
      meta: { role: "hub" },
      is_hub: true,
      status: "accepted",
    })
    .select("id, slug, title, category, summary, body, is_hub")
    .single();

  return (inserted.data as LoreHubRow) ?? null;
}

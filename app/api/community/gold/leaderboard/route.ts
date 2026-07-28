import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export type GoldLeaderRow = {
  profileId: string;
  displayName: string;
  title: string | null;
  gold: number;
};

/**
 * Public World earnings board — ranked by gold, labeled with the traveler
 * character name from `player_characters` (not the Clerk login username).
 */
export async function GET() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ leaders: [] as GoldLeaderRow[] });
  }

  const { data: balances, error } = await supabase
    .from("gold_balances")
    .select("profile_id, balance")
    .order("balance", { ascending: false })
    .limit(50);

  if (!error && balances && balances.length > 0) {
    const ids = balances.map((row) => row.profile_id as string);
    const [{ data: characters }, { data: profiles }] = await Promise.all([
      supabase
        .from("player_characters")
        .select("profile_id, display_name, title")
        .in("profile_id", ids),
      supabase
        .from("profiles")
        .select("id, clerk_user_id")
        .in("id", ids),
    ]);

    const systemIds = new Set(
      (profiles || [])
        .filter((p) => String(p.clerk_user_id || "").startsWith("system:"))
        .map((p) => p.id as string)
    );
    const characterMap = new Map(
      (characters || []).map((c) => [
        c.profile_id as string,
        {
          name: String(c.display_name || "").trim(),
          title: String(c.title || "").trim() || null,
        },
      ])
    );

    const leaders: GoldLeaderRow[] = balances
      .map((row) => {
        const id = row.profile_id as string;
        if (systemIds.has(id)) return null;
        const character = characterMap.get(id);
        // Only travelers who created a character appear on the board.
        if (!character?.name) return null;
        return {
          profileId: id,
          displayName: character.name,
          title: character.title,
          gold: Number(row.balance ?? 0),
        };
      })
      .filter((row): row is GoldLeaderRow => Boolean(row));

    return NextResponse.json({ leaders });
  }

  // Gold table missing or empty — list created characters so the board still
  // shows traveler names (at 0 gold) instead of login usernames.
  const { data: characters } = await supabase
    .from("player_characters")
    .select("profile_id, display_name, title, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const leaders: GoldLeaderRow[] = (characters || [])
    .map((c) => {
      const name = String(c.display_name || "").trim();
      if (!name) return null;
      return {
        profileId: c.profile_id as string,
        displayName: name,
        title: String(c.title || "").trim() || null,
        gold: 0,
      };
    })
    .filter((row): row is GoldLeaderRow => Boolean(row));

  return NextResponse.json({ leaders });
}

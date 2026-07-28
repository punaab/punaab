import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { GOLD_PER_UPVOTE, grantGold } from "@/lib/gold";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to upvote." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const { profile } = await ensureProfile(userId);
  if (profile.id === "local") {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const { data: lore } = await supabase
    .from("community_lore")
    .select("id, author_id")
    .eq("id", id)
    .maybeSingle();

  if (!lore) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const existing = await supabase
    .from("community_lore_votes")
    .select("lore_id")
    .eq("lore_id", id)
    .eq("voter_id", profile.id)
    .maybeSingle();

  if (existing.data) {
    await supabase
      .from("community_lore_votes")
      .delete()
      .eq("lore_id", id)
      .eq("voter_id", profile.id);

    if (lore.author_id && lore.author_id !== profile.id) {
      try {
        await grantGold(supabase, {
          profileId: lore.author_id,
          delta: -GOLD_PER_UPVOTE,
          reason: "lore_upvote_revoke",
          idempotencyKey: `upvote_revoke:${id}:${profile.id}:${Date.now()}`,
          meta: { lore_id: id, voter_id: profile.id },
        });
      } catch {
        // Balance floor handled inside grantGold.
      }
    }
  } else {
    const { error } = await supabase.from("community_lore_votes").insert({
      lore_id: id,
      voter_id: profile.id,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (lore.author_id && lore.author_id !== profile.id) {
      try {
        await grantGold(supabase, {
          profileId: lore.author_id,
          delta: GOLD_PER_UPVOTE,
          reason: "lore_upvote",
          idempotencyKey: `upvote:${id}:${profile.id}:${Date.now()}`,
          meta: { lore_id: id, voter_id: profile.id },
        });
      } catch {
        // Don't fail the vote if gold grant hiccups.
      }
    }
  }

  const { count } = await supabase
    .from("community_lore_votes")
    .select("*", { count: "exact", head: true })
    .eq("lore_id", id);

  return NextResponse.json({
    votedByMe: !existing.data,
    voteCount: count || 0,
  });
}

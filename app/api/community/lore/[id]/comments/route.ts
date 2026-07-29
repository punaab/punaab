import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { LORE_COMMENT_MAX } from "@/lib/community-lore";
import { resolveLoreId } from "@/lib/lore-resolve";
import { ensureProfile } from "@/lib/profiles";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: idOrSlug } = await context.params;
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to comment." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const { profile } = await ensureProfile(userId);
  if (profile.id === "local") {
    return NextResponse.json({ error: "Database unavailable." }, { status: 503 });
  }

  const payload = (await req.json().catch(() => null)) as { body?: string } | null;
  const text = (payload?.body || "").trim();
  if (text.length < 1 || text.length > LORE_COMMENT_MAX) {
    return NextResponse.json(
      { error: `Comment needs 1–${LORE_COMMENT_MAX} characters.` },
      { status: 400 }
    );
  }

  const id = await resolveLoreId(supabase, idOrSlug);
  if (!id) {
    return NextResponse.json({ error: "Lore not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("community_lore_comments")
    .insert({
      lore_id: id,
      author_id: profile.id,
      body: text,
    })
    .select("id, body, created_at, author_id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Could not post comment." },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      comment: {
        id: data.id,
        body: data.body,
        createdAt: data.created_at,
        authorId: data.author_id,
        authorName: profile.display_name,
      },
    },
    { status: 201 }
  );
}

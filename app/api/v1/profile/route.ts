import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isLocale } from "@/lib/i18n";

const bodySchema = z.object({
  locale: z.string(),
  profession: z.string().optional(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success || !isLocale(parsed.data.locale)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const user = await currentUser();
  const displayName =
    user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || "Traveler";

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    // Soft success until Supabase is wired on Vercel
    return NextResponse.json({
      ok: true,
      source: "local",
      profile: {
        clerk_user_id: userId,
        display_name: displayName,
        locale: parsed.data.locale,
        profession: parsed.data.profession ?? null,
      },
    });
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .upsert(
      {
        clerk_user_id: userId,
        display_name: displayName,
        locale: parsed.data.locale,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (parsed.data.profession) {
    await supabase.from("player_professions").upsert({
      profile_id: profile.id,
      profession_id: parsed.data.profession,
      reputation: 0,
    });
  }

  return NextResponse.json({ ok: true, source: "supabase", profile });
}

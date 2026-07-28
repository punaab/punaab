import { currentUser } from "@clerk/nextjs/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";

export type Profile = {
  id: string;
  clerk_user_id: string;
  display_name: string;
  plan_code: string;
  stripe_customer_id: string | null;
};

export async function ensureProfile(clerkUserId: string): Promise<{
  profile: Profile;
  supabase: SupabaseClient | null;
  created: boolean;
}> {
  const supabase = getSupabaseAdmin();
  const user = await currentUser();
  const displayName =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    "Developer";

  if (!supabase) {
    return {
      created: false,
      supabase: null,
      profile: {
        id: "local",
        clerk_user_id: clerkUserId,
        display_name: displayName,
        plan_code: "free",
        stripe_customer_id: null,
      },
    };
  }

  const existing = await supabase
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (existing.data) {
    const row = existing.data as Profile & { plan_code?: string };
    return {
      profile: {
        ...row,
        plan_code: row.plan_code || "free",
      },
      supabase,
      created: false,
    };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .insert({
      clerk_user_id: clerkUserId,
      display_name: displayName,
      plan_code: "free",
    })
    .select("*")
    .single();

  if (error || !profile) {
    throw new Error(error?.message || "Failed to create profile");
  }

  await grantCredits(supabase, {
    profileId: profile.id,
    delta: 500,
    reason: "free_monthly_grant",
    idempotencyKey: `free_grant:${profile.id}:signup`,
  });

  return { profile: profile as Profile, supabase, created: true };
}

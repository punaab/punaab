import { currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ensureGoldWallet } from "@/lib/gold";
import { claimReferral, ensureReferralCode } from "@/lib/referrals";

export type Profile = {
  id: string;
  clerk_user_id: string;
  display_name: string;
  referral_code?: string | null;
  referred_by?: string | null;
  /** Legacy AI-plan field — no longer stored. */
  plan_code?: string;
  /** Legacy Stripe field — no longer stored. */
  stripe_customer_id?: string | null;
};

export async function ensureProfile(clerkUserId: string): Promise<{
  profile: Profile;
  supabase: SupabaseClient | null;
  created: boolean;
}> {
  const supabase = getSupabaseAdmin();
  const user = await currentUser();
  const displayName =
    user?.username ||
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    "Traveler";

  if (!supabase) {
    return {
      created: false,
      supabase: null,
      profile: {
        id: "local",
        clerk_user_id: clerkUserId,
        display_name: displayName,
      },
    };
  }

  const existing = await supabase
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  if (existing.data) {
    const row = existing.data as Profile;
    // Keep the World Earnings Board label in sync with the Clerk login name.
    if (displayName && displayName !== row.display_name) {
      await supabase
        .from("profiles")
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      row.display_name = displayName;
    }
    try {
      const referralCode = await ensureReferralCode(
        supabase,
        row.id,
        clerkUserId
      );
      await ensureGoldWallet(supabase, row.id);
      await maybeClaimReferralFromCookie(supabase, row);
      return {
        profile: { ...row, referral_code: referralCode },
        supabase,
        created: false,
      };
    } catch {
      return { profile: row, supabase, created: false };
    }
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .insert({
      clerk_user_id: clerkUserId,
      display_name: displayName,
    })
    .select("*")
    .single();

  if (error || !profile) {
    throw new Error(error?.message || "Failed to create profile");
  }

  let referralCode: string | null = null;
  try {
    referralCode = await ensureReferralCode(
      supabase,
      profile.id,
      clerkUserId
    );
    await ensureGoldWallet(supabase, profile.id);
    await maybeClaimReferralFromCookie(supabase, profile as Profile);
  } catch {
    // Gold/referral tables may not be migrated yet.
  }

  return {
    profile: {
      ...(profile as Profile),
      referral_code: referralCode,
    },
    supabase,
    created: true,
  };
}

async function maybeClaimReferralFromCookie(
  supabase: SupabaseClient,
  profile: Profile
) {
  if (profile.referred_by || profile.id === "local") return;
  try {
    const jar = await cookies();
    const raw = jar.get("punaab_ref")?.value;
    if (!raw) return;
    const code = decodeURIComponent(raw).trim().toUpperCase();
    if (!code) return;
    await claimReferral(supabase, {
      newProfileId: profile.id,
      referralCode: code,
    });
  } catch {
    // Cookie read can fail outside a request context.
  }
}

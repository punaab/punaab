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
  // Prefer a handle over legal name — Archive credits should read as the
  // traveler identity (e.g. Punaab), not Clerk's fullName.
  const displayName =
    user?.username ||
    user?.firstName ||
    user?.primaryEmailAddress?.emailAddress?.split("@")[0] ||
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
    // Don't keep re-importing Clerk fullName — that was painting legal names
    // onto Archive credits. Only upgrade a leftover full name when we have a
    // username, or rename the known site credit to Punaab.
    let next: string | null = null;
    if (/\s/.test(row.display_name) && user?.username) {
      next = user.username;
    } else if (row.display_name.trim().toLowerCase() === "sean layton") {
      next = "Punaab";
    }
    if (next && next !== row.display_name) {
      await supabase
        .from("profiles")
        .update({ display_name: next, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      row.display_name = next;
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
    const result = await claimReferral(supabase, {
      newProfileId: profile.id,
      referralCode: code,
    });
    // Clear once claimed or already attached so we don't keep retrying a bad
    // seal on every ensureProfile call.
    if (result.claimed || result.reason === "already_referred") {
      jar.delete("punaab_ref");
    }
  } catch {
    // Cookie read can fail outside a request context.
  }
}

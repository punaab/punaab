import type { SupabaseClient } from "@supabase/supabase-js";
import { GOLD_PER_REFERRAL, grantGold } from "@/lib/gold";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferralCode(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  let code = "";
  let n = hash || 1;
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[n % CODE_ALPHABET.length];
    n = Math.floor(n / CODE_ALPHABET.length) || (hash + i + 7);
  }
  return code;
}

export async function ensureReferralCode(
  supabase: SupabaseClient,
  profileId: string,
  clerkUserId: string
): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", profileId)
    .maybeSingle();

  if (data?.referral_code) return data.referral_code as string;

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateReferralCode(
      attempt === 0
        ? clerkUserId + profileId
        : `${clerkUserId}:${profileId}:${attempt}`
    );

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({
        referral_code: code,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profileId)
      .is("referral_code", null)
      .select("referral_code")
      .maybeSingle();

    if (updated?.referral_code) return updated.referral_code as string;

    // Unique collision on the code — try another seal.
    if (error && error.code !== "23505") {
      // Fall through to a re-read; a concurrent writer may have won.
    }

    const { data: again } = await supabase
      .from("profiles")
      .select("referral_code")
      .eq("id", profileId)
      .maybeSingle();
    if (again?.referral_code) return again.referral_code as string;
  }

  throw new Error("Could not mint a guild invite code");
}

/**
 * Attach a new traveler to an inviter and pay the inviter gold once.
 * Accepts either a ?ref= cookie code or a pasted guild seal.
 */
export async function claimReferral(
  supabase: SupabaseClient,
  params: {
    newProfileId: string;
    referralCode: string;
  }
): Promise<{ claimed: boolean; referrerId?: string; reason?: string }> {
  const code = params.referralCode.trim().toUpperCase();
  if (!code || code.length < 4) {
    return { claimed: false, reason: "invalid_code" };
  }

  const { data: invitee } = await supabase
    .from("profiles")
    .select("id, referred_by")
    .eq("id", params.newProfileId)
    .maybeSingle();

  if (!invitee) return { claimed: false, reason: "missing_invitee" };
  if (invitee.referred_by) {
    return { claimed: false, reason: "already_referred" };
  }

  const { data: referrer } = await supabase
    .from("profiles")
    .select("id")
    .eq("referral_code", code)
    .maybeSingle();

  if (!referrer || referrer.id === params.newProfileId) {
    return { claimed: false, reason: "unknown_code" };
  }

  const { data: attached, error } = await supabase
    .from("profiles")
    .update({
      referred_by: referrer.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.newProfileId)
    .is("referred_by", null)
    .select("id")
    .maybeSingle();

  if (error || !attached) {
    return { claimed: false, reason: "attach_failed" };
  }

  try {
    await grantGold(supabase, {
      profileId: referrer.id,
      delta: GOLD_PER_REFERRAL,
      reason: "referral_invite",
      idempotencyKey: `referral:${referrer.id}:${params.newProfileId}`,
      meta: { invitee_id: params.newProfileId, code },
    });
  } catch {
    // Link already stuck; idempotent ledger insert covers retries.
  }

  return { claimed: true, referrerId: referrer.id };
}

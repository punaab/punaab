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

  let code = generateReferralCode(clerkUserId + profileId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase
      .from("profiles")
      .update({ referral_code: code })
      .eq("id", profileId)
      .is("referral_code", null);

    if (!error) return code;

    // Collision — twist the seed and retry.
    code = generateReferralCode(`${clerkUserId}:${profileId}:${attempt}`);
  }

  const { data: again } = await supabase
    .from("profiles")
    .select("referral_code")
    .eq("id", profileId)
    .maybeSingle();
  return (again?.referral_code as string) || code;
}

/**
 * Attach a new traveler to an inviter and pay the inviter gold once.
 */
export async function claimReferral(
  supabase: SupabaseClient,
  params: {
    newProfileId: string;
    referralCode: string;
  }
): Promise<{ claimed: boolean; referrerId?: string }> {
  const code = params.referralCode.trim().toUpperCase();
  if (!code) return { claimed: false };

  const { data: invitee } = await supabase
    .from("profiles")
    .select("id, referred_by")
    .eq("id", params.newProfileId)
    .maybeSingle();

  if (!invitee || invitee.referred_by) return { claimed: false };

  const { data: referrer } = await supabase
    .from("profiles")
    .select("id")
    .eq("referral_code", code)
    .maybeSingle();

  if (!referrer || referrer.id === params.newProfileId) {
    return { claimed: false };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ referred_by: referrer.id })
    .eq("id", params.newProfileId)
    .is("referred_by", null);

  if (error) return { claimed: false };

  await grantGold(supabase, {
    profileId: referrer.id,
    delta: GOLD_PER_REFERRAL,
    reason: "referral_invite",
    idempotencyKey: `referral:${referrer.id}:${params.newProfileId}`,
    meta: { invitee_id: params.newProfileId, code },
  });

  return { claimed: true, referrerId: referrer.id };
}

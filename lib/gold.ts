import type { SupabaseClient } from "@supabase/supabase-js";

/** Gold paid to a lore author when someone upvotes their post. */
export const GOLD_PER_UPVOTE = 5;

/** Gold paid to the inviter when a referred traveler creates an account. */
export const GOLD_PER_REFERRAL = 50;

/** Starter gold when a traveler first opens their purse. */
export const GOLD_SIGNUP_BONUS = 10;

export type GoldSummary = {
  balance: number;
  lifetimeEarned: number;
};

export async function getGoldBalance(
  supabase: SupabaseClient,
  profileId: string
) {
  const summary = await getGoldSummary(supabase, profileId);
  return summary.balance;
}

export async function getGoldSummary(
  supabase: SupabaseClient,
  profileId: string
): Promise<GoldSummary> {
  const { data } = await supabase
    .from("gold_balances")
    .select("balance, lifetime_earned")
    .eq("profile_id", profileId)
    .maybeSingle();
  return {
    balance: Number(data?.balance ?? 0),
    lifetimeEarned: Number(data?.lifetime_earned ?? 0),
  };
}

export async function countInvitees(
  supabase: SupabaseClient,
  profileId: string
): Promise<number> {
  const { count } = await supabase
    .from("profiles")
    .select("*", { count: "exact", head: true })
    .eq("referred_by", profileId);
  return count ?? 0;
}

export async function grantGold(
  supabase: SupabaseClient,
  params: {
    profileId: string;
    delta: number;
    reason: string;
    idempotencyKey: string;
    meta?: Record<string, unknown>;
  }
) {
  const current = await getGoldSummary(supabase, params.profileId);
  const next = current.balance + params.delta;
  if (next < 0) {
    // Soft-fail clawbacks that would go below zero (e.g. already spent).
    if (params.delta < 0) return current.balance;
    throw new Error("Insufficient gold");
  }

  const { error: ledgerError } = await supabase.from("gold_ledger").insert({
    profile_id: params.profileId,
    delta: params.delta,
    reason: params.reason,
    idempotency_key: params.idempotencyKey,
    meta: params.meta ?? {},
  });
  if (ledgerError) {
    if (ledgerError.code === "23505") return current.balance;
    throw new Error(ledgerError.message);
  }

  const lifetimeEarned =
    current.lifetimeEarned + (params.delta > 0 ? params.delta : 0);

  await supabase.from("gold_balances").upsert({
    profile_id: params.profileId,
    balance: next,
    lifetime_earned: lifetimeEarned,
    updated_at: new Date().toISOString(),
  });

  return next;
}

export async function ensureGoldWallet(
  supabase: SupabaseClient,
  profileId: string
) {
  const summary = await getGoldSummary(supabase, profileId);
  if (summary.balance > 0 || summary.lifetimeEarned > 0) {
    return summary.balance;
  }

  const { data } = await supabase
    .from("gold_balances")
    .select("balance, lifetime_earned")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (data) return Number(data.balance ?? 0);

  return grantGold(supabase, {
    profileId,
    delta: GOLD_SIGNUP_BONUS,
    reason: "signup_bonus",
    idempotencyKey: `gold_signup:${profileId}`,
  });
}

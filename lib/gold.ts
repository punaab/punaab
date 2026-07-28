import type { SupabaseClient } from "@supabase/supabase-js";

/** Gold paid to a lore author when someone upvotes their post. */
export const GOLD_PER_UPVOTE = 5;

/** Gold paid to the inviter when a referred traveler creates an account. */
export const GOLD_PER_REFERRAL = 50;

/** Starter gold when a traveler first opens their wallet. */
export const GOLD_SIGNUP_BONUS = 10;

export async function getGoldBalance(
  supabase: SupabaseClient,
  profileId: string
) {
  const { data } = await supabase
    .from("gold_balances")
    .select("balance")
    .eq("profile_id", profileId)
    .maybeSingle();
  return Number(data?.balance ?? 0);
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
  const current = await getGoldBalance(supabase, params.profileId);
  const next = current + params.delta;
  if (next < 0) {
    // Soft-fail clawbacks that would go below zero (e.g. already spent).
    if (params.delta < 0) return current;
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
    if (ledgerError.code === "23505") return current;
    throw new Error(ledgerError.message);
  }

  await supabase.from("gold_balances").upsert({
    profile_id: params.profileId,
    balance: next,
    updated_at: new Date().toISOString(),
  });

  return next;
}

export async function ensureGoldWallet(
  supabase: SupabaseClient,
  profileId: string
) {
  const balance = await getGoldBalance(supabase, profileId);
  if (balance > 0) return balance;

  const { data } = await supabase
    .from("gold_balances")
    .select("balance")
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

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getCreditBalance(
  supabase: SupabaseClient,
  profileId: string
) {
  const { data } = await supabase
    .from("credit_balances")
    .select("balance")
    .eq("profile_id", profileId)
    .maybeSingle();
  return Number(data?.balance ?? 0);
}

export async function grantCredits(
  supabase: SupabaseClient,
  params: {
    profileId: string;
    delta: number;
    reason: string;
    idempotencyKey: string;
    projectId?: string | null;
    meta?: Record<string, unknown>;
  }
) {
  const current = await getCreditBalance(supabase, params.profileId);
  const next = current + params.delta;
  if (next < 0) {
    throw new Error("Insufficient credits");
  }

  const { error: ledgerError } = await supabase.from("credit_ledger").insert({
    profile_id: params.profileId,
    project_id: params.projectId ?? null,
    delta: params.delta,
    reason: params.reason,
    idempotency_key: params.idempotencyKey,
    meta: params.meta ?? {},
  });
  if (ledgerError) {
    if (ledgerError.code === "23505") return current;
    throw new Error(ledgerError.message);
  }

  await supabase.from("credit_balances").upsert({
    profile_id: params.profileId,
    balance: next,
    updated_at: new Date().toISOString(),
  });

  return next;
}

export async function burnCredits(
  supabase: SupabaseClient,
  params: {
    profileId: string;
    cost: number;
    reason: string;
    projectId?: string | null;
    meta?: Record<string, unknown>;
  }
) {
  return grantCredits(supabase, {
    profileId: params.profileId,
    delta: -Math.abs(params.cost),
    reason: params.reason,
    idempotencyKey: `${params.reason}:${params.profileId}:${Date.now()}:${randomSuffix()}`,
    projectId: params.projectId,
    meta: params.meta,
  });
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

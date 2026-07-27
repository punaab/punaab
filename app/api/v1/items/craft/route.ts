import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const json = form ? null : await req.json().catch(() => null);
  const definitionId =
    (form?.get("definition_id") as string | null) ||
    (json?.definition_id as string | undefined) ||
    "tool_quill_001";

  const idempotencyKey = `craft:${userId}:${definitionId}:${new Date().toISOString().slice(0, 13)}`;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.redirect(new URL("/forge?crafted=local", req.url));
  }

  const user = await currentUser();
  const displayName =
    user?.fullName || user?.username || user?.primaryEmailAddress?.emailAddress || "Traveler";

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .upsert(
      {
        clerk_user_id: userId,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_user_id" }
    )
    .select("*")
    .single();

  if (profileError || !profile) {
    return NextResponse.json(
      { error: profileError?.message || "Profile error" },
      { status: 500 }
    );
  }

  const { error: ledgerError } = await supabase.from("ledger_entries").insert({
    profile_id: profile.id,
    currency_code: "ember",
    delta: -1,
    reason: `craft:${definitionId}`,
    idempotency_key: idempotencyKey,
    meta: { definition_id: definitionId },
  });

  if (ledgerError && !ledgerError.message.includes("duplicate")) {
    // Allow craft even if balance table not funded yet; still record attempt
  }

  const { data: instance, error: instanceError } = await supabase
    .from("item_instances")
    .insert({
      definition_id: definitionId,
      owner_id: profile.id,
      origin_realm: "pixelgrew_web",
      authenticity_status: "crafted",
      provenance: [
        {
          at: new Date().toISOString(),
          event: "crafted",
          realm: "pixelgrew_web",
        },
      ],
    })
    .select("*")
    .single();

  if (instanceError) {
    return NextResponse.json({ error: instanceError.message }, { status: 500 });
  }

  if (form) {
    return NextResponse.redirect(new URL(`/forge?crafted=${instance.id}`, req.url));
  }

  return NextResponse.json({ ok: true, instance });
}

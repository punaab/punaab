import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/profiles";
import { claimReferral } from "@/lib/referrals";

const bodySchema = z.object({
  code: z.string().trim().min(4).max(16),
});

/**
 * Let a traveler paste a guild invite code if they didn't arrive via ?ref=.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter a guild invite code (4–16 characters)." },
      { status: 400 }
    );
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json(
      { error: "Purse is offline — try again after the guild hall reconnects." },
      { status: 503 }
    );
  }

  if (profile.referred_by) {
    return NextResponse.json(
      { error: "Your papers already name a guild sponsor.", claimed: false },
      { status: 409 }
    );
  }

  const result = await claimReferral(supabase, {
    newProfileId: profile.id,
    referralCode: parsed.data.code,
  });

  if (!result.claimed) {
    return NextResponse.json(
      {
        error:
          "That seal is not known — check the code, or ask your friend for a fresh invite link.",
        claimed: false,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    claimed: true,
    referrerId: result.referrerId,
  });
}

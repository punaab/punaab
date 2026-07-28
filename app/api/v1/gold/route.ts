import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getShareAppUrl } from "@/lib/app-url";
import { ensureProfile } from "@/lib/profiles";
import {
  getGoldBalance,
  GOLD_PER_REFERRAL,
  GOLD_PER_UPVOTE,
} from "@/lib/gold";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { profile, supabase } = await ensureProfile(userId);
  if (!supabase || profile.id === "local") {
    return NextResponse.json({
      balance: 0,
      referralCode: null,
      invitePath: null,
      inviteUrl: null,
      rates: { upvote: GOLD_PER_UPVOTE, referral: GOLD_PER_REFERRAL },
    });
  }

  const balance = await getGoldBalance(supabase, profile.id);
  const code = profile.referral_code ?? null;
  const invitePath = code ? `/?ref=${code}` : null;
  const inviteUrl = invitePath ? `${getShareAppUrl()}${invitePath}` : null;

  return NextResponse.json({
    balance,
    referralCode: code,
    invitePath,
    inviteUrl,
    rates: { upvote: GOLD_PER_UPVOTE, referral: GOLD_PER_REFERRAL },
  });
}

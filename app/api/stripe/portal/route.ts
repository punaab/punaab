import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { ensureProfile } from "@/lib/profiles";
import { getAppUrl, getStripe } from "@/lib/stripe";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }
  const { profile } = await ensureProfile(userId);
  if (!profile.stripe_customer_id) {
    return NextResponse.json(
      { error: "No billing customer yet — subscribe first." },
      { status: 400 }
    );
  }
  const portal = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${getAppUrl()}/dashboard/billing`,
  });
  return NextResponse.json({ url: portal.url });
}

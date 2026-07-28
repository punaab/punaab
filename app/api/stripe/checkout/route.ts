import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureProfile } from "@/lib/profiles";
import { PLANS, getStripePriceId } from "@/lib/plans";
import { getAppUrl, getStripe } from "@/lib/stripe";

const schema = z.object({
  plan_code: z.enum(["creator", "studio"]),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const plan = PLANS.find((p) => p.code === parsed.data.plan_code);
  if (!plan) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  const priceId = getStripePriceId(plan);
  if (!priceId) {
    return NextResponse.json(
      { error: `Missing ${plan.envPriceId} in environment` },
      { status: 503 }
    );
  }

  const { profile } = await ensureProfile(userId);
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${getAppUrl()}/dashboard/billing?checkout=success`,
    cancel_url: `${getAppUrl()}/dashboard/billing?checkout=cancel`,
    customer: profile.stripe_customer_id || undefined,
    customer_email: profile.stripe_customer_id ? undefined : email,
    metadata: {
      clerk_user_id: userId,
      profile_id: profile.id,
      plan_code: plan.code,
    },
    subscription_data: {
      metadata: {
        clerk_user_id: userId,
        profile_id: profile.id,
        plan_code: plan.code,
      },
    },
  });

  return NextResponse.json({ url: session.url });
}

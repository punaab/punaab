import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { PLANS, type PlanCode } from "@/lib/plans";

export const runtime = "nodejs";

function creditsForPlan(plan: PlanCode) {
  const def = PLANS.find((p) => p.code === plan);
  return typeof def?.creditsMonthly === "number" ? def.creditsMonthly : 0;
}

async function syncSubscription(sub: Stripe.Subscription) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const profileId = sub.metadata?.profile_id;
  const planCode = (sub.metadata?.plan_code || "creator") as PlanCode;
  if (!profileId) return;

  const active = ["active", "trialing"].includes(sub.status);
  await supabase.from("subscriptions").upsert(
    {
      profile_id: profileId,
      plan_code: planCode,
      stripe_subscription_id: sub.id,
      status: sub.status,
      current_period_end: sub.items.data[0]?.current_period_end
        ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" }
  );

  await supabase
    .from("profiles")
    .update({
      plan_code: active ? planCode : "free",
      stripe_customer_id: String(sub.customer),
      updated_at: new Date().toISOString(),
    })
    .eq("id", profileId);

  if (active) {
    const amount = creditsForPlan(planCode);
    if (amount > 0) {
      await grantCredits(supabase, {
        profileId,
        delta: amount,
        reason: `plan_grant_${planCode}`,
        idempotencyKey: `plan_grant:${sub.id}:${sub.items.data[0]?.current_period_end || "0"}`,
        meta: { plan: planCode },
      });
    }
  }
}

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  try {
    if (secret && sig) {
      event = stripe.webhooks.constructEvent(body, sig, secret);
    } else {
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid signature" },
      { status: 400 }
    );
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription));
        if (!sub.metadata?.profile_id && session.metadata?.profile_id) {
          await stripe.subscriptions.update(sub.id, {
            metadata: {
              ...sub.metadata,
              profile_id: session.metadata.profile_id,
              plan_code: session.metadata.plan_code || "",
              clerk_user_id: session.metadata.clerk_user_id || "",
            },
          });
          sub.metadata = {
            ...sub.metadata,
            profile_id: session.metadata.profile_id,
            plan_code: session.metadata.plan_code || "",
          };
        }
        const supabase = getSupabaseAdmin();
        if (supabase && session.customer && session.metadata?.profile_id) {
          await supabase
            .from("profiles")
            .update({ stripe_customer_id: String(session.customer) })
            .eq("id", session.metadata.profile_id);
        }
        await syncSubscription(sub);
      }
    }
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncSubscription(event.data.object as Stripe.Subscription);
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}

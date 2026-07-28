import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  CheckoutButton,
  PortalButton,
} from "@/components/dashboard/BillingButtons";
import { ensureProfile } from "@/lib/profiles";
import { getCreditBalance } from "@/lib/credits";
import { PLANS } from "@/lib/plans";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const params = await searchParams;
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);
  const credits =
    supabase && profile.id !== "local"
      ? await getCreditBalance(supabase, profile.id)
      : 500;

  return (
    <DashboardShell title="Billing" subtitle="Plans, credits, and invoices.">
      {params.checkout === "success" ? (
        <p className="banner-ok">Subscription started. Credits will sync via webhook.</p>
      ) : null}
      {params.checkout === "cancel" ? (
        <p className="banner-err">Checkout canceled.</p>
      ) : null}

      <div className="card-grid">
        <article className="card">
          <p className="meta">current plan</p>
          <h2>{profile.plan_code}</h2>
          <p>{credits.toLocaleString()} credits remaining</p>
          <PortalButton />
        </article>
      </div>

      <div className="pricing-grid">
        {PLANS.filter((p) => p.code !== "enterprise").map((plan) => (
          <article
            key={plan.code}
            className={`card pricing-card${plan.highlighted ? " highlighted" : ""}`}
          >
            <p className="meta">{plan.name}</p>
            <p className="price-tag">{plan.priceLabel}</p>
            <ul>
              {plan.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div style={{ marginTop: "1rem" }}>
              {plan.code === "free" ? (
                <span className="meta">Current free tier</span>
              ) : plan.code === "creator" || plan.code === "studio" ? (
                <CheckoutButton
                  planCode={plan.code}
                  label={`Subscribe · ${plan.priceLabel}`}
                />
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </DashboardShell>
  );
}

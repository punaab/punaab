import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { PLANS } from "@/lib/plans";

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="section">
        <p className="section-num">Pricing</p>
        <h2>Simple plans for living bards.</h2>
        <p className="section-lead">
          Credits power cloud AI, speech, and music streaming. Local AI will not
          burn credits.
        </p>
        <div className="pricing-grid" style={{ marginTop: "1.5rem" }}>
          {PLANS.map((plan) => (
            <article
              key={plan.code}
              className={`card pricing-card${plan.highlighted ? " highlighted" : ""}`}
            >
              <h3>{plan.name}</h3>
              <p className="price-tag">{plan.priceLabel}</p>
              <ul>
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <div style={{ marginTop: "1rem" }}>
                {plan.code === "enterprise" ? (
                  <a className="btn soft" href="mailto:hello@punaab.com">
                    Contact sales
                  </a>
                ) : (
                  <Link className="btn primary" href="/dashboard/billing">
                    {plan.code === "free" ? "Start free" : "Choose plan"}
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}

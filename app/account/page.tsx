import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MarketingShell } from "@/components/marketing/MarketingShell";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const name =
    user.fullName ||
    user.username ||
    user.primaryEmailAddress?.emailAddress ||
    "Member";

  return (
    <MarketingShell>
      <section className="section account">
        <p className="section-num">account</p>
        <h2>Welcome, {name}</h2>
        <p className="section-lead">
          Manage projects, keys, and billing from the dashboard.
        </p>
        <p className="meta">
          Email: {user.primaryEmailAddress?.emailAddress || "—"}
        </p>
        <div className="hero-actions" style={{ marginTop: "1.25rem" }}>
          <Link className="btn primary" href="/dashboard">
            Open dashboard
          </Link>
          <Link className="btn ghost" href="/dashboard/billing">
            Billing
          </Link>
        </div>
      </section>
    </MarketingShell>
  );
}

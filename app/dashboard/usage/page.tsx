import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ensureProfile } from "@/lib/profiles";
import { getCreditBalance } from "@/lib/credits";

export default async function UsagePage() {
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);

  let balance = 500;
  let events: Array<{
    id: string;
    kind: string;
    cost_credits: number;
    created_at: string;
  }> = [];
  let ledger: Array<{
    id: string;
    delta: number;
    reason: string;
    created_at: string;
  }> = [];

  if (supabase && profile.id !== "local") {
    balance = await getCreditBalance(supabase, profile.id);
    const [{ data: e }, { data: l }] = await Promise.all([
      supabase
        .from("usage_events")
        .select("id, kind, cost_credits, created_at")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("credit_ledger")
        .select("id, delta, reason, created_at")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);
    events = e || [];
    ledger = l || [];
  }

  return (
    <DashboardShell title="Usage & Credits" subtitle="Cloud AI burns credits. Local AI will not.">
      <article className="card">
        <p className="meta">balance</p>
        <h2>{balance.toLocaleString()} credits</h2>
      </article>
      <article className="card">
        <h2>Usage events</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Credits</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{e.kind}</td>
                <td>{e.cost_credits}</td>
                <td>{new Date(e.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      <article className="card">
        <h2>Ledger</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Delta</th>
              <th>Reason</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((row) => (
              <tr key={row.id}>
                <td>{row.delta}</td>
                <td>{row.reason}</td>
                <td>{new Date(row.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </DashboardShell>
  );
}

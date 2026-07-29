import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { InviteScroll } from "@/components/dashboard/InviteScroll";

export const metadata = {
  title: "Rewards · Punaab",
  description:
    "Share your guild invite scroll, earn gold for referrals and Archive upvotes.",
};

export default function RewardsPage() {
  return (
    <DashboardShell
      title="Rewards"
      subtitle="Unfurl your invite scroll, call friends to the road, and fill the purse."
      primaryAction={null}
    >
      <InviteScroll />
    </DashboardShell>
  );
}

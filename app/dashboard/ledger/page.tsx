import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PlayerStudio } from "@/components/dashboard/PlayerStudio";

export const metadata = {
  title: "Ledger · Punaab",
};

export default function LedgerPage() {
  return (
    <DashboardShell
      title="Ledger"
      subtitle="Check the gold in your wallet, update your passport, and earn."
      primaryAction={null}
    >
      <PlayerStudio />
    </DashboardShell>
  );
}

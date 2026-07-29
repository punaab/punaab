import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PlayerStudio } from "@/components/dashboard/PlayerStudio";

export const metadata = {
  title: "Create character · Punaab",
};

export default function PlayerCharacterPage() {
  return (
    <DashboardShell
      title="Character & purse"
      subtitle="Name your traveler, check the gold wallet, and invite friends to the road."
      primaryAction={null}
    >
      <PlayerStudio />
    </DashboardShell>
  );
}

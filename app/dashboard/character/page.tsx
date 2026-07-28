import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PlayerStudio } from "@/components/dashboard/PlayerStudio";

export const metadata = {
  title: "Create character · Punaab",
};

export default function PlayerCharacterPage() {
  return (
    <DashboardShell
      title="Create your character"
      subtitle="Name your traveler, check your gold wallet, and invite friends to the road."
    >
      <PlayerStudio />
    </DashboardShell>
  );
}

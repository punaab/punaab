import { PlaceShell } from "@/components/PlaceShell";
import { SEED_FACTIONS } from "@/lib/seed-data";

export default function GuildsPage() {
  return (
    <PlaceShell title="Guild District">
      <p className="hub-intro">
        Factions, businesses, churches, nations, research groups, and adventuring
        companies. Soft-join stubs for Stage One.
      </p>
      <div className="panel-grid">
        {SEED_FACTIONS.map((faction) => (
          <article key={faction.id} className="panel">
            <p className="meta">faction</p>
            <h2>{faction.name}</h2>
            <p>{faction.summary}</p>
            <button type="button" className="btn ghost">
              Request membership
            </button>
          </article>
        ))}
      </div>
    </PlaceShell>
  );
}

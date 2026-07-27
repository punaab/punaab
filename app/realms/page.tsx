import { PlaceShell } from "@/components/PlaceShell";
import { SEED_REALMS } from "@/lib/seed-data";

export default function RealmsPage() {
  return (
    <PlaceShell title="Hall of Realms">
      <p className="hub-intro">
        Connected games choose their integration level — lore, items,
        progression, or living realm feedback into the Chronicle.
      </p>
      <div className="panel-grid">
        {SEED_REALMS.map((realm) => (
          <article key={realm.id} className="panel">
            <p className="meta">
              {realm.status} · level {realm.integration_level}
            </p>
            <h2>{realm.name}</h2>
            <p>{realm.summary}</p>
          </article>
        ))}
      </div>
    </PlaceShell>
  );
}

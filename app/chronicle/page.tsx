import { PlaceShell } from "@/components/PlaceShell";
import { SEED_CHRONICLES } from "@/lib/seed-data";

export default function ChroniclePage() {
  return (
    <PlaceShell title="The Chronicle">
      <p className="hub-intro">
        History forming in real time. Verified events become permanent entries —
        participants, decisions, and consequences.
      </p>
      <div className="panel-grid">
        {SEED_CHRONICLES.map((entry) => (
          <article key={entry.id} className="panel">
            <p className="meta">{new Date(entry.occurred_at).toLocaleString()}</p>
            <h2>{entry.title}</h2>
            <p>{entry.summary}</p>
          </article>
        ))}
      </div>
    </PlaceShell>
  );
}

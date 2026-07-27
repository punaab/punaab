import { PlaceShell } from "@/components/PlaceShell";

export default function CouncilPage() {
  return (
    <PlaceShell title="The Council">
      <p className="hub-intro">
        Signals, reputation review, and a small accountable canon council.
        Money never purchases votes.
      </p>
      <div className="panel-grid">
        <article className="panel">
          <p className="meta">open signal</p>
          <h2>Should the Sunstone enter Universal Canon?</h2>
          <p>
            Community nominates. Archivists review. Council decides. Stage One
            records your interest; binding votes land with reputation gates.
          </p>
          <div className="chip-row">
            <span className="chip">support</span>
            <span className="chip">oppose</span>
            <span className="chip">abstain</span>
          </div>
        </article>
        <article className="panel">
          <p className="meta">process</p>
          <h2>Three approvals</h2>
          <ul>
            <li>Community signals — likes, reports, nominations</li>
            <li>Reputation review — writers, developers, archivists</li>
            <li>Canon council — universal changes only</li>
          </ul>
        </article>
      </div>
    </PlaceShell>
  );
}

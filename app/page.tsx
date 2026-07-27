import Image from "next/image";
import { PlaceShell } from "@/components/PlaceShell";
import { GateActions } from "@/components/AuthControls";

export default function GatePage() {
  return (
    <PlaceShell>
      <section className="gate">
        <div className="gate-copy">
          <p className="gate-kicker">// arrival gate</p>
          <h1>PIXELGREW</h1>
          <p>
            A shared universe that feels like a place. Walk the Archive, trade
            in the Bazaar, craft in the Forge, and help write history in the
            Chronicle. One identity. Many realms.
          </p>
          <GateActions />
          <p style={{ marginTop: "1.25rem", color: "var(--muted)" }}>
            Guests may browse open locations. Play requires an account.
          </p>
        </div>
        <div className="gate-art">
          <Image
            src="/assets/punaab-hoodie.png"
            alt="Punaab"
            width={480}
            height={480}
            priority
          />
        </div>
      </section>
    </PlaceShell>
  );
}

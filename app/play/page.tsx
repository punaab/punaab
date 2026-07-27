import Image from "next/image";
import Link from "next/link";
import { PlaceShell } from "@/components/PlaceShell";

export default function PlayPage() {
  return (
    <PlaceShell title="Play">
      <p className="hub-intro">
        You are inside the hub. A lightweight 3D walkable district comes next —
        for now, move through the doors of the world.
      </p>
      <div className="play-stage">
        <div>
          <Image
            src="/assets/punaab-wink.png"
            alt="Punaab"
            width={140}
            height={140}
          />
          <h2>Hub Chamber</h2>
          <p style={{ color: "var(--muted)", maxWidth: 420, margin: "0.75rem auto 1.25rem" }}>
            Account linked. Ember balance and inventory will appear here once
            Supabase is connected on Vercel.
          </p>
          <div className="chip-row" style={{ justifyContent: "center" }}>
            <Link className="chip" href="/archive">
              Archive
            </Link>
            <Link className="chip" href="/forge">
              Forge
            </Link>
            <Link className="chip" href="/bazaar">
              Bazaar
            </Link>
            <Link className="chip" href="/chronicle">
              Chronicle
            </Link>
          </div>
        </div>
      </div>
    </PlaceShell>
  );
}

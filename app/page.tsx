import Image from "next/image";
import Link from "next/link";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
} from "@clerk/nextjs";
import { PlaceShell } from "@/components/PlaceShell";

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
          <div className="gate-actions">
            <SignedOut>
              <SignUpButton mode="modal">
                <button type="button" className="btn primary">
                  Create account
                </button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button type="button" className="btn ghost">
                  Sign in
                </button>
              </SignInButton>
              <Link href="/world" className="btn ghost">
                Browse the Hub
              </Link>
            </SignedOut>
            <SignedIn>
              <Link href="/world" className="btn primary">
                Enter the World
              </Link>
              <Link href="/play" className="btn ghost">
                Play
              </Link>
            </SignedIn>
          </div>
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

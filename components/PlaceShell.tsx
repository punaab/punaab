import Link from "next/link";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import Image from "next/image";

export function PlaceShell({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="place-root">
      <header className="place-header">
        <Link href="/world" className="brand">
          <Image
            src="/assets/punaab-logo.png"
            alt="PixelGrew"
            width={36}
            height={36}
            className="brand-mark"
          />
          <span className="brand-text">PixelGrew</span>
        </Link>
        <nav className="place-nav">
          <Link href="/world">Hub</Link>
          <Link href="/archive">Archive</Link>
          <Link href="/chronicle">Chronicle</Link>
          <Link href="/realms">Realms</Link>
          <SignedIn>
            <Link href="/play">Play</Link>
            <Link href="/profile">Profile</Link>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button type="button" className="btn ghost">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button type="button" className="btn primary">
                Create account
              </button>
            </SignUpButton>
          </SignedOut>
        </nav>
      </header>
      {title ? (
        <div className="place-titlebar">
          <h1>{title}</h1>
        </div>
      ) : null}
      <main className="place-main">{children}</main>
      <footer className="place-footer">
        <span>© 2026 PixelGrew</span>
        <span className="dot">•</span>
        <span>Powered by PixelGrew</span>
      </footer>
    </div>
  );
}

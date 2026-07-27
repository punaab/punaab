"use client";

import Link from "next/link";
import {
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
} from "@clerk/nextjs";

export function AuthNav() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <span className="meta">…</span>;
  }

  if (isSignedIn) {
    return (
      <>
        <Link href="/play">Play</Link>
        <Link href="/profile">Profile</Link>
        <UserButton />
      </>
    );
  }

  return (
    <>
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
    </>
  );
}

export function GateActions() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <div className="gate-actions" />;
  }

  if (isSignedIn) {
    return (
      <div className="gate-actions">
        <Link href="/world" className="btn primary">
          Enter the World
        </Link>
        <Link href="/play" className="btn ghost">
          Play
        </Link>
      </div>
    );
  }

  return (
    <div className="gate-actions">
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
    </div>
  );
}

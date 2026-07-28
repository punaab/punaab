"use client";

import {
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
} from "@clerk/nextjs";
import { SiteLink } from "@/components/marketing/SiteLink";

export function AuthNav() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return <span className="meta">…</span>;

  if (isSignedIn) {
    return (
      <div className="account-cluster">
        <SiteLink href="/dashboard" className="nav-pill nav-pill-accent">
          Dashboard
        </SiteLink>
        <UserButton />
      </div>
    );
  }

  return (
    <div className="account-cluster">
      <SignInButton mode="modal">
        <button type="button" className="btn ghost nav-btn">
          Sign in
        </button>
      </SignInButton>
      <SignUpButton mode="modal">
        <button type="button" className="btn soft nav-btn nav-btn-signup">
          Join in!
        </button>
      </SignUpButton>
    </div>
  );
}

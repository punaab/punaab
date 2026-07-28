"use client";

import {
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
} from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { SiteLink } from "@/components/marketing/SiteLink";

export function AuthNav() {
  const { isLoaded, isSignedIn } = useAuth();
  const [isLoreAdmin, setIsLoreAdmin] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsLoreAdmin(false);
      return;
    }
    let cancelled = false;
    void fetch("/api/community/lore/admin")
      .then((r) => r.json())
      .then((data: { isAdmin?: boolean }) => {
        if (!cancelled) setIsLoreAdmin(Boolean(data.isAdmin));
      })
      .catch(() => {
        if (!cancelled) setIsLoreAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  if (!isLoaded) return <span className="meta">…</span>;

  if (isSignedIn) {
    return (
      <div className="account-cluster">
        {isLoreAdmin && (
          <SiteLink href="/world/review" className="nav-pill">
            Review
          </SiteLink>
        )}
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

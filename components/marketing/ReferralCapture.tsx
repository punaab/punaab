"use client";

import { useEffect } from "react";

const COOKIE = "punaab_ref";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Captures ?ref= invite codes into a cookie so signup can credit the inviter.
 * Also accepts ?invite= as an alias so shared guild seals stay durable.
 */
export function ReferralCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref =
        params.get("ref")?.trim().toUpperCase() ||
        params.get("invite")?.trim().toUpperCase();
      if (!ref || ref.length < 4 || ref.length > 16) return;
      document.cookie = `${COOKIE}=${encodeURIComponent(ref)}; path=/; max-age=${MAX_AGE}; samesite=lax`;
    } catch {
      // ignore
    }
  }, []);

  return null;
}

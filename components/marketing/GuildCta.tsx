"use client";

import { SiteLink } from "@/components/marketing/SiteLink";

/** Shared header CTA — always the same blue GUILD pill. */
export function GuildCta() {
  return (
    <SiteLink href="/dashboard" className="btn primary btn-glow header-cta">
      GUILD
    </SiteLink>
  );
}

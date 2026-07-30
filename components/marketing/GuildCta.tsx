"use client";

import { SiteLink } from "@/components/marketing/SiteLink";

/**
 * Shared header CTA — the blue pill that drops you straight into the stage.
 * The guild hall itself is a nav tab now; this button is the play button.
 */
export function GuildCta() {
  return (
    <SiteLink href="/world" className="btn primary btn-glow header-cta">
      PLAY
    </SiteLink>
  );
}

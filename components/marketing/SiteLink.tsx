"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

type SiteLinkProps = ComponentProps<typeof Link>;

function hrefPath(href: SiteLinkProps["href"]): string {
  if (typeof href === "string") return href;
  return href.pathname ?? "/";
}

/**
 * Internal site links stay in the same tab, except `/travel` — the 3D stage
 * is heavy to spin up, so that route opens in a new tab and leaves whatever
 * you were looking at intact.
 *
 * Social and merch links are plain anchors with `target="_blank"` elsewhere;
 * they are not routed through this component.
 */
export function SiteLink({ href, ...props }: SiteLinkProps) {
  const target = hrefPath(href);
  const isTravel =
    target === "/travel" || target.startsWith("/travel?") || target.startsWith("/travel#");

  if (!isTravel) {
    return <Link href={href} {...props} />;
  }

  return <Link href={href} target="_blank" rel="noopener noreferrer" {...props} />;
}

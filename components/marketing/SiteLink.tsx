"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

type SiteLinkProps = ComponentProps<typeof Link>;

function hrefPath(href: SiteLinkProps["href"]): string {
  if (typeof href === "string") return href;
  return href.pathname ?? "/";
}

/**
 * A link that only opens a new tab when there is something worth protecting.
 *
 * The homepage runs the 3D valley — a WebGL context, a terrain bake, a bard
 * partway through a journey. Navigating away tears all of that down and pays
 * for it again on the way back, so links *leaving the homepage* open in a new
 * tab and leave the stage running behind them.
 *
 * That reasoning does not survive the trip. Once you are on `/models` there is
 * no scene to keep alive, and spawning a tab for every link from there is just
 * litter — which is why this checks where you are, not only where you are
 * going.
 */
export function SiteLink({ href, ...props }: SiteLinkProps) {
  const pathname = usePathname();
  const target = hrefPath(href);

  const onHomepage = pathname === "/";
  // Home itself and its own in-page anchors never open a tab: they would
  // either do nothing or duplicate the page you are already looking at.
  const staysHere = target === "/" || target.startsWith("/#") || target.startsWith("#");

  if (!onHomepage || staysHere) {
    return <Link href={href} {...props} />;
  }

  return <Link href={href} target="_blank" rel="noopener noreferrer" {...props} />;
}

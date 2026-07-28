import Link from "next/link";
import type { ComponentProps } from "react";

type SiteLinkProps = ComponentProps<typeof Link>;

/** Home (and in-page home hashes) stay in this tab so the 3D stage keeps running. */
function isHomeHref(href: SiteLinkProps["href"]): boolean {
  if (typeof href === "string") {
    return href === "/" || href.startsWith("/#");
  }
  const pathname = href.pathname ?? "/";
  return pathname === "/" && !href.search;
}

/**
 * Marketing link: other site pages open in a new tab so one home tab can keep
 * Stage3D alive while browsing.
 */
export function SiteLink({ href, ...props }: SiteLinkProps) {
  if (isHomeHref(href)) {
    return <Link href={href} {...props} />;
  }

  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" {...props} />
  );
}

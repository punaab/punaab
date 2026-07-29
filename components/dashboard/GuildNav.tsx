"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DASHBOARD_NAV } from "@/lib/nav";

/**
 * Guild hall tabs under the shared site header.
 * Active route gets the wax-seal treatment so you always know which wing you're in.
 */
export function GuildNav() {
  const pathname = usePathname();

  return (
    <nav className="guild-nav" aria-label="Guild">
      <div className="guild-nav-track">
        {DASHBOARD_NAV.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`guild-nav-tab${active ? " is-active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <span className="guild-nav-gem" aria-hidden="true" />
              <span className="guild-nav-label">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

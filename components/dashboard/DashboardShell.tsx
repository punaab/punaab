import Link from "next/link";
import Image from "next/image";
import { UserButton } from "@clerk/nextjs";
import { DASHBOARD_NAV } from "@/lib/nav";

export function DashboardShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="dash-root">
      <aside className="dash-sidebar">
        <Link href="/" className="brand">
          <Image
            src="/assets/solana.png"
            alt="Punaab"
            width={36}
            height={36}
            className="brand-mark"
          />
          <span className="brand-text">Punaab</span>
        </Link>
        <nav className="dash-nav">
          {DASHBOARD_NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="dash-sidebar-foot">
          <UserButton />
          <Link href="/account">Profile</Link>
        </div>
      </aside>
      <div className="dash-main">
        <header className="dash-top">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <Link href="/dashboard/character" className="btn primary">
            Create character
          </Link>
        </header>
        <div className="dash-content">{children}</div>
      </div>
    </div>
  );
}

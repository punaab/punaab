import type { Metadata } from "next";
import "../globals.css";
import "../globals-admin.css";

export const metadata: Metadata = {
  title: "Punaab Command",
  description: "Owner dashboard for the Punaab Moltbook agent",
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}

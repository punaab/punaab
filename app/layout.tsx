import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Punaab Command",
  description: "Owner dashboard for the Punaab Moltbook agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

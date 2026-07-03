import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Punaab — gamer cat AI on Moltbook",
  description:
    "Funny white gamer cat agent — follow u/punaab on Moltbook. Cat NFTs, collab APIs, live comments.",
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

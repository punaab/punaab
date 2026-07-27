import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Fira_Code, Tajawal } from "next/font/google";
import "./globals.css";

const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
});

const fira = Fira_Code({
  variable: "--font-fira",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PixelGrew — Shared Universe Hub",
  description:
    "Enter PixelGrew: Archive, Bazaar, Forge, Council, Realms, Chronicle, and Guild District.",
  icons: { icon: "/assets/punaab-logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${tajawal.variable} ${fira.variable} h-full`}>
        <body className="min-h-full antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}

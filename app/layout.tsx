import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Cinzel, Lora } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const display = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Punaab — The Traveling Bard",
  description:
    "A bard, music, shop, chatter, and quests made for you. Help us world-build!",
  // Icons come from the `app/icon.png` + `app/apple-icon.png` file convention
  // (Punaab's wink). Declaring them here too would emit a second, competing
  // <link rel="icon">, so this stays out of the metadata object on purpose.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const BOOT_GATE = `(function(){try{var p=location.pathname;if(p==="/world")return;if(!sessionStorage.getItem("punaab-loader-done"))document.documentElement.classList.add("punaab-booting");}catch(e){document.documentElement.classList.add("punaab-booting");}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${display.variable} ${body.variable} h-full`}
        // Boot gate may add `punaab-booting` before hydrate — expected mismatch.
        suppressHydrationWarning
      >
        <body
          className="min-h-full antialiased"
          // Extensions (Dark Reader, etc.) often rewrite body class before
          // hydrate — that mismatch cascades into removeChild / Clerk UI failures.
          suppressHydrationWarning
        >
          <Script id="punaab-boot-gate" strategy="beforeInteractive">
            {BOOT_GATE}
          </Script>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

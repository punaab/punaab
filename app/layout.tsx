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
    "A free AI bard for your game — songs, shops, chatter, and the open road.",
  icons: {
    icon: [
      {
        url: "/assets/images/pixel_coin.svg",
        type: "image/svg+xml",
      },
    ],
    apple: "/assets/images/pixel_coin.svg",
  },
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
        <body className="min-h-full antialiased">
          <Script id="punaab-boot-gate" strategy="beforeInteractive">
            {BOOT_GATE}
          </Script>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

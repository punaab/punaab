import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    localPatterns: [
      {
        pathname: "/assets/**",
      },
      {
        pathname: "/downloads/**",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/favicon.ico",
        destination: "/assets/images/pixel_coin.svg",
        permanent: false,
      },
      { source: "/demo", destination: "/models", permanent: true },
      { source: "/embeds", destination: "/models", permanent: true },
      { source: "/plugins", destination: "/models", permanent: true },
      { source: "/pricing", destination: "/", permanent: true },
      { source: "/travel", destination: "/world", permanent: true },
      { source: "/travel/:path*", destination: "/world", permanent: true },
      // Lore hall moved from /world → /archive; keep old links working.
      { source: "/world/review", destination: "/admin", permanent: true },
      { source: "/world/:id", destination: "/archive/:id", permanent: true },
      { source: "/docs", destination: "/archive", permanent: true },
      { source: "/docs/:path*", destination: "/archive", permanent: true },
      { source: "/community", destination: "/archive", permanent: true },
      { source: "/community/:id", destination: "/archive/:id", permanent: true },
      { source: "/lore", destination: "/archive", permanent: true },
      { source: "/lore/review", destination: "/admin", permanent: true },
      { source: "/lore/:id", destination: "/archive/:id", permanent: true },
      { source: "/archive/review", destination: "/admin", permanent: true },
      {
        source: "/dashboard/embeds",
        destination: "/dashboard",
        permanent: false,
      },
      {
        source: "/dashboard/billing",
        destination: "/dashboard",
        permanent: false,
      },
      {
        source: "/dashboard/character",
        destination: "/dashboard/ledger",
        permanent: true,
      },
      {
        source: "/dashboard/downloads",
        destination: "/dashboard/rewards",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

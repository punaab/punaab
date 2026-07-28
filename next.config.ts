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
      { source: "/demo", destination: "/models", permanent: true },
      { source: "/embeds", destination: "/models", permanent: true },
      { source: "/plugins", destination: "/models", permanent: true },
      { source: "/pricing", destination: "/", permanent: true },
      { source: "/docs", destination: "/world", permanent: true },
      { source: "/docs/:path*", destination: "/world", permanent: true },
      { source: "/community", destination: "/world", permanent: true },
      { source: "/community/:id", destination: "/world/:id", permanent: true },
      { source: "/lore", destination: "/world", permanent: true },
      { source: "/lore/review", destination: "/world/review", permanent: true },
      { source: "/lore/:id", destination: "/world/:id", permanent: true },
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
    ];
  },
};

export default nextConfig;

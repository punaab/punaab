import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    localPatterns: [
      {
        pathname: "/assets/**",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/embeds",
        destination: "/plugins",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

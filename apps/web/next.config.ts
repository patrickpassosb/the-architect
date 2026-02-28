import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@the-architect/shared-types"],
  experimental: {
    externalDir: true
  }
};

export default nextConfig;

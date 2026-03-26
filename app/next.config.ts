import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    externalDir: true,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;

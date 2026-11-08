import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This folder has its own lockfile; don't let Next pick one higher up.
  outputFileTracingRoot: __dirname,
  devIndicators: false,
  // The marketing page is a static HTML file generated from the prototype.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }] };
  },
};

export default nextConfig;

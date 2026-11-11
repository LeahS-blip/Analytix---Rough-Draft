import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This folder has its own lockfile; don't let Next pick one higher up.
  outputFileTracingRoot: __dirname,
  devIndicators: false,
  // Loaded at runtime only (PGlite is the local-dev database; it ships WASM files).
  serverExternalPackages: ["@electric-sql/pglite"],
  // The marketing page is a static HTML file in public/.
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }] };
  },
  // The old prototype lived at /Analytix/index.html; send those links to the real site.
  async redirects() {
    return [
      { source: "/Analytix", destination: "/", permanent: true },
      { source: "/Analytix/:path*", destination: "/", permanent: true },
      { source: "/index.html", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;

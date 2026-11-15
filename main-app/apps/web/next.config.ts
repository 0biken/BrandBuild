import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // The browser reaches the Rust API same-origin, so its session cookie is
  // first-party and proxy.ts can see it.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:3000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;

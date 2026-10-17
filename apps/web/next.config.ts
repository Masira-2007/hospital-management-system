import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Keep local verification builds reliable in the synchronized Windows workspace.
  ...(process.env.NEXT_DIST_DIR ? { experimental: { cpus: 1 } } : {}),
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
      ],
    }];
  },
  async rewrites() {
    // Vercel routes these requests through the API service in vercel.json. This proxy is only for local development.
    if (process.env.NODE_ENV === "production") return [];
    const configured = process.env.JR_XPERT_API_URL ?? "http://localhost:4000/api/v1";
    const api = new URL(configured);
    const path = api.pathname.replace(/\/$/, "");
    if (api.username || api.password || api.search || api.hash || (api.protocol !== "https:" && api.hostname !== "localhost" && api.hostname !== "127.0.0.1") || (path && path !== "/api/v1")) {
      throw new Error("JR_XPERT_API_URL must be a local API URL or an HTTPS API origin ending in /api/v1.");
    }
    return [{ source: "/api/v1/:path*", destination: `${api.origin}/api/v1/:path*` }];
  },
};

export default nextConfig;

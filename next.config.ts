import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * `next dev` writes to .next-dev, builds write to .next. Without this a
   * production build — including the one inside `npm run cf:deploy` — overwrites
   * the directory a running dev server is serving from, and dev starts throwing
   * "Cannot find module './xxx.js'" until you delete .next and restart.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Generated images come back as base64 and can be a few MB; the default
  // 1 MB body limit on Server Actions does not apply to route handlers,
  // but reference-image edits post a data URL, so keep headroom.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;

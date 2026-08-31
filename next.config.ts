import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Generated images come back as base64 and can be a few MB; the default
  // 1 MB body limit on Server Actions does not apply to route handlers,
  // but reference-image edits post a data URL, so keep headroom.
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;

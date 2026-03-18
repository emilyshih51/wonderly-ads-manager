import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger request bodies for video uploads (default is 1MB in App Router)
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;

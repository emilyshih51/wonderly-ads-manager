import type { NextConfig } from 'next';
import { validateEnv } from './src/config/env';

// Fail fast if required environment variables are missing.
// Runs at build time and on `next dev` startup.
validateEnv();

const nextConfig: NextConfig = {
  // Allow larger request bodies for video uploads (default is 1MB in App Router)
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: '**.facebook.com' },
    ],
  },
};

export default nextConfig;

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { validateEnv } from './src/config/env';

// Fail fast if required environment variables are missing.
// Runs at build time and on `next dev` startup.
validateEnv();

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
  // Serve the MCP OAuth discovery metadata at its well-known paths (Next.js ignores
  // dot-folders in the app dir, so route it to the /api/oauth handlers instead).
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/authorization-server',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/oauth/authorization-server',
      },
    ];
  },
};

export default withNextIntl(nextConfig);

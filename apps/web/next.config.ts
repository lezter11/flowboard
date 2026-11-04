import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.NEXT_EXPORT === 'true' ? 'export' : undefined,
  // Separate output dir lets a production/static build run next to `next dev` without corrupting it.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  transpilePackages: ['@flowboard/contracts'],
  async rewrites() {
    const apiUrl = process.env.API_URL || 'http://127.0.0.1:8787';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
      ...['/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/mcp'].map(source => ({ source, destination: `${apiUrl}${source}` })),
    ];
  },
};

export default nextConfig;

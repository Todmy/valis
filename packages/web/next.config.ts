import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(__dirname, '../../'),
  reactStrictMode: true,
  typescript: {
    // Type checking done in CI; don't block builds
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'authorization, x-client-info, apikey, content-type, stripe-signature',
          },
        ],
      },
    ];
  },
};

export default nextConfig;

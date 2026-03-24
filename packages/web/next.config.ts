import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  typescript: {
    // Type checking done in CI; don't block builds
    ignoreBuildErrors: false,
  },
};

export default nextConfig;

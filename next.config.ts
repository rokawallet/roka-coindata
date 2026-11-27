import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // undici is used for SSRF-guarded image downloads and must not be bundled.
  serverExternalPackages: ['undici'],
};

export default nextConfig;

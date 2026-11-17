import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['unpdf', '@prisma/client', 'prisma'],
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingExcludes: { '*': ['./kit/**', './tmp/**'] },
};

export default nextConfig;

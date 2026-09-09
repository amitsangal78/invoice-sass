import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Silences the multi-lockfile workspace-root inference warning — this repo
  // sits inside a parent directory that also has its own package-lock.json.
  outputFileTracingRoot: path.join(__dirname, '../..'),
};

export default nextConfig;

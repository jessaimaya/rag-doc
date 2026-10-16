import path from "node:path";
import type { NextConfig } from "next";

// Pin the root: with several lockfiles above this folder Next infers the wrong workspace root and Turbopack
// ends up watching the whole parent tree (slow start, then internal panics).
const root = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: 'standalone', // Required for Docker deployment
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;

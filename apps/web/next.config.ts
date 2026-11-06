import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const config: NextConfig = {
  transpilePackages: ['@quits/core', '@quits/llm', '@quits/memory', '@quits/chain', '@quits/pay', '@quits/db', '@quits/service'],
  serverExternalPackages: ['@grpc/grpc-js', '@electric-sql/pglite', 'postgres'],
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  typedRoutes: false,
};

export default config;

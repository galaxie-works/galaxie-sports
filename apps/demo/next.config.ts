import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// O monorepo guarda as variáveis no .env da raiz (GALAXIE_DEMO_KEY, GALAXIE_API_URL…).
try {
  process.loadEnvFile('../../.env');
} catch {
  // Sem .env (CI/produção): as variáveis vêm do ambiente.
}

const nextConfig: NextConfig = {
  // Imagem Docker (apps/demo/Dockerfile): servidor autocontido. Só no build da imagem, porque no
  // Windows o standalone pode precisar de privilégio para criar symlinks.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
      }
    : {}),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;

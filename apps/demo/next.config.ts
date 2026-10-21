import type { NextConfig } from 'next';

// O monorepo guarda as variáveis no .env da raiz (GALAXIE_DEMO_KEY, GALAXIE_API_URL…).
try {
  process.loadEnvFile('../../.env');
} catch {
  // Sem .env (CI/produção): as variáveis vêm do ambiente.
}

const nextConfig: NextConfig = {
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

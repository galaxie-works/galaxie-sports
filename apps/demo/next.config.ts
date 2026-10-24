import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// O monorepo guarda as variáveis no .env da raiz (GALAXIE_DEMO_KEY, GALAXIE_API_URL…).
try {
  process.loadEnvFile('../../.env');
} catch {
  // Sem .env (CI/produção): as variáveis vêm do ambiente.
}

/**
 * Fotos do acervo da Commons redimensionadas pelo `next/image` (os originais têm 1.600 a 1.920 px e até 1,7 MB):
 * só o caminho do acervo, nos nossos domínios de assets e no storage do .env (o MinIO do NAS, em dev).
 */
const ACERVO = '/**/commons/f1/**';
const devAssets = (() => {
  try {
    return process.env.ASSETS_PUBLIC_BASE_URL ? new URL(process.env.ASSETS_PUBLIC_BASE_URL) : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.galaxie.works', pathname: ACERVO },
      { protocol: 'https', hostname: '**.galaxie.sports', pathname: ACERVO },
      ...(devAssets
        ? [
            {
              protocol: devAssets.protocol.replace(':', '') as 'http' | 'https',
              hostname: devAssets.hostname,
              port: devAssets.port,
              pathname: ACERVO,
            },
          ]
        : []),
    ],
    // em dev o storage é o MinIO na LAN (IP privado), que o otimizador recusa por padrão
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== 'production',
  },
  // Imagem Docker (apps/demo/Dockerfile): servidor autocontido. Só no build da imagem, porque no
  // Windows o standalone pode precisar de privilégio para criar symlinks.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
      }
    : {}),
  cacheComponents: true,
  // a lista de canais do portal (/cliente/canais) chega por server action: até 2 MB de nomes
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
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

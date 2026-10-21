import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Carrega o .env da raiz em desenvolvimento local; no CI as variáveis vêm do ambiente.
const rootEnv = new URL('../../.env', import.meta.url);
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // logs JSON do ingestor ficam silenciosos nos testes (LOG_LEVEL=info para depurar)
    env: { LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent' },
  },
});

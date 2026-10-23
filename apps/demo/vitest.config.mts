import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Testes de integração: carrega o .env da raiz em desenvolvimento local; no CI as variáveis vêm do ambiente.
const rootEnv = new URL('../../.env', import.meta.url);
if (!process.env.DATABASE_URL && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

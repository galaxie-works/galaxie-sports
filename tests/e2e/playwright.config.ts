/**
 * Playwright do E2E (docs/qa/README.md). Roda pelo executor (`src/run.ts`), que cria o banco descartável e passa o
 * endereço dele e as chaves semeadas por variável de ambiente.
 *
 * Projetos:
 * - `setup`: login de verdade por código (Mailpit) do admin e do cliente de referência; grava as sessões em `.auth/`;
 * - `api`: chamadas HTTP à API com a chave semeada, sem navegador;
 * - `chromium`: os testes no navegador, com as sessões do `setup`.
 *
 * Servidores: a API (`apps/api/dist`) e a demo em build de produção (`next start`, `APP_ROLE` vazio = site e console
 * num processo só), nas portas do `src/env.ts`. Os dois precisam estar construídos antes (`pnpm build`, ou o passo de
 * build do job `e2e`). `E2E_REUSE_SERVERS=1` usa servidores que já estejam no ar nessas portas.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

import { defineConfig, devices } from '@playwright/test';

import { ADMIN_EMAIL, API_PORT, API_URL, DEMO_PORT, DEMO_URL, SMTP_HOST, SMTP_PORT } from './src/env.ts';

const CI = Boolean(process.env.CI);
const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

/**
 * A demo carrega o `.env` da raiz no `next.config.ts` (só o que ainda não está no ambiente). Na máquina, esse `.env` tem
 * chaves de fornecedor, SMTP de verdade e o banco de desenvolvimento: tudo que parece segredo, endereço ou porta sai
 * vazio no ambiente dos servidores de teste, e o que o teste precisa é definido logo abaixo. No CI não há `.env`.
 */
function isolatedFromRootEnv(): Record<string, string> {
  const file = root('.env');
  if (!existsSync(file)) return {};
  const risky = /KEY|TOKEN|SECRET|PASSWORD|KEK|URL|SMTP|REVIEWER|STRIPE|PORT|HOST|GITHUB|BUCKET|S3_/;
  return Object.fromEntries(
    Object.keys(parseEnv(readFileSync(file, 'utf8')))
      .filter((key) => risky.test(key))
      .map((key) => [key, '']),
  );
}

const runId = process.env.E2E_RUN_ID ?? 'e2e-local';
const databaseUrl = process.env.E2E_DATABASE_URL ?? '';

/** O que a API e a demo de teste nunca fazem: chamar fornecedor, YouTube ou LLM (nem gastar cota). */
const OFFLINE = {
  AI_STATUS: 'off',
  YOUTUBE_SEARCH: 'off',
  APISPORTS_KEY: '',
};

const sharedEnv = {
  ...isolatedFromRootEnv(),
  ...OFFLINE,
  NODE_ENV: 'production',
  LOG_LEVEL: process.env.E2E_SERVER_LOG_LEVEL ?? 'warn',
  DATABASE_URL: databaseUrl,
  REDIS_URL: process.env.REDIS_URL ?? '',
  // o Valkey pode ser compartilhado (o de desenvolvimento, na máquina): as chaves da execução ficam num prefixo só dela
  REDIS_KEY_PREFIX: `${runId}:`,
};

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  ...(CI ? { workers: 2 } : {}),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: DEMO_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'api', testMatch: /api\/.*\.spec\.ts/ },
    {
      name: 'chromium',
      testMatch: /ui\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'API',
      command: 'node dist/main.js',
      cwd: root('apps/api'),
      url: `${API_URL}/health`,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === '1',
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...sharedEnv,
        API_PORT: String(API_PORT),
        API_PUBLIC_URL: API_URL,
        CORS_ORIGINS: DEMO_URL,
        // a base semântica da fixture ainda não passou por revisão editorial
        SEMANTIC_MIN_REVIEW_STATUS: 'draft',
        UPGRADE_URL_BASE: `${DEMO_URL}/client/plans`,
      },
    },
    {
      name: 'demo',
      command: `pnpm exec next start --port ${DEMO_PORT}`,
      cwd: root('apps/demo'),
      url: `${DEMO_URL}/api/version`,
      reuseExistingServer: process.env.E2E_REUSE_SERVERS === '1',
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...sharedEnv,
        // vazio = `all`: site e console num processo só (lib/app-role.ts)
        APP_ROLE: '',
        PORT: String(DEMO_PORT),
        DEMO_DATABASE_URL: databaseUrl,
        DEMO_CACHE_FEED: 'off',
        DEMO_INTERNAL_URL: DEMO_URL,
        GALAXIE_API_URL: API_URL,
        GALAXIE_DEMO_KEY: process.env.E2E_DEMO_KEY ?? '',
        BETTER_AUTH_URL: DEMO_URL,
        BETTER_AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? '',
        DEMO_ADMIN_EMAIL: ADMIN_EMAIL,
        DEMO_ADMIN_NAME: 'Admin E2E',
        // SMTP falso (Mailpit aceita qualquer usuário e senha); sem TLS na porta 1025
        SMTP_HOST,
        SMTP_PORT: String(SMTP_PORT),
        SMTP_USER: 'e2e',
        SMTP_PASSWORD: 'e2e',
        SMTP_FROM: 'Galaxie Sports E2E <no-reply@galaxie.test>',
      },
    },
  ],
});
